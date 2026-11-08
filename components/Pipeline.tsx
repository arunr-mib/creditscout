import { PipelineCard } from "./PipelineCard";
import { pipelineLanes } from "./pipelineModel";

type Lanes = ReturnType<typeof pipelineLanes>;

/**
 * The four-lane deal pipeline. Four columns from `md` up, one column below.
 * The lanes and their cards are decided by `pipelineModel`; this only draws them.
 * The working lane takes the agent's sky surface — it is the agent's lane.
 */
export function Pipeline({ lanes }: { lanes: Lanes }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {lanes.map((lane) => (
        <section
          key={lane.key}
          aria-label={lane.title}
          className={`${lane.key === "working" ? "bg-sky" : "bg-surface-raised"} space-y-3 rounded-2xl p-3`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-body font-semibold text-text">{lane.title}</h2>
            <span className="text-label tabular-nums text-text-secondary">{lane.cards.length}</span>
          </div>
          {lane.cards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong p-3 text-label text-text-secondary">{lane.empty}</p>
          ) : (
            <ul className="space-y-3">
              {lane.cards.map((card) => (
                <li key={card.facilityId}>
                  <PipelineCard card={card} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
