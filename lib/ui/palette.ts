/**
 * The Forest redesign palette as plain data. No imports: tailwind.config.ts
 * reads BRAND and SKY directly, and the neutrals are mirrored into
 * app/globals.css as `--c-<key>` triplets (palette.test.js fails on drift).
 *
 * CLASSIC is today's neutral set (login and welcome keep it); FOREST is the
 * workspace set, applied by the `theme-forest` class on <body>.
 */

export type NeutralKey =
  | "bg"
  | "surface"
  | "surface-raised"
  | "border"
  | "border-strong"
  | "text"
  | "text-secondary"
  | "text-muted";

export const CLASSIC: Record<NeutralKey, string> = {
  bg: "#F7F9FA",
  surface: "#FFFFFF",
  "surface-raised": "#F1F4F6",
  border: "#C7D3DA",
  "border-strong": "#94A6B0",
  text: "#19282F",
  "text-secondary": "#52646D",
  "text-muted": "#6B7C85",
};

export const FOREST: Record<NeutralKey, string> = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  "surface-raised": "#EEF3EF",
  border: "#DCE6DF",
  "border-strong": "#BFD0C5",
  text: "#0F2B22",
  "text-secondary": "#3E5A50",
  "text-muted": "#566D61",
};

export const BRAND = {
  brand: "#0F2B22",
  "brand-on": "#FFFFFF",
  "brand-on-2": "#CFE3D6",
  "brand-on-3": "#A9C7B5",
  "brand-danger": "#FFB4A8",
  mint: "#9BE7A9",
  "mint-hover": "#86DC97",
  agent: "#3D7FD6",
  "agent-ink": "#123A6B",
  "agent-bg": "#DCEBFF",
} as const;

/** Agent surfaces: pale sky to teal-mint. */
export const SKY = "linear-gradient(160deg,#D6E8FF 0%,#C9ECEB 55%,#E4F6EE 100%)";

/** "#0F2B22" -> "15 43 34", the form Tailwind's `rgb(var(--c-x) / <alpha-value>)` needs. */
export function rgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1 to 21. Order of the arguments does not matter. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
