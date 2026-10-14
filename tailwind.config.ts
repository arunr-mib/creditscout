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
    // design.md §4. On the old dark theme shadows read as mud and the scale was
    // replaced with `none`. On a lit page a 1px border alone reads flat, so the
    // scale comes back — but DELIBERATELY SMALL. Two steps, both hairline-soft.
    // A big diffuse shadow is the other half of the generated-template look.
    boxShadow: {
      none: "none",
      card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
      raised: "0 2px 4px -1px rgb(15 23 42 / 0.06), 0 4px 12px -2px rgb(15 23 42 / 0.08)",
    },

    extend: {
      colors: {
        // ------------------------------------------------- the analyst app: LIGHT
        //
        // Flipped 2026-10-13. The product is a tool for commercial credit
        // analysts, and the rooms it has to look at home in are lit. Dark-native
        // reads as a developer tool; it also read as generated.
        //
        // Every semantic colour below is RE-DERIVED, not inverted. The old
        // values were tuned against #0A1628 and fail on white — the dark
        // `model` sits at 2.98:1, `code` 2.15, `success` 1.40. Each new value
        // clears 4.5:1 on both the page and a card.
        bg: "#F7F9FA",
        surface: "#FFFFFF",
        "surface-raised": "#F1F4F6",
        border: "#DCE4E8",
        "border-strong": "#C3CFD5",

        text: "#19282F",
        "text-secondary": "#52646D",
        "text-muted": "#6B7C85",

        // ------------------------------------- surfaces that stay dark, on purpose
        //
        // The nav rail and the marketing pages. They carry light-on-dark
        // foregrounds, so they cannot borrow the tokens above — that was the
        // whole failure mode of the first attempt at this. They get their own
        // set, and `night-*` says so at every call site.
        sunken: "#182126",
        night: "#141C21",
        "night-raised": "#26373D",
        "night-hover": "#223136",
        "night-text": "#F8FAFC",
        "night-secondary": "#CBD5E1",
        "night-muted": "#9AAAB2",
        "night-border": "#2C3B41",
        "night-border-strong": "#3E4F56",

        // DEEP TEAL = a MODEL did this, and = interaction.
        //
        // Saturated indigo buttons competed with a navy shell: two strong blues,
        // neither winning, and the evidence losing to both. The shell is now
        // graphite and the accent is deliberate. 6.23:1 for white text on the
        // button, 5.90 as text on the page.
        //
        // Green stays reserved for a verified pass or a recorded resolution.
        // Teal identifies interaction; it must never be read as "compliant".
        model: "#146C67",
        "model-bright": "#105A56",
        "model-bg": "#E8F2F1",
        // For the dark surfaces, where the pale indigo is still the right one.
        "model-night": "#5EC2BA",

        // amber = CODE did this. Never decoration, never a warning.
        // Amber-700, not amber-500: #F59E0B is unreadable as text on white.
        code: "#B45309",
        "code-bright": "#92400E",
        "code-bg": "#FFFBEB",

        // slate = a HUMAN did this, or must. On light this is a bordered white
        // button, so the token is the INK and the surface is `surface`.
        human: "#334155",
        "human-bg": "#F1F5F9",

        // Red-700, not red-600: #DC2626 reads 4.41 on its own badge background.
        danger: "#C81E1E",
        "danger-bg": "#FEF2F2",
        success: "#15803D",
        "success-bg": "#F0FDF4",
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
