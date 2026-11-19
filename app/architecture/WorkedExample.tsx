"use client";

import { useRef, useState } from "react";
import s from "./architecture.module.css";
import {
  AMENDMENT_LINE,
  AS_TESTED,
  CALCULATION_SOURCE,
  CITATIONS,
  DENOMINATOR,
  EXAMPLE,
  fmtMillions,
  fmtMoney,
  fmtRatio,
  type CalcLine,
} from "@/components/architectureModel";

/** A source key is a document citation id, or "calc" for CreditScout's own calculator. */
type Source = string;

/**
 * Coastal Marine, Q2 2026. Every figure is a button: pressing it shows where the
 * number comes from — a verbatim quote from a cited document, or the logged
 * calculation. The same rule the product enforces, shown on the page itself.
 */
export function WorkedExample() {
  const [selected, setSelected] = useState<Source>("floor");
  const panel = useRef<HTMLElement>(null);

  // On a phone the panel sits below the table, so a tapped figure would change
  // something off-screen. Bring the panel into view only when it is not visible.
  const select = (source: Source) => {
    setSelected(source);
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight || r.bottom < 0) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const Fig = ({ source, children }: { source: Source; children: React.ReactNode }) => (
    <button
      type="button"
      className={s.figure}
      aria-pressed={selected === source}
      aria-controls="citation-panel"
      onClick={() => select(source)}
    >
      {children}
    </button>
  );

  const Row = ({ line, amend }: { line: CalcLine; amend?: boolean }) => (
    <tr className={amend ? s.amendRow : undefined}>
      <td>
        {line.label}
        {line.note && <span className={s.lineNote}>{line.note}</span>}
      </td>
      <td className={`${s.amt} ${s.num}`}>
        {line.sign ? `${line.sign} ` : ""}
        <Fig source={line.citationId ?? "calc"}>{fmtMoney(line.amount)}</Fig>
      </td>
    </tr>
  );

  const cite = selected === "calc" ? null : CITATIONS[selected];

  return (
    <div className={s.example}>
      <div>
        <div className={s.headline}>
          <div className={s.stat}>
            <p className={s.statLabel}>Computed DSCR, terms as boarded</p>
            <p className={`${s.statValue} ${s.statFail} ${s.num}`}>
              <Fig source="calc">{fmtRatio(EXAMPLE.computedAsTested)}</Fig>
            </p>
          </div>
          <div className={s.stat}>
            <p className={s.statLabel}>Minimum required</p>
            <p className={`${s.statValue} ${s.num}`}>
              <Fig source="floor">{fmtRatio(EXAMPLE.floor)}</Fig>
            </p>
          </div>
          <div className={s.stat}>
            <p className={s.statLabel}>With Amendment No. 2</p>
            <p className={`${s.statValue} ${s.statPass} ${s.num}`}>
              <Fig source="calc">{fmtRatio(EXAMPLE.computedWithAmendment)}</Fig>
            </p>
          </div>
          <div className={s.stat}>
            <p className={s.statLabel}>Borrower reported</p>
            <p className={`${s.statValue} ${s.num}`}>
              <Fig source="reported">{fmtRatio(EXAMPLE.reported)}</Fig>
            </p>
          </div>
        </div>

        <div className={`${s.card} ${s.tableWrap}`}>
          <table className={s.table}>
            <caption className="sr-only">Coastal Marine DSCR calculation, Q2 2026</caption>
            <thead>
              <tr>
                <th scope="col">Cash available for debt service</th>
                <th scope="col" className={s.amt}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {AS_TESTED.map((l) => (
                <Row key={l.label} line={l} />
              ))}
              <tr className={s.totalRow}>
                <td>Total, terms as boarded (v1)</td>
                <td className={`${s.amt} ${s.num}`}>
                  <Fig source="calc">{fmtMoney(EXAMPLE.numeratorAsTested)}</Fig>
                </td>
              </tr>
              <Row line={AMENDMENT_LINE} amend />
              <tr className={s.totalRow}>
                <td>Total, with Amendment No. 2</td>
                <td className={`${s.amt} ${s.num}`}>
                  <Fig source="calc">{fmtMoney(EXAMPLE.numeratorWithAmendment)}</Fig>
                </td>
              </tr>
            </tbody>
          </table>

          <table className={s.table} style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th scope="col">Debt service</th>
                <th scope="col" className={s.amt}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {DENOMINATOR.map((l) => (
                <Row key={l.label} line={l} />
              ))}
              <tr className={s.totalRow}>
                <td>Total debt service</td>
                <td className={`${s.amt} ${s.num}`}>
                  <Fig source="calc">{fmtMoney(EXAMPLE.denominator)}</Fig>
                </td>
              </tr>
            </tbody>
          </table>

          <p className={`${s.formula} ${s.num}`}>
            As boarded: {fmtMillions(EXAMPLE.numeratorAsTested)} / {fmtMillions(EXAMPLE.denominator)} ={" "}
            <strong>{fmtRatio(EXAMPLE.computedAsTested)}</strong> — below the{" "}
            {fmtRatio(EXAMPLE.floor)} minimum, so the test fails.
            <br />
            With Amendment No. 2: {fmtMillions(EXAMPLE.numeratorWithAmendment)} / {fmtMillions(EXAMPLE.denominator)} ={" "}
            <strong>{fmtRatio(EXAMPLE.computedWithAmendment)}</strong> — which reconciles to the borrower&rsquo;s
            reported {fmtRatio(EXAMPLE.reported)}.
          </p>
        </div>
      </div>

      <aside ref={panel} id="citation-panel" className={`${s.card} ${s.citation}`} aria-live="polite">
        <p className={s.statLabel}>Where this number comes from</p>
        {cite ? (
          <>
            <p className={s.citationDoc}>{cite.document}</p>
            <p className={s.citationSec}>{cite.section}</p>
            <blockquote className={s.quote}>{cite.quote}</blockquote>
            {selected === "fuelCap" && (
              <p className={s.hint} style={{ marginTop: 12 }}>
                {CITATIONS.amendmentEffective.quote}. It is on file but has not been boarded into the approved
                terms, which is why the test as run still fails.
              </p>
            )}
          </>
        ) : (
          <>
            <p className={s.citationDoc}>Logged calculation</p>
            <p className={s.citationSec}>No document — computed by code</p>
            <blockquote className={s.quote}>{CALCULATION_SOURCE}</blockquote>
            <p className={s.hint} style={{ marginTop: 12 }}>
              Definition it applies — {CITATIONS.definition.document}, {CITATIONS.definition.section}:
            </p>
            <blockquote className={s.quote} style={{ marginTop: 8 }}>
              {CITATIONS.definition.quote}
            </blockquote>
          </>
        )}
        <p className={s.hint} style={{ marginTop: 16 }}>
          Select any underlined figure to see its source.
        </p>
      </aside>
    </div>
  );
}
