import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BRAND, CLASSIC, FOREST, SKY, contrast, rgbTriplet } from "./palette.ts";

const KEYS = ["bg", "surface", "surface-raised", "border", "border-strong", "text", "text-secondary", "text-muted"];

test("rgbTriplet: hex to space-separated channels", () => {
  assert.equal(rgbTriplet("#0F2B22"), "15 43 34");
  assert.equal(rgbTriplet("#FFFFFF"), "255 255 255");
});

test("contrast: WCAG reference values", () => {
  assert.equal(contrast("#000000", "#FFFFFF").toFixed(2), "21.00");
  assert.equal(contrast("#FFFFFF", "#FFFFFF").toFixed(2), "1.00");
});

test("FOREST text tokens clear 4.5:1 on the page and on raised surfaces", () => {
  for (const key of ["text", "text-secondary", "text-muted"]) {
    for (const on of ["bg", "surface-raised"]) {
      const ratio = contrast(FOREST[key], FOREST[on]);
      assert.ok(ratio >= 4.5, `${key} on ${on} is ${ratio.toFixed(2)}`);
    }
  }
});

test("BRAND pairs clear 4.5:1", () => {
  const pairs = [
    ["brand", "mint"],
    ["brand", "mint-hover"],
    ["agent-ink", "agent-bg"],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(BRAND[fg], BRAND[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}`);
  }
  for (const fg of ["brand-on", "brand-on-2", "brand-on-3", "brand-danger"]) {
    const ratio = contrast(BRAND[fg], BRAND.brand);
    assert.ok(ratio >= 4.5, `${fg} on brand is ${ratio.toFixed(2)}`);
  }
  assert.ok(contrast(BRAND["agent-ink"], "#C9ECEB") >= 4.5);
  assert.ok(SKY.includes("#C9ECEB"));
});

test("globals.css declares every neutral for both themes (drift guard)", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `missing ${selector} block`);
    return css.slice(start, css.indexOf("}", start));
  };
  const root = block(":root");
  const forest = block(".theme-forest");
  for (const key of KEYS) {
    assert.ok(root.includes(`--c-${key}: ${rgbTriplet(CLASSIC[key])};`), `:root --c-${key}`);
    assert.ok(forest.includes(`--c-${key}: ${rgbTriplet(FOREST[key])};`), `.theme-forest --c-${key}`);
  }
});
