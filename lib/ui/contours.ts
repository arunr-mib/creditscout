// Survey-map contour lines for the forest header band.
// Pure: no imports, same options always yield the same string.
// Mockup reference: docs/design-mockups/2026-11-07-forest/header-patterns.html (#5).

export type ContourOptions = {
  width?: number;
  height?: number;
  lines?: number;
  color?: string;
  opacity?: number;
};

const STEP_PX = 8;

function sampleXs(width: number): number[] {
  const xs: number[] = [];
  for (let x = 0; x < width; x += STEP_PX) xs.push(x);
  xs.push(width);
  return xs;
}

function yAt(k: number, x: number): number {
  return -26 + 7 * k + 9 * Math.sin(x / 90 + 0.3 * k) + 5 * Math.sin(x / 37 + 0.7 * k) + 10 * Math.sin(x / 260);
}

function contourPath(k: number, width: number): string {
  const segments = sampleXs(width).map((x, i) => {
    const command = i === 0 ? "M" : "L";
    return `${command}${x.toFixed(1)} ${yAt(k, x).toFixed(1)}`;
  });
  return segments.join(" ");
}

export function contourSvg(opts: ContourOptions = {}): string {
  const { width = 1400, height = 52, lines = 14, color = "#9BE7A9", opacity = 0.18 } = opts;
  const paths: string[] = [];
  for (let k = 0; k < lines; k++) {
    paths.push(
      `<path d="${contourPath(k, width)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="0.8"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${paths.join("")}</svg>`;
}

export function contourDataUri(opts: ContourOptions = {}): string {
  return `data:image/svg+xml,${encodeURIComponent(contourSvg(opts))}`;
}
