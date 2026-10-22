// Monaco editor pane (lazy-loaded). Falls back to a plain textarea if Monaco
// cannot load (offline, blocked worker, very old browser) so the Lab always works.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadMonaco, installLibrary, MONACO_LANGUAGE, FILE_EXT } from "./monacoSetup";

const EditorPane = forwardRef(function EditorPane({ language, value, onChange, spec, light, onRun, onSave, onPublish }, ref) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const modelRef = useRef(null);
  const applyingRef = useRef(false);
  const handlersRef = useRef({});
  const valueRef = useRef(value);
  valueRef.current = value;
  handlersRef.current = { onChange, onRun, onSave, onPublish };
  const [state, setState] = useState("loading"); // loading | ready | failed

  useImperativeHandle(ref, () => ({
    insertAtCursor(text) {
      const ed = editorRef.current;
      if (!ed) return false;
      ed.focus();
      const sel = ed.getSelection();
      ed.executeEdits("lab-insert", [{ range: sel, text, forceMoveMarkers: true }]);
      return true;
    },
    focus() {
      editorRef.current && editorRef.current.focus();
    },
  }));

  // create the editor once
  useEffect(() => {
    let disposed = false;
    loadMonaco()
      .then((mod) => {
        if (disposed || !hostRef.current) return;
        const { monaco } = mod;
        monacoRef.current = mod;
        if (spec) installLibrary(mod, spec);
        const model = monaco.editor.createModel(valueRef.current, MONACO_LANGUAGE[language], monaco.Uri.parse(`file:///bot.${FILE_EXT[language]}`));
        modelRef.current = model;
        const editor = monaco.editor.create(hostRef.current, {
          model,
          theme: light ? "checkm8-light" : "checkm8-dark",
          automaticLayout: true,
          fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
          fontSize: 13.5,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          bracketPairColorization: { enabled: true },
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          parameterHints: { enabled: true },
          quickSuggestions: { other: true, comments: false, strings: false },
        });
        editorRef.current = editor;
        editor.onDidChangeModelContent(() => {
          if (applyingRef.current) return;
          handlersRef.current.onChange(editor.getValue());
        });
        const mod2 = monaco.KeyMod;
        editor.addCommand(mod2.CtrlCmd | monaco.KeyCode.Enter, () => handlersRef.current.onRun && handlersRef.current.onRun());
        editor.addCommand(mod2.CtrlCmd | monaco.KeyCode.KeyS, () => handlersRef.current.onSave && handlersRef.current.onSave());
        editor.addCommand(mod2.CtrlCmd | mod2.Shift | monaco.KeyCode.Enter, () => handlersRef.current.onPublish && handlersRef.current.onPublish());
        setState("ready");
      })
      .catch(() => !disposed && setState("failed"));
    return () => {
      disposed = true;
      if (editorRef.current) editorRef.current.dispose();
      if (modelRef.current) modelRef.current.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // library spec arrives after the editor
  useEffect(() => {
    if (spec && monacoRef.current) installLibrary(monacoRef.current, spec);
  }, [spec, state]);

  // language switch: new model with the right URI/language, same text
  useEffect(() => {
    const mod = monacoRef.current;
    const editor = editorRef.current;
    if (!mod || !editor) return;
    const { monaco } = mod;
    const old = modelRef.current;
    const model = monaco.editor.createModel(valueRef.current, MONACO_LANGUAGE[language], monaco.Uri.parse(`file:///bot.${FILE_EXT[language]}`));
    applyingRef.current = true;
    editor.setModel(model);
    applyingRef.current = false;
    modelRef.current = model;
    if (old && old !== model) old.dispose();
  }, [language]);

  // external value changes (load bot, insert example, restore draft)
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      applyingRef.current = true;
      editor.setValue(value);
      applyingRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const mod = monacoRef.current;
    if (mod) mod.monaco.editor.setTheme(light ? "checkm8-light" : "checkm8-dark");
  }, [light]);

  if (state === "failed") {
    return (
      <div className="h-full flex flex-col">
        <p className="text-xs text-ember-300 px-3 py-1.5 border-b border-ink-700">The code editor couldn't load, so you're on the basic editor.</p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full font-mono text-sm bg-ink-900 text-parchment p-3 focus:outline-none resize-none"
        />
      </div>
    );
  }

  return (
    <div className="h-full relative bg-ink-900">
      <div ref={hostRef} className="absolute inset-0" />
      {state === "loading" && (
        <div className="absolute inset-0 p-4 animate-pulse flex flex-col gap-2" aria-label="Loading editor">
          {[60, 80, 45, 70, 30, 55, 65].map((w, i) => (
            <div key={i} className="h-3 rounded bg-ink-800" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
});

export default EditorPane;
