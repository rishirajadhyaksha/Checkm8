// Lazy Monaco loader. Only the Bot Lab pays for the editor download (it is a
// dynamic import), and only the features and languages the Lab needs are
// pulled in: core editor features, TypeScript/JavaScript, Python and Lua.
// Workers are bundled by Vite (no CDN), so the site works under a strict CSP.
import { typescriptDeclarations, methodName, signature } from "../libraryClient";

let monacoPromise = null;
const STATE = { spec: null };

export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const [monaco, editorWorker, tsWorker] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.api"),
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      ]);
      await import("monaco-editor/esm/vs/editor/editor.all");
      const tsContribution = await import("monaco-editor/esm/vs/language/typescript/monaco.contribution");
      await import("monaco-editor/esm/vs/basic-languages/python/python.contribution");
      await import("monaco-editor/esm/vs/basic-languages/lua/lua.contribution");
      self.MonacoEnvironment = {
        getWorker(_id, label) {
          return label === "typescript" || label === "javascript" ? new tsWorker.default() : new editorWorker.default();
        },
      };
      defineTheme(monaco);
      configureTypescript(tsContribution);
      return { monaco, tsContribution };
    })().catch((err) => {
      monacoPromise = null;
      throw err;
    });
  }
  return monacoPromise;
}

function defineTheme(monaco) {
  monaco.editor.defineTheme("checkm8-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "a89a80", fontStyle: "italic" },
      { token: "keyword", foreground: "c9a15a" },
      { token: "string", foreground: "e2a091" },
      { token: "number", foreground: "ddbd80" },
      { token: "type", foreground: "ddbd80" },
      { token: "identifier", foreground: "f1e9d6" },
    ],
    colors: {
      "editor.background": "#171209",
      "editor.foreground": "#f1e9d6",
      "editorLineNumber.foreground": "#6b5f4a",
      "editorLineNumber.activeForeground": "#c9a15a",
      "editor.lineHighlightBackground": "#211a10",
      "editor.selectionBackground": "#c9a15a40",
      "editorCursor.foreground": "#c9a15a",
      "editorWidget.background": "#211a10",
      "editorSuggestWidget.background": "#211a10",
      "editorSuggestWidget.border": "#332a1a",
      "editorSuggestWidget.selectedBackground": "#332a1a",
      "editorHoverWidget.background": "#211a10",
      "editorHoverWidget.border": "#332a1a",
      "editorIndentGuide.background1": "#332a1a",
      "scrollbarSlider.background": "#332a1a99",
    },
  });
  monaco.editor.defineTheme("checkm8-light", {
    base: "vs",
    inherit: true,
    rules: [{ token: "keyword", foreground: "93773f" }],
    colors: { "editor.background": "#f1e9d6" },
  });
}

function configureTypescript(tsContribution) {
  const { typescriptDefaults, javascriptDefaults, ScriptTarget } = tsContribution;
  for (const defaults of [typescriptDefaults, javascriptDefaults]) {
    defaults.setCompilerOptions({ target: ScriptTarget.ES2020, allowNonTsExtensions: true, noLib: false, strict: false });
    defaults.setDiagnosticsOptions({ noSemanticValidation: defaults === javascriptDefaults, noSyntaxValidation: false });
  }
}

let libsInstalled = false;
// Install the spec-derived completions, hovers and type declarations once.
export function installLibrary({ monaco, tsContribution }, spec) {
  if (libsInstalled || !spec) return;
  libsInstalled = true;
  STATE.spec = spec;
  const dts = typescriptDeclarations(spec);
  tsContribution.typescriptDefaults.addExtraLib(dts, "file:///chess-library.d.ts");
  tsContribution.javascriptDefaults.addExtraLib(dts, "file:///chess-library.d.ts");

  for (const language of ["python", "lua"]) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ["."],
      provideCompletionItems(model, position) {
        const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const K = monaco.languages.CompletionItemKind;
        if (/\bchess\.\w*$/.test(before)) {
          return {
            suggestions: spec.methods.map((m) => ({
              label: methodName(m, language),
              kind: K.Method,
              detail: signature(m, language),
              documentation: { value: `${m.description}\n\nReturns \`${m.returns}\`` },
              insertText: `${methodName(m, language)}(${m.args.map((a, i) => "${" + (i + 1) + ":" + a.name + "}").join(", ")})`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
          };
        }
        const utils = spec.utilities.map((u) => ({ label: u.name, kind: K.Function, detail: u.description, insertText: u.name, range }));
        return { suggestions: [{ label: "chess", kind: K.Module, detail: "Built-in chess library", insertText: "chess", range }, ...utils] };
      },
    });
    monaco.languages.registerHoverProvider(language, {
      provideHover(model, position) {
        const w = model.getWordAtPosition(position);
        if (!w) return null;
        const m = spec.methods.find((x) => methodName(x, language) === w.word);
        if (!m) return null;
        return {
          range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
          contents: [{ value: "```\n" + signature(m, language) + "\n```" }, { value: `${m.description}\n\nReturns \`${m.returns}\`` }],
        };
      },
    });
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp(model, position) {
        const text = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const m = /chess\.(\w+)\(([^()]*)$/.exec(text);
        if (!m) return null;
        const method = spec.methods.find((x) => methodName(x, language) === m[1]);
        if (!method) return null;
        const active = (m[2].match(/,/g) || []).length;
        return {
          value: {
            signatures: [{ label: signature(method, language), documentation: method.description, parameters: method.args.map((a) => ({ label: a.name, documentation: a.type })) }],
            activeSignature: 0,
            activeParameter: Math.min(active, method.args.length - 1),
          },
          dispose() {},
        };
      },
    });
  }
}

export const MONACO_LANGUAGE = { javascript: "javascript", typescript: "typescript", python: "python", lua: "lua" };
export const FILE_EXT = { javascript: "js", typescript: "ts", python: "py", lua: "lua" };
