// The Bot Lab IDE: toolbar on top; bots rail | reference pane | editor over
// console. Panes are draggable and their sizes persist (react-resizable-panels
// stores them in localStorage). Under 900 px everything becomes tabs.
import React, { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import EditorPane from "./EditorPane";
import ConsolePane from "./ConsolePane";
import DocsPane from "./DocsPane";
import BotsDrawer from "./BotsDrawer";
import useLabState from "./useLabState";

function useNarrow() {
  const q = "(max-width: 899px)";
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

function Handle({ vertical }) {
  return (
    <PanelResizeHandle className={`group relative ${vertical ? "h-1.5" : "w-1.5"} bg-ink-900 hover:bg-brass-500/30 data-[resize-handle-state=drag]:bg-brass-500/50 transition-colors`}>
      <span className={`absolute ${vertical ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-0.5" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-0.5"} bg-ink-700 group-hover:bg-brass-500 rounded`} />
    </PanelResizeHandle>
  );
}

const READY_LANG_LABEL = (l) => l.label + (l.beta ? " (beta)" : "") + (l.enabled === false ? " (off)" : "");

export default function LabLayout() {
  const lab = useLabState();
  const { data, current, status } = lab;
  const editorRef = useRef(null);
  const narrow = useNarrow();
  const [mobileTab, setMobileTab] = useState("code");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [light, setLight] = useState(false);
  const [runMenu, setRunMenu] = useState(false);

  const langInfo = data && data.languages.find((l) => l.id === current.language);
  const langDisabled = langInfo && langInfo.enabled === false;

  const toolbar = (
    <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 bg-ink-800 overflow-x-auto">
      <button
        onClick={() => setDrawerOpen((o) => !o)}
        className={`hidden md:inline-flex items-center justify-center w-8 h-8 rounded-md border text-sm ${drawerOpen ? "border-brass-500/50 text-brass-400" : "border-ink-700 text-ink-600"} hover:border-brass-500 transition-colors`}
        title="Toggle My bots"
        aria-label="Toggle my bots"
      >
        ☰
      </button>
      <input
        value={current.name}
        onChange={(e) => lab.setName(e.target.value)}
        maxLength={60}
        aria-label="Bot name"
        className="min-w-[120px] w-44 text-sm font-medium bg-ink-900 border border-ink-700 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-brass-500"
      />
      <select
        value={current.language}
        onChange={(e) => lab.changeLanguage(e.target.value)}
        aria-label="Language"
        className="text-sm bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 focus:outline-none focus:border-brass-500"
      >
        {(data ? data.languages : [{ id: "javascript", label: "JavaScript" }]).map((l) => (
          <option key={l.id} value={l.id}>
            {READY_LANG_LABEL(l)}
          </option>
        ))}
      </select>
      <span
        className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${
          status === "Saved" ? "border-ink-700 text-ink-600" : status === "Calibrating" ? "border-brass-500/50 text-brass-400 animate-pulse" : "border-brass-500/50 text-brass-300"
        }`}
      >
        {status}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => setLight((l) => !l)} className="text-xs px-2 py-1.5 rounded-md border border-ink-700 text-ink-600 hover:text-parchment hidden sm:block" title="Editor theme">
          {light ? "Dark" : "Light"}
        </button>
        <div className="relative flex">
          <button
            onClick={() => lab.run("browser")}
            disabled={lab.running || !data}
            title="Run in your browser (Ctrl/Cmd + Enter)"
            className="px-3.5 py-1.5 rounded-l-md bg-brass-500 text-ink-950 text-sm font-bold hover:bg-brass-400 transition-colors disabled:opacity-50"
          >
            ▶ Run
          </button>
          <button
            onClick={() => setRunMenu((o) => !o)}
            disabled={!data}
            className="px-1.5 rounded-r-md bg-brass-500 text-ink-950 border-l border-ink-950/30 hover:bg-brass-400 disabled:opacity-50"
            aria-label="Run options"
          >
            ▾
          </button>
          {runMenu && (
            <div className="absolute right-0 top-9 z-30 w-56 bg-ink-800 border border-ink-700 rounded-md shadow-xl text-xs overflow-hidden" onMouseLeave={() => setRunMenu(false)}>
              <button className="w-full text-left px-3 py-2 hover:bg-ink-700" onClick={() => { setRunMenu(false); lab.run("browser"); }}>
                Run in browser <span className="text-ink-600">· instant, free</span>
              </button>
              <button className="w-full text-left px-3 py-2 hover:bg-ink-700" onClick={() => { setRunMenu(false); lab.run("server"); }}>
                Run on server <span className="text-ink-600">· the real sandbox</span>
              </button>
            </div>
          )}
        </div>
        <button onClick={lab.save} disabled={lab.saving || (!lab.dirty && !!current.botId)} className="px-3 py-1.5 rounded-md border border-ink-700 text-sm hover:border-brass-500 hover:text-brass-400 transition-colors disabled:opacity-40" title="Save (Ctrl/Cmd + S)">
          Save
        </button>
        {current.status === "calibrating" ? (
          <span className="px-3 py-1.5 rounded-md border border-brass-500/40 text-brass-400 text-sm animate-pulse">Calibrating…</span>
        ) : current.status === "published" && !lab.dirty ? (
          <span className="px-3 py-1.5 rounded-md border border-brass-500/40 text-brass-400 text-sm">Published</span>
        ) : (
          <button onClick={lab.publish} disabled={lab.publishing || langDisabled} className="px-3 py-1.5 rounded-md border border-brass-500 text-brass-400 text-sm hover:bg-brass-500/10 transition-colors disabled:opacity-40" title="Publish (Ctrl/Cmd + Shift + Enter)">
            {lab.publishing ? "Publishing…" : "Publish"}
          </button>
        )}
      </div>
    </div>
  );

  const banners = (
    <>
      {lab.draftBanner && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 text-xs bg-brass-500/10 border-b border-brass-500/30 text-brass-300">
          <span>We found an unsaved draft of this bot from earlier.</span>
          <button onClick={lab.restoreDraft} className="underline">Restore</button>
          <button onClick={lab.discardDraft} className="underline text-ink-600">Discard</button>
        </div>
      )}
      {(lab.error || lab.note || lab.dataError || langDisabled) && (
        <div className={`shrink-0 px-3 py-1.5 text-xs border-b ${lab.error || lab.dataError || langDisabled ? "text-ember-300 border-ember-600/30 bg-ember-600/10" : "text-brass-300 border-ink-700 bg-ink-800"}`}>
          {lab.error || lab.dataError || (langDisabled ? `${langInfo.label} is temporarily switched off on the server. You can still write and run it in your browser.` : lab.note)}
        </div>
      )}
    </>
  );

  const editor = (
    <EditorPane
      ref={editorRef}
      language={current.language}
      value={current.code}
      onChange={lab.setCode}
      spec={data && data.spec}
      light={light}
      onRun={() => lab.run("browser")}
      onSave={lab.save}
      onPublish={lab.publish}
    />
  );
  const consolePane = <ConsolePane fen={lab.fen} onFenChange={lab.setFen} result={lab.result} running={lab.running} activeTab={lab.consoleTab} onTab={lab.setConsoleTab} />;
  const docs = (
    <DocsPane
      data={data}
      language={current.language}
      onInsert={(text) => editorRef.current && editorRef.current.insertAtCursor(text)}
      onTry={lab.tryMethod}
      onInsertTemplate={lab.insertTemplate}
      tryResult={lab.tryResult}
    />
  );
  const drawer = (
    <BotsDrawer
      bots={lab.myBots}
      loading={lab.loadingBots}
      error={lab.botsError}
      currentId={current.botId}
      dirty={lab.dirty}
      onOpen={lab.openBot}
      onNew={() => lab.newBot(current.language)}
      onFlagship={lab.toggleFlagship}
      onUnpublish={lab.unpublish}
      onDelete={lab.deleteBot}
    />
  );

  if (narrow) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {toolbar}
        {banners}
        <div className="flex-1 min-h-0">
          {mobileTab === "docs" && docs}
          {mobileTab === "code" && editor}
          {mobileTab === "console" && consolePane}
          {mobileTab === "bots" && drawer}
        </div>
        <div className="shrink-0 flex border-t border-ink-700 bg-ink-800 text-sm" role="tablist">
          {[["bots", "Bots"], ["docs", "Docs"], ["code", "Code"], ["console", "Console"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)} className={`flex-1 py-2.5 ${mobileTab === id ? "text-brass-300 border-t-2 border-brass-500 -mt-px" : "text-ink-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {toolbar}
      {banners}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" autoSaveId="c8lab-h">
          {drawerOpen && (
            <>
              <Panel id="bots" order={1} defaultSize={16} minSize={11} maxSize={28}>
                {drawer}
              </Panel>
              <Handle />
            </>
          )}
          <Panel id="docs" order={2} defaultSize={30} minSize={18}>
            {docs}
          </Panel>
          <Handle />
          <Panel id="work" order={3} defaultSize={54} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="c8lab-v">
              <Panel id="editor" order={1} defaultSize={64} minSize={25}>
                {editor}
              </Panel>
              <Handle vertical />
              <Panel id="console" order={2} defaultSize={36} minSize={14}>
                {consolePane}
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
