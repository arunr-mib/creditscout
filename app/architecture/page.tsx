import Link from "next/link";
import type { Metadata } from "next";
import s from "./architecture.module.css";
import { WorkedExample } from "./WorkedExample";

export const metadata: Metadata = {
  title: "System architecture · CreditScout",
  description: "How CreditScout investigates covenant breaches: the model reasons, the code calculates, a person decides.",
};

/**
 * Public system-architecture page (Pitch Day ask #1). Static: it reads no data,
 * so it sits outside the session gate with /welcome and /login.
 *
 * Forest theme, scoped in architecture.module.css — not the app's /design
 * tokens.
 *
 * TRUTH RULE: the sections above "Roadmap" state only what the current build
 * does. Anything planned goes in the roadmap section or carries a Roadmap
 * label. Anything the owner has not confirmed renders as a visible <Confirm>.
 */

function Confirm({ children }: { children: React.ReactNode }) {
  return <span className={s.confirm}>To confirm: {children}</span>;
}

const Roadmap = () => <span className={s.status}>Roadmap</span>;

const STAGES = [
  { n: 1, name: "Intake", line: "Index documents. Every passage keeps its source." },
  { n: 2, name: "Enrichment and verification", line: "Extract figures; check them against approved terms." },
  { n: 3, name: "Agentic decisioning", line: "The agent picks tools and runs the covenant test.", agent: true },
  { n: 4, name: "Guardrails", line: "Every number traced, or it abstains." },
];

/** Stage by stage: what each does, and the promise it keeps. Today-true only; stage 6 says what is next. */
const DETAILS: { n: number; name: string; agent?: boolean; roadmap?: boolean; does: string; promise: string; doesLabel?: string; promiseLabel?: string }[] = [
  { n: 1, name: "Intake", does: "Agreement, amendments and financials come in as documents.", promise: "Nothing summarised away. Every figure links to its document and clause." },
  { n: 2, name: "Enrichment and verification", does: "Extracts figures; checks floors, definitions, add-backs and caps.", promise: "Only analyst-approved terms govern a test. An unverifiable figure is flagged, not smoothed over." },
  { n: 3, name: "Agentic decisioning", agent: true, does: "Works out which covenant, test, inputs and amendment apply.", promise: "Calls tools for every lookup and calculation. Never does arithmetic in prose." },
  { n: 4, name: "Guardrails", does: "Checks every figure in the explanation.", promise: "Each traces to a logged calculation or a verbatim quote, or the recommendation abstains." },
  { n: 5, name: "Human review", does: "Full-width casefile: breach, line-by-line calculation, citations, recommendation.", promise: "The analyst decides: Approve, Override (with a reason), or Hold for borrower documents." },
  { n: 6, name: "Write-back", roadmap: true, doesLabel: "Today", promiseLabel: "Next", does: "Decision, reasoning, citations and trace stay in the casefile. A re-run keeps history.", promise: "Write back to the bank’s system of record, with a trail an examiner can replay." },
  { n: 7, name: "Learning loop", does: "Every decision, above all every override, becomes a lesson for the next similar case.", promise: "The signed oracle is never rewritten by it, so the system can’t grade its own homework." },
];

export default function ArchitecturePage() {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <nav className={s.topbar} aria-label="Site">
            <Link href="/welcome" className={s.brand}>
              CreditScout
            </Link>
            <div className={s.topLinks}>
              <a href="#flow">Flow</a>
              <a href="#stages">Stages</a>
              <a href="#example">Example</a>
              <a href="#security">Security</a>
              <a href="#roadmap">Roadmap</a>
              <Link href="/login">Enter the workspace</Link>
            </div>
          </nav>
          <div className={s.hero}>
            <p className={s.eyebrow}>System architecture</p>
            <h1 className={s.h1}>How CreditScout investigates a covenant breach</h1>
            <p className={s.ledeStrong}>The model reasons. The code calculates. Guardrails verify. A person decides.</p>
          </div>
        </div>
      </header>

      <main className={s.main}>
        {/* ------------------------------------------------------------ flow */}
        <section id="flow" className={s.section} aria-labelledby="flow-h">
          <h2 id="flow-h" className={s.h2}>The flow</h2>

          <div className={s.lanes}>
            <div className={s.lane}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>Documents in</p>
              </div>
              <p style={{ margin: 0 }}>Agreement, amendments, financials, compliance certificates.</p>
            </div>
            <p className={s.arrow} aria-hidden="true">↓</p>

            <div className={`${s.lane} ${s.laneWorking}`}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>CreditScout working</p>
              </div>
              <ol className={s.stages}>
                {STAGES.map((st) => (
                  <li key={st.n} className={s.stage}>
                    <span className={s.stageNum}>{st.n}</span>
                    <span className={s.stageName}>{st.name}</span>
                    {st.agent && <span className={s.agentTag}>Agent</span>}
                    <p className={s.stageLine}>{st.line}</p>
                  </li>
                ))}
              </ol>
            </div>
            <p className={s.arrow} aria-hidden="true">↓</p>

            <div className={s.lane}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>Analyst</p>
              </div>
              <ol className={s.stages} start={5}>
                <li className={s.stage}>
                  <span className={s.stageNum}>5</span>
                  <span className={s.stageName}>Human review</span>
                  <p className={s.stageLine}>
                    Breach, calculation, citations, recommendation. The analyst picks Approve, Override, or Hold for
                    borrower documents.
                  </p>
                </li>
              </ol>
            </div>
            <p className={s.arrow} aria-hidden="true">↓</p>

            <div className={s.lane}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>
                  System of record <Roadmap />
                </p>
              </div>
              <ol className={s.stages} start={6}>
                <li className={s.stage}>
                  <span className={s.stageNum}>6</span>
                  <span className={s.stageName}>Write-back</span>
                  <p className={s.stageLine}>
                    Today the decision and full trace stay in CreditScout&rsquo;s casefile.
                  </p>
                </li>
              </ol>
            </div>

            <div className={s.loop}>
              <span className={s.stageNum}>7</span>
              <strong className={s.stageName}>Learning loop:</strong> each decision becomes a lesson for the next
              similar case. The signed oracle that scores runs is never rewritten by it.
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- stage by stage */}
        <section id="stages" className={s.section} aria-labelledby="stages-h">
          <h2 id="stages-h" className={s.h2}>Stage by stage</h2>
          <div className={s.stageTable} role="table" aria-label="What each stage does and guarantees">
            <div className={s.stageHeadRow} role="row">
              <span role="columnheader">Stage</span>
              <span role="columnheader">What it does</span>
              <span role="columnheader">What it guarantees</span>
            </div>
            {DETAILS.map((d) => (
              <div key={d.n} className={s.stageRow} role="row">
                <div className={s.stageCellName} role="rowheader">
                  <span className={s.stageNum}>{d.n}</span>
                  <span>
                    <span className={s.stageName}>{d.name}</span>
                    {d.agent && <span className={s.agentTag}>Agent</span>}
                    {d.roadmap && <Roadmap />}
                  </span>
                </div>
                <p className={s.stageCell} role="cell">
                  {d.doesLabel && <span className={s.cellLabel}>{d.doesLabel}: </span>}
                  {d.does}
                </p>
                <p className={`${s.stageCell} ${s.stagePromise}`} role="cell">
                  {d.promiseLabel && <span className={s.cellLabel}>{d.promiseLabel}: </span>}
                  {d.promise}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ guardrails */}
        <section id="guardrails" className={s.section} aria-labelledby="guard-h">
          <h2 id="guard-h" className={s.h2}>The guardrail rule</h2>
          <div className={s.rule}>
            <p className={s.ruleText}>The model never produces a number.</p>
            <p style={{ margin: 0 }}>
              Every figure traces to a logged calculation or a verbatim quote, or the recommendation abstains.
            </p>
          </div>
          <p className={s.sub}>Evaluation runs are scored against a signed oracle:</p>
          <div className={s.grid3}>
            <div className={s.card}>
              <h3 className={s.h3}>Honest</h3>
              <p style={{ margin: 0 }}>Calculations, citations, groundedness.</p>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Harmless</h3>
              <p style={{ margin: 0 }}>Zero false resolves.</p>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Helpful</h3>
              <p style={{ margin: 0 }}>Right outcome, few steps.</p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- worked example */}
        <section id="example" className={s.section} aria-labelledby="ex-h">
          <h2 id="ex-h" className={s.h2}>Worked example: Coastal Marine, Q2 2026</h2>
          <p className={s.sub}>
            The borrower reports compliance; CreditScout computes a breach. An amendment on file, not yet boarded,
            explains the gap. Select any number to see its source.
          </p>
          <WorkedExample />
          <p className={s.hint} style={{ marginTop: 12 }}>Synthetic data.</p>
        </section>

        {/* ------------------------------------------- data vs control plane */}
        <section id="planes" className={s.section} aria-labelledby="planes-h">
          <h2 id="planes-h" className={s.h2}>Data plane and control plane</h2>
          <div className={s.grid2}>
            <div className={s.card}>
              <h3 className={s.h3}>Data plane</h3>
              <p style={{ margin: 0 }}>Documents, figures, calculations, decisions.</p>
              <ul className={s.list}>
                <li>Every figure links to its clause.</li>
                <li>Terms are versioned and analyst-approved.</li>
                <li>Encrypted in transit and at rest by the hosting platforms.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Control plane</h3>
              <p style={{ margin: 0 }}>Orchestration, tools, guardrails, trace.</p>
              <ul className={s.list}>
                <li>Routes, checks and records.</li>
                <li>Never invents a figure.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- security */}
        <section id="security" className={s.section} aria-labelledby="sec-h">
          <h2 id="sec-h" className={s.h2}>Security today</h2>
          <div className={s.grid2}>
            <div className={s.card}>
              <h3 className={s.h3}>Access and secrets</h3>
              <ul className={s.list}>
                <li>Workspace behind sign-in.</li>
                <li>Agent tools need a server-side key.</li>
                <li>Browser key is read-only (row-level security).</li>
                <li>Secrets in environment variables, not code.</li>
                <li>Synthetic data only.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Model governance</h3>
              <ul className={s.list}>
                <li>The model never produces a number.</li>
                <li>A person makes every decision.</li>
                <li>Evaluated against a signed oracle.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- roadmap */}
        <section id="roadmap" className={s.section} aria-labelledby="roadmap-h">
          <h2 id="roadmap-h" className={s.h2}>Roadmap</h2>
          <p className={s.sub}>Not built yet. What a bank deployment adds.</p>
          <div className={s.grid3}>
            <div className={s.card}>
              <h3 className={s.h3}>Certifications</h3>
              <ol className={s.list}>
                <li>SOC 2 Type II</li>
                <li>ISO 27001</li>
                <li>PCI DSS, if card data is ever touched</li>
                <li>GLBA, if consumer data is ever handled</li>
              </ol>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Data and keys</h3>
              <ul className={s.list}>
                <li>Per-customer data segregation</li>
                <li>KMS envelope encryption, per-customer keys, auto-rotation</li>
                <li>Key-usage audit trail</li>
                <li>Write-back with an examiner-replayable audit trail</li>
                <li>
                  Retention and deletion policy <Confirm>policy</Confirm>
                </li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Model risk and fair lending</h3>
              <ul className={s.list}>
                <li>SR 11-7 / SR 26-2 validation and monitoring</li>
                <li>Adverse-action-ready explanations</li>
                <li>Disparate-impact testing during development</li>
                <li>EU AI Act high-risk controls</li>
              </ul>
            </div>
          </div>

          <div className={s.grid2} style={{ marginTop: 16 }}>
            <div className={s.card} id="integrations">
              <h3 className={s.h3}>Integrations</h3>
              <p style={{ margin: "0 0 8px" }}>None built yet. The plan: sit on top of the bank&rsquo;s system of record.</p>
              <ul className={s.list}>
                <li>Lending: nCino, ICE Encompass, Blend, MeridianLink, Fiserv</li>
                <li>Insurance: Guidewire, Duck Creek, Sapiens</li>
                <li>Credit data: Equifax, Experian, TransUnion</li>
              </ul>
              <p className={s.hint} style={{ marginTop: 8 }}>
                Precedent: Parlay × nCino (Oct 2026, ~1,400 SBA lenders); Convr&rsquo;s Underwriting Workbench (June
                2026). nCino now has its own agents, so the edge is covenant depth.
              </p>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Backward simulations</h3>
              <p style={{ margin: "0 0 8px" }}>
                Run blind on a bank&rsquo;s already-decided cases. Today the same harness runs on the signed synthetic
                cases.
              </p>
              <ul className={s.list}>
                <li>Agreement rate</li>
                <li>Risk caught and time saved</li>
                <li>False positives / negatives</li>
                <li>Fairness metrics</li>
              </ul>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- open questions */}
        <section className={s.section} aria-labelledby="open-h">
          <h2 id="open-h" className={s.h2}>To confirm</h2>
          <div className={s.confirmBlock}>
            <Confirm>hosting and region</Confirm> <Confirm>models per stage</Confirm> <Confirm>stack</Confirm>
          </div>
        </section>

        <footer className={s.footer}>
          CreditScout · Bank of Stoic demo · Synthetic data only. <Link href="/welcome">Back to overview</Link>
        </footer>
      </main>
    </div>
  );
}
