"use client";

import { useMemo, useState } from "react";
import { Pipeline } from "./Pipeline";
import { PipelineAutoRefresh } from "./PipelineAutoRefresh";
import { latestSteps, pipelineLanes, traceStepCount } from "./pipelineModel";
import { QueueFilterBar } from "./QueueFilterBar";
import { QueueTable } from "./QueueTable";
import { applyQueueFilter, sortByRisk, type QueueFilter } from "./queueFilterModel";
import { queueCounts, type PortfolioRow } from "./portfolioModel";

type Lens = "table" | "kanban";

/**
 * The Exceptions queue: one set of filtered, searched, risk-sorted rows, drawn
 * as either the table lens or the kanban lens — same rows either way, never two
 * different views of two different data sets.
 *
 * Owns the filter pill, search box and lens choice as local state; no URL sync
 * (not required by the spec, and a page reload is not expected to restore it).
 * The actual filtering/sorting logic lives in `queueFilterModel` — this
 * component only wires it to the two lenses.
 */
export function ExceptionsQueue({
  rows,
  drift,
  targetPeriod,
  targetLabel,
  traceByCasefile,
}: {
  rows: PortfolioRow[];
  drift: Map<string, boolean>;
  targetPeriod: string;
  targetLabel: string;
  traceByCasefile: Map<string, unknown>;
}) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<Lens>("table");

  // Filter first, then risk-sort — the plan's stated order. Both lenses draw
  // from this same `sorted` array, never from the raw `rows` prop.
  const filtered = applyQueueFilter(rows, filter, query);
  const sorted = sortByRisk(filtered, drift);

  // The pill counts describe the whole portfolio, not the current filter —
  // otherwise picking "Breaches" would make every other pill's count read 0.
  const counts = useMemo(() => queueCounts(rows), [rows]);

  // Auto-refresh must track every running investigation in the portfolio, not
  // just the ones a filter or lens happens to be showing right now — otherwise
  // an "Investigating" row that scrolls off the current filter, or sits behind
  // the default table view, stops polling even though it is still running.
  const anyWorking = rows.some((r) => r.status === "investigating");

  return (
    <div className="space-y-4">
      <PipelineAutoRefresh active={anyWorking} />
      <QueueFilterBar
        counts={counts}
        active={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        lens={lens}
        onLens={setLens}
      />

      {lens === "table" ? (
        <QueueTable rows={sorted} targetPeriod={targetPeriod} targetLabel={targetLabel} />
      ) : (
        <KanbanLens rows={sorted} traceByCasefile={traceByCasefile} />
      )}
    </div>
  );
}

/**
 * The kanban lens, ported verbatim from `app/page.tsx`'s pipeline block — same
 * calls, same order — except it runs on the filtered+sorted rows this
 * component derives, not the unfiltered portfolio.
 */
function KanbanLens({ rows, traceByCasefile }: { rows: PortfolioRow[]; traceByCasefile: Map<string, unknown> }) {
  const steps = new Map([...traceByCasefile].map(([id, trace]) => [id, latestSteps(trace)] as const));
  const stepCounts = new Map([...traceByCasefile].map(([id, trace]) => [id, traceStepCount(trace)] as const));
  const lanes = pipelineLanes(rows, steps, stepCounts);

  return <Pipeline lanes={lanes} />;
}
