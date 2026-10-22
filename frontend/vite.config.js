import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Bot Arena's local-test sandbox worker (src/bots/botSandbox.worker.js)
  // pulls in quickjs-emscripten, which needs its own chunk for the WASM
  // asset — that requires the worker bundle to be built as an ES module
  // rather than Vite's default IIFE, which doesn't support code-splitting.
  worker: {
    format: "es",
  },
  // MicroPython's loader uses top-level await; ES2022 is supported by every
  // browser the site targets (Chrome/Edge 89+, Firefox 89+, Safari 15+).
  build: {
    target: "es2022",
  },
  esbuild: {
    target: "es2022",
  },
  optimizeDeps: {
    esbuildOptions: { target: "es2022" },
  },
});
