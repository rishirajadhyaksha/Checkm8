import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { api } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "../AuthContext";
import { useActiveGame } from "../ActiveGameContext";
import { useConfirm, isConfirmOpen } from "../components/ConfirmDialog";
import GameChat from "../components/GameChat";

const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert", practice: "Practice Bot" };

export default function GameRoom() {
  const { gameId } = useParams();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { setActiveGame, clearActiveGame } = useActiveGame();
  const { confirm, closeConfirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [state, setState] = useState(null); // full server state
  const [chess] = useState(() => new Chess());
  const [lastMoveSquares, setLastMoveSquares] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null); // click-to-move (item 8/9)
  const [rejectShake, setRejectShake] = useState(false);
  const [engineThinking, setEngineThinking] = useState(false);
  const [error, setError] = useState("");
  const clockTickRef = useRef(null);
  // Deadline-style clock: banked times as of turnStart (server time), plus a
  // measured client->server clock offset. The display is recomputed from
  // absolute timestamps every tick, so latency and background-tab throttling
  // cannot make it drift away from the server.
  const clockRef = useRef({ bankedW: null, bankedB: null, turnStart: 0, running: false, turn: "w", offsets: [] });
  const [displayTimes, setDisplayTimes] = useState({ white: null, black: null });
  const [pendingPromotion, setPendingPromotion] = useState(null); // { from, to, color } | null
  // Premove (client-only): one queued move, played the instant it is our turn
  // if it is legal then; otherwise silently dropped. Never sent to the server early.
  const [premove, setPremoveState] = useState(null); // { from, to } | null
  const [premoveFrom, setPremoveFrom] = useState(null); // selected square while choosing a premove
  const premoveRef = useRef(null);
  const setPremove = useCallback((pm) => {
    premoveRef.current = pm;
    setPremoveState(pm);
    setPremoveFrom(null);
  }, []);

  // Move navigation: viewPly === null follows the live position; a number is a
  // past ply (0 = start). Purely a view — the game, clocks and server never change.
  const [viewPly, setViewPly] = useState(null);
  const [reviewBase, setReviewBase] = useState(0); // move count when the user left the live position
  const [animMs, setAnimMs] = useState(150);
  const [resigning, setResigning] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatError, setChatError] = useState("");
  const [chatClosesAt, setChatClosesAt] = useState(null);
  const chatErrTimer = useRef(null);

  const plyInitRef = useRef(null);
  const [ratingChanges, setRatingChanges] = useState(null); // { [userId]: {before, after} } | null
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [rematchStatus, setRematchStatus] = useState(null); // null | "waiting" | "declined"
  const [incomingRematch, setIncomingRematch] = useState(null); // { fromUsername } | null

  const myColor = state
    ? state.whitePlayerId === user.userId
      ? "white"
      : state.blackPlayerId === user.userId
      ? "black"
      : null
    : null;
  const isSpectator = state && myColor === null;
  const myColorRef = useRef(null);
  myColorRef.current = myColor;

  // Record a server clock snapshot (from GET /games/:id or a socket event).
  const syncClock = useCallback((snap) => {
    const c = clockRef.current;
    c.bankedW = snap.bankedW;
    c.bankedB = snap.bankedB;
    c.turnStart = snap.turnStart || 0;
    c.running = !!snap.running;
    c.turn = snap.turn;
    if (snap.serverNow) {
      // serverNow - receiveTime = trueOffset - latency, so the largest recent
      // sample is the lowest-latency (most accurate) one.
      c.offsets.push(snap.serverNow - Date.now());
      if (c.offsets.length > 8) c.offsets.shift();
    }
    const offset = c.offsets.length ? Math.max(...c.offsets) : 0;
    c.offset = offset;
  }, []);

  const computeDisplay = useCallback(() => {
    const c = clockRef.current;
    if (c.bankedW == null) return null;
    let w = c.bankedW;
    let b = c.bankedB;
    if (c.running) {
      const elapsed = Date.now() + (c.offset || 0) - c.turnStart;
      if (c.turn === "w") w = Math.max(0, w - elapsed);
      else b = Math.max(0, b - elapsed);
    }
    // Round UP to whole seconds so the screen never reads 0:00 while the
    // server still has time left.
    return { white: Math.ceil(w / 1000) * 1000, black: Math.ceil(b / 1000) * 1000 };
  }, []);

  // ---- initial load / reconnect (Section 7.6) ----
  const loadState = useCallback(() => {
    api
      .getGame(gameId)
      .then((s) => {
        setState(s);
        setChat(Array.isArray(s.chat) ? s.chat : []);
        setChatClosesAt(s.chatClosesAt || null);
        chess.load(s.fen);
        if (s.status === "active" && s.timeControlMinutes != null) {
          syncClock({
            bankedW: s.bankedWhiteTimeMs,
            bankedB: s.bankedBlackTimeMs,
            turnStart: s.turnStartServerTimestamp,
            running: s.clockStarted,
            turn: s.turn,
            serverNow: s.serverNow,
          });
          setDisplayTimes(computeDisplay() || { white: s.whiteTimeMs, black: s.blackTimeMs });
        } else {
          // Finished (or untimed): show exactly what the server froze.
          setDisplayTimes({ white: s.whiteTimeMs, black: s.blackTimeMs });
        }
      })
      .catch((err) => setError(err.message));
  }, [gameId, chess, syncClock, computeDisplay]);

  useEffect(() => {
    setOverlayDismissed(false);
    setRatingChanges(null);
    setRematchStatus(null);
    setIncomingRematch(null);
    setSelectedSquare(null);
    premoveRef.current = null;
    setPremoveState(null);
    setPremoveFrom(null);
    setViewPly(null);
    setChat([]);
    plyInitRef.current = null;
    loadState();
  }, [loadState]);

  // ---- socket wiring ----
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.emit("join_game", { gameId });

    function onMoveMade(payload) {
      if (payload.gameId !== gameId) return;
      setEngineThinking(false);
      setSelectedSquare(null);
      setAnimMs(150);
      chess.load(payload.fen);
      setState((prev) =>
        prev
          ? {
              ...prev,
              fen: payload.fen,
              turn: payload.turn,
              whiteTimeMs: payload.whiteTimeMs,
              blackTimeMs: payload.blackTimeMs,
              moves: payload.san ? [...(prev.moves || []), { san: payload.san, from: payload.from, to: payload.to }] : prev.moves,
            }
          : prev
      );
      syncClock({
        bankedW: payload.whiteTimeMs,
        bankedB: payload.blackTimeMs,
        turnStart: payload.turnStartServerTimestamp,
        running: payload.clockStarted,
        turn: payload.turn,
        serverNow: payload.serverNow,
      });
      setDisplayTimes(computeDisplay() || { white: payload.whiteTimeMs, black: payload.blackTimeMs });
      if (payload.from && payload.to) setLastMoveSquares({ [payload.from]: "last", [payload.to]: "last" });

      // Premove: if it is now our turn and the queued move is legal, play it.
      const pm = premoveRef.current;
      if (pm) {
        const mine = myColorRef.current;
        const myTurnNow = mine && (payload.turn === "w" ? "white" : "black") === mine;
        if (myTurnNow) {
          premoveRef.current = null;
          setPremoveState(null);
          setPremoveFrom(null);
          const legal = chess.moves({ square: pm.from, verbose: true }).filter((m) => m.to === pm.to);
          if (legal.length > 0 && !chess.isGameOver()) {
            const promo = legal.some((m) => m.promotion) ? "q" : undefined;
            const sock = getSocket();
            try {
              chess.move({ from: pm.from, to: pm.to, promotion: promo });
              sock.emit("move", { gameId, from: pm.from, to: pm.to, promotion: promo });
              setLastMoveSquares({ [pm.from]: "last", [pm.to]: "last" });
            } catch {
              /* illegal after all: dropped */
            }
          }
        }
      }
    }
    function onMoveRejected(payload) {
      setError(payload.reason || "Move rejected.");
      setRejectShake(true);
      setSelectedSquare(null);
      premoveRef.current = null;
      setPremoveState(null);
      setPremoveFrom(null);
      setTimeout(() => setRejectShake(false), 250);
      if (payload.fen) chess.load(payload.fen);
      loadState();
    }
    function onEngineThinking(payload) {
      if (payload.gameId === gameId) setEngineThinking(true);
    }
    function onGameOver(payload) {
      if (payload.gameId !== gameId) return;
      setEngineThinking(false);
      closeConfirm();
      premoveRef.current = null;
      setPremoveState(null);
      setPremoveFrom(null);
      setRatingChanges(payload.ratingChanges || null);
      // Freeze on the true final clocks the server sent (loser = 0:00 on a timeout).
      if (payload.whiteTimeMs != null) setDisplayTimes({ white: payload.whiteTimeMs, black: payload.blackTimeMs });
      clockRef.current.running = false;
      loadState();
      clearActiveGame();
      refreshUser();
    }
    function onRematchRequested(payload) {
      if (payload.gameId === gameId) setIncomingRematch({ fromUsername: payload.fromUsername || "Your opponent" });
    }
    function onRematchDeclined(payload) {
      if (payload.gameId === gameId) setRematchStatus("declined");
    }
    function onRematchStarted(payload) {
      navigate(`/game/${payload.gameId}`);
    }

    function onChatMessage(payload) {
      if (payload.gameId !== gameId || !payload.message) return;
      setChat((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
    }
    function onChatUpdate(payload) {
      if (payload.gameId !== gameId) return;
      setChat((prev) => prev.map((m) => (m.id === payload.id ? { ...m, status: payload.status } : m)));
    }
    function onChatError(payload) {
      setChatError(payload.reason || "Couldn't send.");
      clearTimeout(chatErrTimer.current);
      chatErrTimer.current = setTimeout(() => setChatError(""), 4000);
    }

    socket.on("chat_message", onChatMessage);
    socket.on("chat_update", onChatUpdate);
    socket.on("chat_error", onChatError);
    socket.on("move_made", onMoveMade);
    socket.on("move_rejected", onMoveRejected);
    socket.on("engine_thinking", onEngineThinking);
    socket.on("game_over", onGameOver);
    socket.on("rematch_requested", onRematchRequested);
    socket.on("rematch_declined", onRematchDeclined);
    socket.on("rematch_started", onRematchStarted);

    return () => {
      socket.off("chat_message", onChatMessage);
      socket.off("chat_update", onChatUpdate);
      socket.off("chat_error", onChatError);
      socket.off("move_made", onMoveMade);
      socket.off("move_rejected", onMoveRejected);
      socket.off("engine_thinking", onEngineThinking);
      socket.off("game_over", onGameOver);
      socket.off("rematch_requested", onRematchRequested);
      socket.off("rematch_declined", onRematchDeclined);
      socket.off("rematch_started", onRematchStarted);
    };
  }, [gameId, chess, loadState, clearActiveGame, navigate, refreshUser, syncClock, computeDisplay, closeConfirm]);

  // Close any open confirm dialog if we leave the room.
  useEffect(() => () => closeConfirm(), [closeConfirm]);

  // ---- register/clear active-game guard for the persistent home nav (9.1) ----
  useEffect(() => {
    if (state && state.status === "active" && !isSpectator) {
      setActiveGame({ gameId, isVsComputer: state.isVsComputer, isVsBot: state.isVsBot });
    }
    return () => clearActiveGame();
  }, [state?.status, isSpectator]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- clock display: recomputed from server timestamps, never accumulated ----
  useEffect(() => {
    clearInterval(clockTickRef.current);
    if (!state || state.status !== "active" || state.timeControlMinutes == null) return;
    clockTickRef.current = setInterval(() => {
      const d = computeDisplay();
      if (!d) return;
      setDisplayTimes((prev) => (prev.white === d.white && prev.black === d.black ? prev : d));
    }, 250);
    return () => clearInterval(clockTickRef.current);
  }, [state?.status, state?.turn, computeDisplay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync with the server the moment the tab becomes visible again.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") loadState();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadState]);

  const isMyTurn = state && state.status === "active" && !isSpectator && (state.turn === "w" ? "white" : "black") === myColor;

  // ---- move navigation (view only) ----
  const replay = useMemo(() => {
    const c = new Chess();
    const fens = [c.fen()];
    const squares = [null];
    for (const m of state?.moves || []) {
      try {
        const r = c.move(m.san);
        fens.push(c.fen());
        squares.push({ from: r.from, to: r.to });
      } catch {
        break;
      }
    }
    return { fens, squares };
  }, [state?.moves]);
  const N = replay.fens.length - 1;
  const ply = viewPly === null ? N : Math.min(viewPly, N);
  const isLive = ply >= N;
  const displayFen = isLive ? state?.fen : replay.fens[ply];

  const canPremove = !!state && state.status === "active" && !isSpectator && !isMyTurn && !pendingPromotion && isLive;

  const overlayVisible = !!state && state.status === "finished" && !isSpectator && !overlayDismissed;
  const navRef = useRef({});
  navRef.current = { N, ply, hasState: !!state, pendingPromotion: !!pendingPromotion, overlayVisible };
  const setSpRef = useRef(setSearchParams);
  setSpRef.current = setSearchParams;

  const goTo = useCallback((target) => {
    const { N: n, ply: cur } = navRef.current;
    const t = Math.max(0, Math.min(n, target));
    if (t === cur) return false;
    setSelectedSquare(null);
    setPremoveFrom(null);
    setAnimMs(Math.abs(t - cur) > 1 ? 0 : 150);
    const next = new URLSearchParams(window.location.search);
    if (t >= n) {
      setViewPly(null);
      next.delete("ply");
    } else {
      if (cur >= n) setReviewBase(n);
      setViewPly(t);
      next.set("ply", String(t));
    }
    setSpRef.current(next, { replace: true });
    return true;
  }, []);

  // Open at ?ply=N once per game.
  useEffect(() => {
    if (!state || state.gameId !== gameId || plyInitRef.current === gameId) return;
    plyInitRef.current = gameId;
    const raw = searchParams.get("ply");
    if (raw === null) return;
    const p = parseInt(raw, 10);
    if (Number.isFinite(p) && p >= 0 && p < N) {
      setReviewBase(N);
      setViewPly(p);
    }
  }, [state, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys: Left/Right step, Up = start, Down = latest (live).
  useEffect(() => {
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const key = e.key;
      if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (isConfirmOpen()) return;
      const n = navRef.current;
      if (!n.hasState || n.pendingPromotion) return;
      const target = key === "ArrowLeft" ? n.ply - 1 : key === "ArrowRight" ? n.ply + 1 : key === "ArrowUp" ? 0 : n.N;
      if (Math.max(0, Math.min(n.N, target)) === n.ply) return; // nothing to do: leave the key to the page
      e.preventDefault();
      if (n.overlayVisible) setOverlayDismissed(true);
      goTo(target);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // Escape or right-click cancels a queued premove.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setPremove(null);
        setSelectedSquare(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPremove]);

  function ownPieceAt(square) {
    const piece = chess.get(square);
    return piece && (piece.color === "w" ? "white" : "black") === myColor ? piece : null;
  }

  function tryQueuePremove(from, to) {
    if (from === to || !ownPieceAt(from) || ownPieceAt(to)) return false;
    setPremove({ from, to });
    return true;
  }

  function commitMove(from, to, promotion) {
    // Optimistic local render (7.2 step 1) — but always let the server have final say.
    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      move = null;
    }
    if (!move) return false;

    const socket = getSocket();
    socket.emit("move", { gameId, from, to, promotion: move.promotion });
    setLastMoveSquares({ [from]: "last", [to]: "last" });
    return true;
  }

  // Shared by both drag-and-drop and click-to-move (item 8): given a from/to,
  // check legality and whether it's a promotion before committing.
  function attemptMove(from, to) {
    if (!isMyTurn || pendingPromotion) return false;
    const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    if (candidates.some((m) => m.promotion)) {
      setPendingPromotion({ from, to, color: chess.turn() });
      return false; // board stays put until they choose a piece
    }
    return commitMove(from, to);
  }

  function onPieceDrop(sourceSquare, targetSquare) {
    setSelectedSquare(null);
    if (!isLive) return false;
    if (canPremove) {
      tryQueuePremove(sourceSquare, targetSquare);
      return false; // the real board does not move until the premove executes
    }
    return attemptMove(sourceSquare, targetSquare);
  }

  function onPieceDragBegin(_piece, sourceSquare) {
    if (!isLive || canPremove) return;
    // Show legal-move highlights while dragging too, not just after a click (item 9).
    if (isMyTurn) setSelectedSquare(sourceSquare);
  }

  function onPieceDragEnd() {
    setSelectedSquare(null);
  }

  // Click-to-move (item 8): click a piece to select it, click a highlighted
  // square to move there, click elsewhere to reselect or deselect.
  function onSquareClick(square) {
    if (!isLive) return;
    if (canPremove) {
      if (premoveFrom) {
        if (square === premoveFrom) {
          setPremoveFrom(null);
          return;
        }
        if (tryQueuePremove(premoveFrom, square)) return;
      }
      if (ownPieceAt(square)) setPremoveFrom(square);
      else {
        setPremoveFrom(null);
        setPremove(null);
      }
      return;
    }
    if (!isMyTurn || pendingPromotion) return;

    if (selectedSquare) {
      if (square === selectedSquare) {
        setSelectedSquare(null);
        return;
      }
      const moved = attemptMove(selectedSquare, square);
      if (moved) {
        setSelectedSquare(null);
        return;
      }
      if (pendingPromotion) return; // promotion dialog now owns the interaction
    }

    const piece = chess.get(square);
    if (piece && piece.color === chess.turn()) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  }

  function handlePromotionChoice(piece) {
    if (!pendingPromotion) return;
    commitMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
    setSelectedSquare(null);
  }

  function handlePromotionCancel() {
    setPendingPromotion(null);
  }

  async function handleResign() {
    if (resigning) return;
    const rated = state && !state.isVsComputer && !state.isVsBot;
    const ok = await confirm({
      title: "Resign this game?",
      body: `You will lose the game. ${rated ? "This game is rated." : "This game is unrated."}`,
      confirmLabel: "Resign",
      danger: true,
    });
    if (!ok) return;
    setResigning(true);
    try {
      await api.resign(gameId);
    } catch (err) {
      setError(err.message);
    } finally {
      setResigning(false);
    }
  }

  const sendChat = (text) => getSocket().emit("chat_send", { gameId, text });
  const offerDraw = () => getSocket().emit("draw_offer", { gameId });
  const respondDraw = (offerId, accept) => getSocket().emit("draw_respond", { gameId, offerId, accept });
  const cancelDraw = (offerId) => getSocket().emit("draw_cancel", { gameId, offerId });

  async function handleRematch() {
    if (!state) return;
    if (state.isVsComputer) {
      try {
        const game = await api.createComputerGame({
          timeControlMinutes: state.timeControlMinutes,
          incrementSeconds: state.incrementSeconds,
          engineTier: state.engineTier,
          color: myColor || "random",
        });
        navigate(`/game/${game.gameId}`);
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    if (state.isVsBot) {
      try {
        const game = await api.createBotGame(state.botId, {
          timeControlMinutes: state.timeControlMinutes,
          incrementSeconds: state.incrementSeconds,
          color: myColor || "random",
        });
        navigate(`/game/${game.gameId}`);
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    getSocket().emit("request_rematch", { gameId });
    setRematchStatus("waiting");
  }

  function respondRematch(accept) {
    getSocket().emit("respond_rematch", { gameId, accept });
    setIncomingRematch(null);
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center py-24">
        {error ? <p className="text-ember-300">{error}</p> : <span className="text-brass-500 animate-pulse">Loading board…</span>}
      </div>
    );
  }

  const whiteName =
    state.isVsComputer && state.whitePlayerId === "ENGINE"
      ? `Checkm8 Bot · ${TIER_LABEL[state.engineTier]}`
      : state.isVsBot && state.whitePlayerId === "BOT"
      ? `${state.botName || "Community Bot"} (bot)`
      : state.whitePlayer?.username || nameFor(state, "white", user);
  const blackName =
    state.isVsComputer && state.blackPlayerId === "ENGINE"
      ? `Checkm8 Bot · ${TIER_LABEL[state.engineTier]}`
      : state.isVsBot && state.blackPlayerId === "BOT"
      ? `${state.botName || "Community Bot"} (bot)`
      : state.blackPlayer?.username || nameFor(state, "black", user);

  const opponentInfo = !isSpectator
    ? myColor === "white"
      ? {
          name: blackName,
          rating: state.blackPlayer?.rating,
          isComputer: state.isVsComputer && state.blackPlayerId === "ENGINE",
          isBot: state.isVsBot && state.blackPlayerId === "BOT",
        }
      : {
          name: whiteName,
          rating: state.whitePlayer?.rating,
          isComputer: state.isVsComputer && state.whitePlayerId === "ENGINE",
          isBot: state.isVsBot && state.whitePlayerId === "BOT",
        }
    : null;

  const boardOrientation = myColor === "black" ? "black" : "white";

  // ---- square highlight styles: last move, check, click-to-move selection + legal targets (item 9) ----
  const customSquareStyles = {};
  const lm = replay.squares[ply];
  if (lm) {
    customSquareStyles[lm.from] = { backgroundColor: "rgba(201, 161, 90, 0.22)" };
    customSquareStyles[lm.to] = { backgroundColor: "rgba(201, 161, 90, 0.22)" };
  }
  const checkChess = isLive ? chess : new Chess(displayFen);
  if (checkChess.inCheck()) {
    const board = checkChess.board();
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === "k" && p.color === checkChess.turn()) {
          const sq = "abcdefgh"[c] + (8 - r);
          customSquareStyles[sq] = { backgroundColor: "rgba(181, 67, 47, 0.5)" };
        }
      }
  }
  let legalTargets = [];
  if (selectedSquare && isLive) {
    legalTargets = chess.moves({ square: selectedSquare, verbose: true });
    customSquareStyles[selectedSquare] = { backgroundColor: "rgba(201, 161, 90, 0.38)" };
    for (const m of legalTargets) {
      const isCapture = !!m.captured;
      customSquareStyles[m.to] = {
        background: isCapture
          ? "radial-gradient(circle, transparent 58%, rgba(181,67,47,0.55) 60%, rgba(181,67,47,0.55) 72%, transparent 74%)"
          : "radial-gradient(circle, rgba(201,161,90,0.55) 20%, transparent 21%)",
      };
    }
  }

  if (premove && isLive) {
    customSquareStyles[premove.from] = { backgroundColor: "rgba(181, 67, 47, 0.45)" };
    customSquareStyles[premove.to] = { backgroundColor: "rgba(181, 67, 47, 0.45)" };
  } else if (premoveFrom && isLive) {
    customSquareStyles[premoveFrom] = { backgroundColor: "rgba(181, 67, 47, 0.3)" };
  }

  const showBigOverlay = overlayVisible && isLive;
  const isPvp = !state.isVsComputer && !state.isVsBot;
  const myTurnNow = state.status === "active" && !isSpectator && (state.turn === "w" ? "white" : "black") === myColor;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_320px] gap-8">
      <div className={`flex flex-col items-center relative ${rejectShake ? "animate-shake" : ""}`}>
        {opponentInfo && (
          <div className="w-full max-w-[560px] mb-2 px-1 flex items-center gap-3 text-sm">
            <span className="text-ink-600">Playing against</span>
            <span className="font-semibold">{opponentInfo.name}</span>
            {opponentInfo.rating != null && (
              <span className="flex items-center text-ink-600">
                <span className="border-l border-ink-700 pl-3 font-mono">{opponentInfo.rating}</span>
              </span>
            )}
            <span className="flex items-center text-ink-600 font-mono text-xs">
              <span className="border-l border-ink-700 pl-3">{formatTimeControl(state)}</span>
            </span>
          </div>
        )}

        <PlayerBar name={boardOrientation === "white" ? blackName : whiteName} timeMs={boardOrientation === "white" ? displayTimes.black : displayTimes.white} active={state.turn === (boardOrientation === "white" ? "b" : "w")} />
        <div className="w-full max-w-[560px] my-3 relative">
          <Chessboard
            position={displayFen}
            onPieceDrop={onPieceDrop}
            onPieceDragBegin={onPieceDragBegin}
            onPieceDragEnd={onPieceDragEnd}
            onSquareClick={onSquareClick}
            onSquareRightClick={() => setPremove(null)}
            boardOrientation={boardOrientation}
            arePiecesDraggable={state.status === "active" && !isSpectator && !pendingPromotion && isLive}
            isDraggablePiece={({ piece }) => !isSpectator && piece[0] === (myColor === "white" ? "w" : "b")}
            customDarkSquareStyle={{ backgroundColor: "#7c6142" }}
            customLightSquareStyle={{ backgroundColor: "#e9ddc4" }}
            customSquareStyles={customSquareStyles}
            animationDuration={animMs}
          />

          {showBigOverlay && (
            <ResultOverlay
              state={state}
              myColor={myColor}
              user={user}
              ratingChanges={ratingChanges}
              opponentName={opponentInfo?.name}
              onDismiss={() => setOverlayDismissed(true)}
              onRematch={handleRematch}
              rematchStatus={rematchStatus}
            />
          )}
        </div>
        <PlayerBar name={boardOrientation === "white" ? whiteName : blackName} timeMs={boardOrientation === "white" ? displayTimes.white : displayTimes.black} active={state.turn === (boardOrientation === "white" ? "w" : "b")} />

        <div className="w-full max-w-[560px] mt-3 flex items-center gap-2 text-sm min-h-[2rem]">
          <div className="flex items-center gap-1" role="group" aria-label="Move navigation">
            <NavBtn label="First move" disabled={ply <= 0} onClick={() => goTo(0)}>⏮</NavBtn>
            <NavBtn label="Previous move" disabled={ply <= 0} onClick={() => goTo(ply - 1)}>◀</NavBtn>
            <NavBtn label="Next move" disabled={isLive} onClick={() => goTo(ply + 1)}>▶</NavBtn>
            <NavBtn label="Latest move" disabled={isLive} onClick={() => goTo(N)}>⏭</NavBtn>
          </div>
          {!isLive && (
            <div className="flex items-center gap-2 text-xs text-ink-600 min-w-0">
              <span>
                Viewing move {ply} of {N}
                {state.status === "active" && N > reviewBase ? ` · ${N - reviewBase} new` : ""}
                {state.status === "finished" ? ` · ${state.result?.reason === "aborted" ? "Game aborted" : state.result?.winner ? `${capitalize(state.result.winner)} won` : "Draw"} (${formatReason(state.result?.reason)})` : ""}
              </span>
              <button onClick={() => goTo(N)} className={`px-2 py-0.5 rounded border border-brass-500/50 text-brass-400 hover:bg-brass-500/10 ${myTurnNow ? "animate-pulse" : ""}`}>
                Live ▶
              </button>
              {myTurnNow && state.timeControlMinutes != null && <span className="text-ember-300">Your turn — your clock is running</span>}
            </div>
          )}
        </div>

        {engineThinking && (
          <p className="text-brass-400 text-sm mt-2 animate-pulse">
            {state.isVsBot ? `${state.botName || "The bot"} is thinking…` : "Checkm8 Bot is thinking…"}
          </p>
        )}
        {error && <p className="text-ember-300 text-sm mt-2">{error}</p>}

        {incomingRematch && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-brass-500/10 border border-brass-500/40 flex items-center gap-3 text-sm">
            <span>{incomingRematch.fromUsername} wants a rematch.</span>
            <button onClick={() => respondRematch(true)} className="px-3 py-1 rounded-md bg-brass-500 text-ink-950 font-bold">
              Accept
            </button>
            <button onClick={() => respondRematch(false)} className="px-3 py-1 rounded-md border border-ink-700">
              Decline
            </button>
          </div>
        )}

        {state.status === "finished" && overlayDismissed && !isSpectator && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-ink-800 border border-ink-700 text-center flex items-center gap-4">
            <p className="font-semibold">
              {state.result?.reason === "aborted" ? "Game aborted" : state.result?.winner ? `${capitalize(state.result.winner)} wins` : "Draw"} — {formatReason(state.result?.reason)}
            </p>
            {rematchStatus === "waiting" ? (
              <span className="text-brass-400 text-sm animate-pulse">Waiting for opponent…</span>
            ) : (
              <button onClick={handleRematch} className="px-3 py-1.5 rounded-md bg-brass-500 text-ink-950 font-bold text-sm">
                Rematch
              </button>
            )}
          </div>
        )}

        {state.status === "finished" && isSpectator && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-ink-800 border border-ink-700 text-center">
            <p className="font-semibold">
              {state.result?.reason === "aborted" ? "Game aborted" : state.result?.winner ? `${capitalize(state.result.winner)} wins` : "Draw"} — {formatReason(state.result?.reason)}
            </p>
          </div>
        )}

        {state.status === "active" && !isSpectator && (
          <button
            onClick={handleResign}
            disabled={resigning}
            className="mt-4 disabled:opacity-50 px-4 py-2 rounded-md border border-ember-600/40 text-ember-300 hover:bg-ember-600/10 transition-colors text-sm"
          >
            Resign
          </button>
        )}
      </div>

      <div className="flex flex-col gap-6 h-fit min-w-0">
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-4">
          <h3 className="font-semibold text-sm text-ink-600 mb-3">Moves</h3>
          <MoveList moves={state.moves} ply={ply} onSelect={goTo} />
        </div>
        {isPvp && !isSpectator && (
          <GameChat
            gameId={gameId}
            myUserId={user.userId}
            opponentName={opponentInfo?.name || "Opponent"}
            chat={chat}
            error={chatError}
            status={state.status}
            chatClosesAt={chatClosesAt}
            plies={N}
            onSend={sendChat}
            onOfferDraw={offerDraw}
            onRespondDraw={respondDraw}
            onCancelDraw={cancelDraw}
          />
        )}
      </div>

      {pendingPromotion && (
        <PromotionPicker color={pendingPromotion.color} onChoose={handlePromotionChoice} onCancel={handlePromotionCancel} />
      )}
    </div>
  );
}

const PROMOTION_PIECES = [
  { piece: "q", label: "Queen" },
  { piece: "r", label: "Rook" },
  { piece: "b", label: "Bishop" },
  { piece: "n", label: "Knight" },
];

const PROMOTION_GLYPH = {
  w: { q: "♕", r: "♖", b: "♗", n: "♘" },
  b: { q: "♛", r: "♜", b: "♝", n: "♞" },
};

function PromotionPicker({ color, onChoose, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-ink-800 border border-ink-700 rounded-xl max-w-xs w-full p-6 shadow-2xl">
        <h2 className="font-display text-lg font-semibold mb-1">Promote your pawn</h2>
        <p className="text-sm text-ink-600 mb-5">Choose which piece it becomes.</p>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {PROMOTION_PIECES.map(({ piece, label }) => (
            <button
              key={piece}
              onClick={() => onChoose(piece)}
              title={label}
              className="aspect-square flex items-center justify-center text-4xl rounded-lg border border-ink-700 bg-ink-900 hover:border-brass-500 hover:bg-brass-500/10 transition-colors"
            >
              {PROMOTION_GLYPH[color][piece]}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2 rounded-md border border-ink-700 hover:border-ink-600 transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResultOverlay({ state, myColor, user, ratingChanges, opponentName, onDismiss, onRematch, rematchStatus }) {
  const winner = state.result?.winner; // "white" | "black" | null (draw)
  const outcome = state.result?.reason === "aborted" ? "aborted" : !winner ? "draw" : winner === myColor ? "win" : "loss";
  const myRating = ratingChanges?.[user.userId];
  const delta = myRating ? myRating.after - myRating.before : null;

  const titleMap = { win: "You won", loss: "You lost", draw: "Draw", aborted: "Game aborted" };
  const titleColor = { win: "text-brass-400", loss: "text-ember-300", draw: "text-parchment", aborted: "text-parchment" };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/90 rounded-lg">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors text-lg"
        aria-label="Dismiss"
      >
        ×
      </button>
      <div className="text-center px-6">
        <h1 className={`font-display text-4xl sm:text-5xl font-semibold tracking-tight mb-3 ${titleColor[outcome]}`}>{titleMap[outcome]}</h1>
        <p className="text-ink-600 mb-1 text-sm">{formatReason(state.result?.reason)}</p>
        {outcome !== "draw" && outcome !== "aborted" && opponentName && (
          <p className="text-sm mb-4">
            {outcome === "win" ? "Opponent: " : "You lost to "}
            <span className="font-semibold">{opponentName}</span>
          </p>
        )}
        {myRating ? (
          <p className="font-mono text-lg mb-6">
            {myRating.before} → {myRating.after}{" "}
            <span className={delta > 0 ? "text-brass-400" : delta < 0 ? "text-ember-300" : "text-ink-600"}>
              ({delta > 0 ? "+" : ""}
              {delta})
            </span>
          </p>
        ) : (
          (state.isVsComputer || state.isVsBot) && (
            <p className="text-ink-600 text-sm mb-6">
              Unrated — {state.isVsBot ? "bot" : "computer"} games don't affect rating.
            </p>
          )
        )}
        {rematchStatus === "waiting" ? (
          <p className="text-brass-400 text-sm animate-pulse">Waiting for opponent…</p>
        ) : rematchStatus === "declined" ? (
          <p className="text-ink-600 text-sm">Rematch declined.</p>
        ) : (
          <button onClick={onRematch} className="px-6 py-2.5 rounded-md bg-brass-500 text-ink-950 font-bold hover:bg-brass-400 transition-colors">
            Rematch
          </button>
        )}
      </div>
    </div>
  );
}

function PlayerBar({ name, timeMs, active }) {
  return (
    <div className={`w-full max-w-[560px] flex items-center justify-between px-1 ${active ? "" : "opacity-70"}`}>
      <span className="font-medium text-sm">{name}</span>
      {timeMs != null && (
        <span
          className={`font-mono text-lg px-2.5 py-1 rounded-md ${
            active ? "bg-brass-500 text-ink-950 font-bold" : "bg-ink-800 text-ink-600"
          }`}
        >
          {formatClock(timeMs)}
        </span>
      )}
    </div>
  );
}

function NavBtn({ label, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 h-8 flex items-center justify-center rounded-md border border-ink-700 text-xs hover:border-brass-500 disabled:opacity-35 disabled:hover:border-ink-700 transition-colors"
    >
      {children}
    </button>
  );
}

function MoveList({ moves, ply, onSelect }) {
  const boxRef = useRef(null);
  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push([moves[i], moves[i + 1]]);
  }
  // Keep the viewed move visible by scrolling the list itself, never the page.
  useEffect(() => {
    const box = boxRef.current;
    const el = box && box.querySelector('[aria-current="true"]');
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top - 4;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 4;
  }, [ply, moves.length]);
  const cell = (m, idx) =>
    m ? (
      <button
        onClick={() => onSelect(idx + 1)}
        aria-current={ply === idx + 1 ? "true" : undefined}
        className={`flex-1 text-left px-1.5 rounded ${ply === idx + 1 ? "bg-brass-500/25 text-brass-400 font-semibold" : "hover:bg-ink-700/60"}`}
      >
        {m.san}
      </button>
    ) : (
      <span className="flex-1" />
    );
  return (
    <div ref={boxRef} className="relative font-mono text-sm max-h-[480px] overflow-y-auto scrollbar-thin">
      {pairs.length === 0 && <p className="text-ink-600 italic">No moves yet.</p>}
      {pairs.map(([w, b], i) => (
        <div key={i} className="flex gap-1 py-0.5">
          <span className="text-ink-600 w-6">{i + 1}.</span>
          {cell(w, i * 2)}
          {cell(b, i * 2 + 1)}
        </div>
      ))}
    </div>
  );
}

function nameFor(state, color, user) {
  const id = color === "white" ? state.whitePlayerId : state.blackPlayerId;
  if (id === user.userId) return `${user.username} (you)`;
  return "Opponent";
}

function formatClock(ms) {
  if (ms == null) return "--:--";
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimeControl(state) {
  if (state.timeControlMinutes == null) return "No clock";
  return `${state.timeControlMinutes} + ${state.incrementSeconds || 0}`;
}

function formatReason(reason) {
  return (
    {
      checkmate: "checkmate",
      stalemate: "stalemate",
      timeout: "timeout",
      resignation: "resignation",
      abandonment: "abandonment",
      threefold_repetition: "threefold repetition",
      draw: "draw",
      agreement: "draw by agreement",
      aborted: "aborted — no first move was made",
      bot_error: "bot error — the bot forfeited",
      bot_unavailable: "bot unavailable",
    }[reason] || reason
  );
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
