/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // A warm, ink-toned dark base (not flat neutral gray) with a
        // brass/gold accent pulled from engraved chess clocks and trophy
        // plates, instead of the generic near-black + single neon accent.
        ink: {
          950: "#100d09",
          900: "#171209",
          800: "#211a10",
          700: "#332a1a",
          // Muted warm gray for secondary text — kept readable (not the
          // too-dark #3d3d3d trap) against every ink surface in the app.
          600: "#a89a80",
        },
        brass: {
          500: "#c9a15a",
          400: "#ddbd80",
          dim: "#93773f",
        },
        ember: {
          600: "#b5432f",
          500: "#c85a3f",
          300: "#e2a091",
        },
        // Real wood-board tones instead of the ubiquitous lichess green.
        board: {
          light: "#e9ddc4",
          dark: "#7c6142",
        },
        parchment: "#f1e9d6",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "piece-pop": {
          "0%": { transform: "scale(0.85)", opacity: "0.5" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "75%": { transform: "translateX(4px)" },
        },
        "diagram-in": {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "piece-pop": "piece-pop 150ms ease",
        shake: "shake 200ms ease",
        "diagram-in": "diagram-in 700ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
