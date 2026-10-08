import type { Config } from "tailwindcss";

/**
 * Tokens generated from docs/design.md. That file is the source of truth.
 *
 * Three scales below are REPLACED rather than extended, deliberately:
 *   spacing   — design.md §4 permits only 4,8,12,16,24,32,48,64
 *   fontSize  — design.md §3 defines the full type scale with line heights
 *   boxShadow — design.md §4: "elevation is borders, not shadows"
 *
 * Replacing them makes an off-system value a build-visible mistake instead of
 * a silent drift. Never use an arbitrary value (`text-[28px]`) in a component.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    // --- replaced scales (not `extend`) ---
    spacing: {
      0: "0px", px: "1px",
      1: "4px", 2: "8px", 3: "12px", 4: "16px",
      6: "24px", 8: "32px", 12: "48px", 16: "64px",
    },
    fontSize: {
      // Landing hero only. Added rather than reached for as an arbitrary value,
      // so it stays one decision in one place: nothing inside the workspace
      // should ever be this size.
      display: ["56px", { lineHeight: "58px", fontWeight: "600" }],
      title:   ["28px", { lineHeight: "34px", fontWeight: "700" }],
      section: ["20px", { lineHeight: "28px", fontWeight: "600" }],
      card:    ["16px", { lineHeight: "24px", fontWeight: "600" }],
      body:    ["14px", { lineHeight: "22px", fontWeight: "400" }],
      label:   ["12px", { lineHeight: "16px", fontWeight: "500" }],
      num:     ["14px", { lineHeight: "20px", fontWeight: "500" }],
      quote:   ["13px", { lineHeight: "21px", fontWeight: "400" }],
      badge:   ["11px", { lineHeight: "16px", fontWeight: "500" }],
    },
    // design.md §4 — on a dark background shadows read as mud
    boxShadow: { none: "none" },

    extend: {
      colors: {
        // One step BELOW the page, for the nav rail. Going lighter would have
        // put the rail on `surface`, the card colour, and the rail would read
        // as a very tall card sitting next to the real ones.
        sunken: "#060E1A",
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
      // content: design.md §4. panel: the clause drawer, §5.4. dialog: half the
      // content width, §12.12 (`max-w-content/2` is not a class).
      maxWidth: { content: "1280px", panel: "480px", dialog: "640px" },
      transitionDuration: { fast: "120ms", panel: "200ms", step: "240ms" },
      transitionTimingFunction: { panel: "cubic-bezier(0.16,1,0.3,1)" },
    },
  },
  plugins: [],
} satisfies Config;
