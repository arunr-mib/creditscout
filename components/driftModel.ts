/**
 * Drift: whether a loan's computed DSCR has fallen across its quarterly test
 * history. A pure function over rows already fetched by `loadPortfolio()`; it
 * reads no I/O and computes no covenant result. It is a tie-break signal for
 * the queue, never a verdict — the verdict is `verdictOf` on the stored test.
 */

export interface QuarterPoint {
  /** ISO test period end, e.g. "2026-06-30". Sorts correctly as a string. */
  period: string;
  /** Our computed DSCR for that quarter. Null means not computed. */
  computed: number | null;
}

/**
 * True when the latest computed DSCR is strictly below the earliest. Fewer than
 * two quarters, or a missing figure at either end, is not drift: a gap in the
 * record is never read as a decline. The input is not mutated.
 */
export function hasDrift(points: QuarterPoint[]): boolean {
  if (points.length < 2) return false;
  const sorted = [...points].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.computed == null || last.computed == null) return false;
  return last.computed < first.computed;
}

/** Drift per facility, from the flat `tests` rows the loader already holds. */
export function driftByFacility(
  tests: { facility_id: string; test_period_end: string; computed_dscr: number | null }[],
): Map<string, boolean> {
  const byFacility = new Map<string, QuarterPoint[]>();
  for (const t of tests) {
    const points = byFacility.get(t.facility_id) ?? [];
    points.push({ period: t.test_period_end, computed: t.computed_dscr });
    byFacility.set(t.facility_id, points);
  }
  return new Map([...byFacility].map(([facilityId, points]) => [facilityId, hasDrift(points)]));
}
