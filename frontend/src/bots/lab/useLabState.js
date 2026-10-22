import { useConfirm } from "../../components/ConfirmDialog";
// All Bot Lab state in one hook: the open bot, dirty/draft tracking, save /
// publish flows, and both ways of running a bot (in-browser Worker, server
// sandbox). Existing API calls and publish semantics are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { api } from "../../api";
import { loadLabData, SAMPLE_POSITIONS, tryItCode } from "../libraryClient";

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode / blocked storage: drafts are a convenience only */
  }
};
const lsDel = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};
const draftKey = (botId, language) => `c8lab:draft:${botId || "new"}:${language}`;

export function buildState(fen) {
  const chess = new Chess(fen);
  return {
    fen,
    legalMoves: chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`),
    turn: chess.turn(),
    timeRemainingMs: 60_000,
    incrementMs: 0,
    history: [],
  };
}

const BLANK = (language, code) => ({ botId: null, name: "My Bot", language, code, status: null });

export default function useLabState() {
  const { confirm } = useConfirm();
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState("");
  const [myBots, setMyBots] = useState([]);
  const [loadingBots, setLoadingBots] = useState(true);
  const [botsError, setBotsError] = useState("");

  const [current, setCurrent] = useState(BLANK("javascript", ""));
  const [savedCode, setSavedCode] = useState("");
  const [savedLanguage, setSavedLanguage] = useState("javascript");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [draftBanner, setDraftBanner] = useState(null);

  const [fen, setFen] = useState(SAMPLE_POSITIONS.start.fen);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [consoleTab, setConsoleTab] = useState("test");
  const [tryResult, setTryResult] = useState(null);
  const workerTimerRef = useRef(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  // ---- load reference data, bots ----
  useEffect(() => {
    loadLabData()
      .then((d) => {
        setData(d);
        setCurrent((c) => (c.code ? c : { ...c, code: d.templates.javascript.random }));
      })
      .catch((err) => setDataError(err.message));
  }, []);

  const refreshBots = useCallback(() => {
    setLoadingBots(true);
    return api
      .botsMine()
      .then((bots) => {
        setMyBots(bots);
        setBotsError("");
        return bots;
      })
      .catch((err) => setBotsError(err.message))
      .finally(() => setLoadingBots(false));
  }, []);
  useEffect(() => {
    refreshBots();
  }, [refreshBots]);

  // ---- unsaved drafts (localStorage, per bot + language) ----
  useEffect(() => {
    if (!current.code) return;
    const t = setTimeout(() => {
      if (dirty) lsSet(draftKey(current.botId, current.language), current.code);
    }, 400);
    return () => clearTimeout(t);
  }, [current.code, current.botId, current.language, dirty]);

  const offerDraft = useCallback((botId, language, code) => {
    const draft = lsGet(draftKey(botId, language));
    setDraftBanner(draft && draft !== code ? { botId, language, code: draft } : null);
  }, []);

  const resetRunState = () => {
    setResult(null);
    setError("");
    setNote("");
    setTryResult(null);
  };

  const openBot = useCallback(
    async (bot) => {
      try {
        const full = bot.code != null ? bot : await api.getBot(bot.botId);
        const language = full.language || "javascript";
        setCurrent({ botId: full.botId, name: full.name, language, code: full.code, status: full.status });
        setSavedCode(full.code);
        setSavedLanguage(language);
        setDirty(false);
        resetRunState();
        offerDraft(full.botId, language, full.code);
      } catch (err) {
        setError(err.message);
      }
    },
    [offerDraft]
  );

  const newBot = useCallback(
    (language = "javascript") => {
      const code = data ? data.templates[language].random : "";
      setCurrent(BLANK(language, code));
      setSavedCode("");
      setSavedLanguage(language);
      setDirty(false);
      resetRunState();
      offerDraft(null, language, code);
    },
    [data, offerDraft]
  );

  const restoreDraft = () => {
    if (!draftBanner) return;
    setCurrent((c) => ({ ...c, code: draftBanner.code }));
    setDirty(true);
    setDraftBanner(null);
  };
  const discardDraft = () => {
    if (draftBanner) lsDel(draftKey(draftBanner.botId, draftBanner.language));
    setDraftBanner(null);
  };

  const setCode = useCallback((code) => {
    setCurrent((c) => ({ ...c, code }));
    setDirty(true);
    setNote("");
  }, []);
  const setName = useCallback((name) => {
    setCurrent((c) => ({ ...c, name }));
    setDirty(true);
    setNote("");
  }, []);

  const isPristine = useCallback(
    (code, language) => !code.trim() || (data && Object.values(data.templates[language] || {}).includes(code)),
    [data]
  );

  const changeLanguage = useCallback(
    async (language) => {
      const c = currentRef.current;
      if (language === c.language || !data) return;
      const pristine = isPristine(c.code, c.language);
      if (!pristine) {
        const label = data.languages.find((l) => l.id === language)?.label || language;
        const ok = await confirm({ title: `Switch to ${label}?`, body: `Your current code is replaced by the ${label} starter (it stays in a draft if you switch back).`, confirmLabel: "Switch" });
        if (!ok) return;
        lsSet(draftKey(c.botId, c.language), c.code);
      }
      const stored = lsGet(draftKey(c.botId, language));
      const code = !pristine && stored ? stored : data.templates[language].random;
      setCurrent({ ...c, language, code });
      setDirty(true);
      setResult(null);
    },
    [data, isPristine, confirm]
  );

  const insertTemplate = useCallback(async (code) => {
    if (!isPristine(currentRef.current.code, currentRef.current.language) && !(await confirm({ title: "Replace the editor contents?", body: "The editor will be replaced with this example.", confirmLabel: "Replace" }))) return;
    setCurrent((c) => ({ ...c, code }));
    setDirty(true);
  }, [isPristine, confirm]);

  // ---- save / publish ----
  const save = useCallback(async () => {
    const c = currentRef.current;
    setError("");
    setNote("");
    setSaving(true);
    try {
      if (!c.name.trim()) throw new Error("Give your bot a name first.");
      const wasLive = c.status === "published" || c.status === "calibrating";
      const saved = c.botId ? await api.updateBot(c.botId, { name: c.name, code: c.code, language: c.language }) : await api.createBot(c.name, c.code, c.language);
      setCurrent({ botId: saved.botId, name: saved.name, language: saved.language || c.language, code: saved.code, status: saved.status });
      setSavedCode(saved.code);
      setSavedLanguage(saved.language || c.language);
      setDirty(false);
      lsDel(draftKey(c.botId, c.language));
      lsDel(draftKey(null, c.language));
      setNote(
        c.botId && saved.status === "calibrating" && wasLive
          ? "Saved. Editing a published bot resets its rating and re-runs the calibration gauntlet."
          : "Saved."
      );
      refreshBots();
      return saved;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [refreshBots]);

  const publish = useCallback(async () => {
    const c = currentRef.current;
    if (!(await confirm({ title: "Publish this bot?", body: "It runs a smoke test, then plays a calibration gauntlet before it is ranked.", confirmLabel: "Publish" }))) return;
    setError("");
    setNote("");
    setPublishing(true);
    try {
      let botId = c.botId;
      if (!botId || dirty) {
        const saved = await save();
        if (!saved) return;
        botId = saved.botId;
      }
      const published = await api.publishBot(botId);
      setCurrent((x) => ({ ...x, status: published.status }));
      setNote(
        published.status === "calibrating"
          ? "Submitted for calibration. It plays a gauntlet against Checkm8's built-in engines, then appears on the leaderboard."
          : "Published! It can now be challenged from the Bot Arena."
      );
      refreshBots();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }, [dirty, save, refreshBots, confirm]);

  const unpublish = useCallback(
    async (bot) => {
      try {
        await api.unpublishBot(bot.botId);
        if (currentRef.current.botId === bot.botId) setCurrent((c) => ({ ...c, status: "draft" }));
        refreshBots();
      } catch (err) {
        setError(err.message);
      }
    },
    [refreshBots]
  );

  const deleteBot = useCallback(
    async (bot) => {
      if (!(await confirm({ title: `Delete "${bot.name}"?`, body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
      try {
        await api.deleteBot(bot.botId);
        if (currentRef.current.botId === bot.botId) newBot(currentRef.current.language);
        refreshBots();
      } catch (err) {
        setError(err.message);
      }
    },
    [refreshBots, newBot, confirm]
  );

  const toggleFlagship = useCallback(
    async (bot) => {
      try {
        await api.setBotFlagship(bot.botId, !bot.isFlagship);
        refreshBots();
      } catch (err) {
        setError(err.message);
      }
    },
    [refreshBots]
  );

  // ---- running ----
  const runWorker = useCallback(
    (language, code, stateForRun, { timeoutMs } = {}) =>
      new Promise((resolve) => {
        const jobId = Math.random().toString(36).slice(2);
        const worker = new Worker(new URL("../botSandbox.worker.js", import.meta.url), { type: "module" });
        const timeout = timeoutMs || (language === "lua" || language === "python" ? 8000 : 3000);
        const finish = (r) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(r);
        };
        const timer = setTimeout(() => finish({ ok: false, reason: "The local sandbox didn't answer in time and was stopped." }), timeout);
        worker.onmessage = (e) => e.data && e.data.jobId === jobId && finish(e.data.result);
        worker.onerror = () => finish({ ok: false, reason: "The local sandbox crashed unexpectedly." });
        worker.postMessage({ jobId, language, code, state: stateForRun, seed: 12345, spec: data.spec, preludes: data.preludes, deadlineMs: 1500 });
      }),
    [data]
  );

  const finishRun = (r, source, stateForRun) => {
    let out = { ...r, source };
    if (out.ok) {
      try {
        const chess = new Chess(stateForRun.fen);
        const mv = chess.moves({ verbose: true }).find((m) => `${m.from}${m.to}${m.promotion || ""}` === out.move);
        if (!mv) out = { ok: false, source, reason: `Your bot returned "${out.move}", which is not a legal move in this position.`, logs: out.logs };
        else out.san = mv.san;
      } catch {
        /* position was validated earlier */
      }
    }
    setResult(out);
    setConsoleTab(out.ok ? "result" : "result");
  };

  const run = useCallback(
    async (where = "browser") => {
      if (!data || running) return;
      const c = currentRef.current;
      let stateForRun;
      try {
        stateForRun = buildState(fen);
      } catch {
        setResult({ ok: false, source: where, reason: "The test position isn't valid. Fix it on the Test case tab." });
        setConsoleTab("result");
        return;
      }
      setRunning(true);
      setResult(null);
      try {
        if (where === "server") {
          const r = await api.botTestRun(c.code, undefined, c.language, fen);
          finishRun(r, "server", stateForRun);
        } else {
          const r = await runWorker(c.language, c.code, stateForRun);
          finishRun(r, "browser", stateForRun);
        }
      } catch (err) {
        finishRun({ ok: false, reason: err.message }, where, stateForRun);
      } finally {
        setRunning(false);
      }
    },
    [data, fen, running, runWorker]
  );

  const tryMethod = useCallback(
    async (method) => {
      if (!data) return;
      const c = currentRef.current;
      let st;
      try {
        st = buildState(fen);
      } catch {
        setTryResult({ key: method.name, text: "The test position isn't valid." });
        return;
      }
      if (!st.legalMoves.length) {
        setTryResult({ key: method.name, text: "This position has no legal moves, so there is nothing to try against." });
        return;
      }
      const language = c.language === "typescript" ? "javascript" : c.language;
      const r = await runWorker(language, tryItCode(method, language, { fen, turn: st.turn, firstMove: st.legalMoves[0] }), st, {});
      setTryResult({ key: method.name, text: r.ok ? (r.logs && r.logs[0]) || "(no output)" : r.reason });
    },
    [data, fen, runWorker]
  );

  const status = useMemo(() => {
    if (saving) return "Saving…";
    if (current.status === "calibrating") return "Calibrating";
    return dirty || !current.botId ? "Unsaved" : "Saved";
  }, [saving, dirty, current.status, current.botId]);

  return {
    data, dataError, myBots, loadingBots, botsError, current, dirty, saving, publishing, error, note, status,
    draftBanner, fen, setFen, result, running, consoleTab, setConsoleTab, tryResult,
    openBot, newBot, setCode, setName, changeLanguage, insertTemplate, save, publish, unpublish, deleteBot,
    toggleFlagship, run, tryMethod, restoreDraft, discardDraft, savedCode, savedLanguage,
  };
}
