import React, { useEffect, useMemo, useRef, useState } from "react";

const MAX_LEN = 200;

function lsGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

// PvP chat panel. Draw offers are chat entries (kind "draw_offer") rendered as cards.
export default function GameChat({
  gameId,
  myUserId,
  opponentName,
  chat,
  error,
  status, // "active" | "finished"
  chatClosesAt,
  plies,
  onSend,
  onOfferDraw,
  onRespondDraw,
  onCancelDraw,
}) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(() => lsGet(`c8mute:${gameId}`) === "1");
  const [unread, setUnread] = useState(0);
  const listRef = useRef(null);
  const seenRef = useRef(null); // highest message id seen while open
  const openRef = useRef(open);
  openRef.current = open;

  const pending = useMemo(() => chat.find((m) => m.kind === "draw_offer" && m.status === "pending") || null, [chat]);
  const visible = useMemo(() => chat.filter((m) => !(muted && m.kind === "chat" && m.userId !== myUserId)), [chat, muted, myUserId]);
  const closed = status !== "active" && !(chatClosesAt && Date.now() < chatClosesAt);

  // Unread dot while collapsed; an incoming offer expands the panel.
  const lastId = chat.length ? chat[chat.length - 1].id : 0;
  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = lastId;
      return;
    }
    if (lastId > seenRef.current) {
      const fresh = chat.filter((m) => m.id > seenRef.current && m.userId !== myUserId && !(muted && m.kind === "chat"));
      seenRef.current = lastId;
      if (fresh.some((m) => m.kind === "draw_offer" && m.status === "pending")) setOpen(true);
      else if (!openRef.current && fresh.length) setUnread((n) => n + fresh.length);
    }
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, open]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    lsSet(`c8mute:${gameId}`, next ? "1" : "0");
  }

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  const canOffer = status === "active" && !pending && plies >= 4;
  const offerTip = status !== "active" ? "The game is over" : pending ? "A draw offer is already open" : plies < 4 ? "Draw offers open after two moves each" : "Offer a draw";

  return (
    <div className="bg-ink-800 border border-ink-700 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-ink-600 hover:text-parchment" aria-expanded={open}>
          <span>Chat</span>
          {!open && unread > 0 && <span className="w-2 h-2 rounded-full bg-brass-500" aria-label={`${unread} unread`} />}
          <span className="text-xs">{open ? "▾" : "▸"}</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onOfferDraw}
            disabled={!canOffer}
            title={offerTip}
            className="text-xs px-2.5 py-1 rounded-md border border-ink-700 hover:border-brass-500 disabled:opacity-40 disabled:hover:border-ink-700 transition-colors"
          >
            ½ Offer draw
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-ink-700">
          <div ref={listRef} className="px-4 py-3 max-h-64 min-h-[7rem] overflow-y-auto scrollbar-thin space-y-2 text-sm" aria-live="polite">
            {visible.length === 0 && <p className="text-ink-600 italic">{closed ? "No messages." : "Say hello to your opponent."}</p>}
            {visible.map((m) =>
              m.kind === "draw_offer" ? (
                <OfferCard key={m.id} m={m} mine={m.userId === myUserId} opponentName={opponentName} gameActive={status === "active"} onRespond={onRespondDraw} onCancel={onCancelDraw} />
              ) : (
                <p key={m.id} className="break-words">
                  <span className={`font-semibold ${m.userId === myUserId ? "text-brass-400" : "text-parchment"}`}>{m.userId === myUserId ? "You" : opponentName}</span>
                  <span className="text-ink-600">: </span>
                  <span>{m.text}</span>
                </p>
              )
            )}
          </div>
          {error && <p className="px-4 pb-2 text-xs text-ember-300">{error}</p>}
          {closed ? (
            <p className="px-4 pb-3 text-xs text-ink-600">Chat is closed for this game.</p>
          ) : (
            <form onSubmit={submit} className="px-3 pb-3 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                placeholder="Message…"
                maxLength={MAX_LEN}
                aria-label="Chat message"
                className="flex-1 min-w-0 bg-ink-900 border border-ink-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-brass-500"
              />
              <button type="submit" className="px-3 py-1.5 rounded-md bg-brass-500 text-ink-950 font-bold text-sm disabled:opacity-40" disabled={!text.trim()}>
                Send
              </button>
            </form>
          )}
          <div className="px-4 pb-3 -mt-1">
            <button onClick={toggleMute} className="text-[11px] text-ink-600 hover:text-parchment underline-offset-2 hover:underline">
              {muted ? "Unmute opponent" : "Mute opponent"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT = {
  accepted: "accepted — draw by agreement",
  declined: "declined",
  cancelled: "withdrawn",
  expired: "expired",
};

function OfferCard({ m, mine, opponentName, gameActive, onRespond, onCancel }) {
  const who = mine ? "You offered a draw" : `${opponentName} offers a draw`;
  if (m.status !== "pending" || !gameActive) {
    return (
      <p className="text-xs text-ink-600 italic border-l-2 border-ink-700 pl-2">
        ½ {who} — {STATUS_TEXT[m.status] || "expired"}
      </p>
    );
  }
  return (
    <div className="rounded-md border border-brass-500/40 bg-brass-500/10 px-3 py-2">
      <p className="text-sm font-semibold">½ {who}</p>
      {mine ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs text-ink-600">Waiting for a reply…</span>
          <button onClick={() => onCancel(m.id)} className="text-xs px-2.5 py-1 rounded-md border border-ink-700 hover:border-ink-600">
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button onClick={() => onRespond(m.id, true)} className="text-xs px-3 py-1 rounded-md bg-brass-500 text-ink-950 font-bold">
            Accept
          </button>
          <button onClick={() => onRespond(m.id, false)} className="text-xs px-3 py-1 rounded-md border border-ink-700 hover:border-ink-600">
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
