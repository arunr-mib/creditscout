import type { Config } from "tailwindcss";

/**
 * Tokens are generated from docs/design.md. That file is the source of truth.
 * Never add a colour here that isn't there, and never use a raw hex in a
 * component — the semantic names are what make the model/code boundary legible.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A1628",
        surface: "#11243D",
        "surface-raised": "#1E293B",
        border: "#1E293B",
        "border-strong": "#334155",

        text: "#F8FAFC",
        "text-secondary": "#CBD5E1",
        "text-muted": "#94A3B8",

        // teal = a MODEL did this
        model: "#2DD4BF",
        "model-bright": "#5EEAD4",
        "model-bg": "#0F3B3A",

        // amber = CODE did this. Never decoration, never a warning.
        code: "#F59E0B",
        "code-bright": "#FBBF24",
        "code-bg": "#3B2A0A",

        // slate = a HUMAN did this, or must
        human: "#E2E8F0",
        "human-bg": "#1E293B",

        danger: "#F87171",
        "danger-bg": "#3F1D1D",
        success: "#86EFAC",
        "success-bg": "#0F3B2A",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { sm: "4px", md: "8px", lg: "12px" },
      maxWidth: { content: "1280px" },
      transitionDuration: { fast: "120ms", panel: "200ms", step: "240ms" },
    },
  },
  plugins: [],
} satisfies Config;
