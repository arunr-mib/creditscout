import { test } from "node:test";
import assert from "node:assert/strict";

import { contourDataUri, contourSvg } from "./contours.ts";

const PREFIX = "data:image/svg+xml,";

test("default output draws exactly 14 contour paths", () => {
  const paths = contourSvg().match(/<path/g) ?? [];
  assert.equal(paths.length, 14);
});

test("lines option sets the number of paths", () => {
  const paths = contourSvg({ lines: 3 }).match(/<path/g) ?? [];
  assert.equal(paths.length, 3);
});

test("output is deterministic", () => {
  assert.equal(contourSvg(), contourSvg());
  assert.equal(contourDataUri(), contourDataUri());
});

test("SVG stretches to the band: viewBox 1400x52 and preserveAspectRatio none", () => {
  const svg = contourSvg();
  assert.match(svg, /viewBox="0 0 1400 52"/);
  assert.match(svg, /preserveAspectRatio="none"/);
});

test("each path is an unfilled stroke in the default colour and opacity", () => {
  const svg = contourSvg();
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="#9BE7A9"/);
  assert.match(svg, /stroke-opacity="0\.18"/);
  assert.match(svg, /stroke-width="0\.8"/);
});

test("first line starts at y = -26 at x = 0 and samples every 8px", () => {
  const d = contourSvg().match(/<path d="([^"]+)"/)[1];
  const points = d.split(" L").map((p) => p.replace("M", "").trim().split(" ").map(Number));
  assert.deepEqual(points[0], [0, -26]);
  assert.deepEqual(points[1][0], 8);
  assert.equal(points.at(-1)[0], 1400);
});

test("line k follows the generator formula at a sampled point", () => {
  const k = 2;
  const x = 8;
  const expected = (-26 + 7 * k + 9 * Math.sin(x / 90 + 0.3 * k) + 5 * Math.sin(x / 37 + 0.7 * k) + 10 * Math.sin(x / 260)).toFixed(1);
  const paths = contourSvg({ lines: 3 }).match(/<path d="[^"]+"/g);
  const d = paths[k].slice('<path d="'.length, -1);
  assert.ok(d.includes(`L${x}.0 ${expected}`), `expected L${x}.0 ${expected} in ${d.slice(0, 80)}`);
});

test("contourDataUri has the data URI prefix and no raw #, < or >", () => {
  const uri = contourDataUri();
  assert.ok(uri.startsWith(PREFIX));
  const body = uri.slice(PREFIX.length);
  assert.ok(!body.includes("#"), "raw #");
  assert.ok(!body.includes("<"), "raw <");
  assert.ok(!body.includes(">"), "raw >");
  assert.ok(body.includes("%23"));
});

test("contourDataUri decodes back to contourSvg with the same options", () => {
  const opts = { lines: 5, color: "#123456", opacity: 0.5 };
  const body = contourDataUri(opts).slice(PREFIX.length);
  assert.equal(decodeURIComponent(body), contourSvg(opts));
});
