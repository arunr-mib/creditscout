import Link from "next/link";
import type { Metadata } from "next";
import s from "./architecture.module.css";
import { WorkedExample } from "./WorkedExample";

export const metadata: Metadata = {
  title: "System architecture · CreditScout",
  description:
    "Intake, enrichment and verification, agentic decisioning, guardrails, human review, write-back, and the learning loop.",
};

/**
 * Public system-architecture page (Pitch Day ask #1). Static: it reads no data,
 * so it sits outside the session gate with /welcome and /login.
 *
 * Forest theme, scoped in architecture.module.css — not the app's /design
 * tokens. Anything the owner has not confirmed renders as a visible
 * <Confirm> placeholder; nothing on this page should be guessed.
 */

function Confirm({ children }: { children: React.ReactNode }) {
  return <span className={s.confirm}>To confirm: {children}</span>;
}

const STAGES = [
  { n: 1, name: "Intake", line: "Parse and index loan documents. Every passage keeps its source." },
  { n: 2, name: "Enrichment and verification", line: "Extract figures and check them against the agreement." },
  { n: 3, name: "Agentic decisioning", line: "The orchestrator picks tools and runs the covenant test.", agent: true },
  { n: 4, name: "Guardrails", line: "Every number traced, or the system abstains." },
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
              <a href="#guardrails">Guardrails</a>
              <a href="#example">Worked example</a>
              <a href="#planes">Data and control</a>
              <a href="#security">Security</a>
              <a href="#roadmap">Roadmap</a>
              <a href="#integrations">Integrations</a>
              <Link href="/login">Enter the workspace</Link>
            </div>
          </nav>
          <div className={s.hero}>
            <p className={s.eyebrow}>System architecture</p>
            <h1 className={s.h1}>
              Intake → enrichment and verification → agentic decisioning → guardrails → human review.
            </h1>
            <p className={s.lede}>
              CreditScout investigates commercial loan covenant breaches with cited tools and a learning loop.
            </p>
            <p className={s.ledeStrong}>
              The model reasons, the code calculates, guardrails verify, a person decides.
            </p>
          </div>
        </div>
      </header>

      <main className={s.main}>
        {/* ------------------------------------------------------------ flow */}
        <section id="flow" className={s.section} aria-labelledby="flow-h">
          <h2 id="flow-h" className={s.h2}>The flow</h2>
          <p className={s.sub}>Seven stages, across four lanes. Only the middle lane is CreditScout working on its own.</p>

          <div className={s.lanes}>
            <div className={s.lane}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>Documents in</p>
                <p className={s.laneNote}>From the borrower and the bank</p>
              </div>
              <p style={{ margin: 0 }}>Loan agreement, amendments, borrower financials, compliance certificates.</p>
            </div>
            <p className={s.arrow} aria-hidden="true">↓</p>

            <div className={`${s.lane} ${s.laneWorking}`}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>CreditScout working</p>
                <p className={s.laneNote}>Reasoning by the model, every figure by code</p>
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
                <p className={s.laneNote}>The decision is always a person&rsquo;s</p>
              </div>
              <ol className={s.stages} start={5}>
                <li className={s.stage}>
                  <span className={s.stageNum}>5</span>
                  <span className={s.stageName}>Human review</span>
                  <p className={s.stageLine}>Full-width casefile: the breach, the calculation, the citations, the recommendation.</p>
                </li>
              </ol>
            </div>
            <p className={s.arrow} aria-hidden="true">↓</p>

            <div className={s.lane}>
              <div className={s.laneHead}>
                <p className={s.laneTitle}>System of record <span className={s.status}>Roadmap</span></p>
                <p className={s.laneNote}>The bank&rsquo;s own platform</p>
              </div>
              <ol className={s.stages} start={6}>
                <li className={s.stage}>
                  <span className={s.stageNum}>6</span>
                  <span className={s.stageName}>Write-back</span>
                  <p className={s.stageLine}>Not built yet. Decision, reasoning and audit trail would go back to where the loan lives.</p>
                </li>
              </ol>
            </div>

            <div className={s.loop}>
              <span className={s.stageNum}>7</span>
              <strong className={s.stageName}>Learning loop</strong> — each decided case becomes a lesson the agent
              reads on the next similar case (back to stage 3).
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- stage details */}
        <section className={s.section} aria-labelledby="stages-h">
          <h2 id="stages-h" className={s.h2}>What each stage does</h2>
          <ol className={s.steps}>
            <li>
              <span className={s.stageNum}>1</span>
              <div>
                <h3 className={s.h3}>Intake</h3>
                <p>
                  The loan agreement, amendments and borrower financials come in as documents. Nothing is summarised
                  away: each figure keeps a link to the exact document and clause it came from.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>2</span>
              <div>
                <h3 className={s.h3}>Enrichment and verification</h3>
                <p>
                  Figures are extracted and checked against the agreement&rsquo;s terms: floors, definitions, add-backs
                  and their caps. Covenant terms only govern a test once an analyst has approved them. A figure that
                  cannot be verified is flagged, not smoothed over.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>3</span>
              <div>
                <h3 className={s.h3}>
                  Agentic decisioning <span className={s.agentTag}>Agent</span>
                </h3>
                <p>
                  The CreditScout Agent investigates the breach: which covenant, which test, which inputs, which
                  amendment. It calls tools for retrieval and calculation, and never does arithmetic in prose.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>4</span>
              <div>
                <h3 className={s.h3}>Guardrails</h3>
                <p>
                  The model never produces a number. Every figure in an explanation must trace to a logged calculation
                  or a verbatim quote from a cited document, or the recommendation is forced to abstain.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>5</span>
              <div>
                <h3 className={s.h3}>Human review</h3>
                <p>
                  The casefile opens full-width. The analyst sees the breach, the calculation line by line, the
                  citations and the recommendation, then records one of three decisions:{" "}
                  <strong>Approve</strong>, <strong>Override</strong> (with a reason and the corrected outcome), or{" "}
                  <strong>Hold for borrower documents</strong>. No recommendation is shown without its evidence.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>6</span>
              <div>
                <h3 className={s.h3}>Write-back and audit trail <span className={s.status}>Roadmap</span></h3>
                <p>
                  Today, the decision, the reasoning, every citation and the full investigation trace are kept in
                  CreditScout&rsquo;s casefile record; a re-run keeps the earlier casefile as history rather than
                  overwriting it. Writing back to the bank&rsquo;s system of record, with an immutable audit trail an
                  examiner can replay, is on the roadmap.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stageNum}>7</span>
              <div>
                <h3 className={s.h3}>Learning loop</h3>
                <p>
                  Every decided case, and above all every override, becomes a lesson the agent retrieves on the next
                  similar case. The signed oracle is kept separate on purpose: it is the owner-signed set of expected
                  values every run is scored against, and decided cases never rewrite it. That separation is what
                  stops the system grading its own homework.
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* ------------------------------------------------------ guardrails */}
        <section id="guardrails" className={s.section} aria-labelledby="guard-h">
          <h2 id="guard-h" className={s.h2}>The guardrail rule</h2>
          <div className={s.rule}>
            <p className={s.ruleText}>The model never produces a number.</p>
            <p style={{ margin: 0 }}>
              Every figure must trace to a logged calculation or a verbatim quote, or the system abstains. Quoted
              figures from the agreement (&ldquo;not less than 1.25 to 1.00&rdquo;) count as traced; an unsourced
              figure does not.
            </p>
          </div>
          <p className={s.sub}>Evaluation runs are scored Honest / Harmless / Helpful against a signed oracle of expected values.</p>
          <div className={s.grid3}>
            <div className={`${s.card}`}>
              <h3 className={s.h3}>Honest</h3>
              <p style={{ margin: 0 }}>Calculation accuracy, citation hit rate, groundedness of the explanation.</p>
            </div>
            <div className={`${s.card}`}>
              <h3 className={s.h3}>Harmless</h3>
              <p style={{ margin: 0 }}>Zero false resolves; abstains when it should.</p>
            </div>
            <div className={`${s.card}`}>
              <h3 className={s.h3}>Helpful</h3>
              <p style={{ margin: 0 }}>Right outcome, in as few investigation steps as it takes.</p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- worked example */}
        <section id="example" className={s.section} aria-labelledby="ex-h">
          <h2 id="ex-h" className={s.h2}>Worked example: Coastal Marine, Q2 2026</h2>
          <p className={s.sub}>
            The borrower reports compliance. CreditScout computes its own test from the approved terms and gets a
            breach. The agent finds Amendment No. 2 on file but not yet boarded; it permits an $800,000 fuel-hedging
            add-back, and with it the ratio reconciles. The recommendation goes to an analyst, who decides. Select any
            number to see its citation.
          </p>
          <WorkedExample />
          <p className={s.hint} style={{ marginTop: 12 }}>Synthetic data — every document is marked &ldquo;SYNTHETIC — FOR DEMONSTRATION&rdquo;.</p>
        </section>

        {/* ------------------------------------------- data vs control plane */}
        {/* Only what is true of the build today. Anything planned lives in the
            roadmap section below, never in these cards. */}
        <section id="planes" className={s.section} aria-labelledby="planes-h">
          <h2 id="planes-h" className={s.h2}>Data plane and control plane</h2>
          <p className={s.sub}>As built today: a single-tenant demo holding synthetic data only.</p>
          <div className={s.grid2}>
            <div className={s.card}>
              <h3 className={s.h3}>Data plane</h3>
              <p style={{ margin: 0 }}>Documents, extracted figures, calculations and decisions.</p>
              <ul className={s.list}>
                <li>Every extracted figure keeps a link to the document and clause it came from.</li>
                <li>Covenant terms are versioned and analyst-approved; an amendment adds a new version, never overwrites.</li>
                <li>Encryption in transit and at rest, as provided by the hosting platforms.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Control plane</h3>
              <p style={{ margin: 0 }}>Orchestration, tool calls, guardrail checks and the investigation trace.</p>
              <ul className={s.list}>
                <li>It routes, checks and records.</li>
                <li>Nothing in the control plane invents a figure.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- security */}
        <section id="security" className={s.section} aria-labelledby="sec-h">
          <h2 id="sec-h" className={s.h2}>Security tenet</h2>
          <p className={s.sub}>What the current build enforces. Certifications and bank-grade controls are on the roadmap below.</p>
          <div className={s.grid2}>
            <div className={s.card}>
              <h3 className={s.h3}>Access and secrets</h3>
              <ul className={s.list}>
                <li>The analyst workspace sits behind sign-in.</li>
                <li>The agent&rsquo;s tool endpoints require a shared key the browser never sees.</li>
                <li>The database enforces row-level security; the browser&rsquo;s key can only read.</li>
                <li>The write key stays on the server.</li>
                <li>Service keys live in environment variables, never committed to the code.</li>
                <li>Synthetic data only. No real bank data.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Model governance</h3>
              <ul className={s.list}>
                <li>The model never produces a number; an untraced figure forces the recommendation to abstain.</li>
                <li>A person makes every decision; the system only recommends.</li>
                <li>Evaluation runs are scored against an owner-signed set of expected values.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- roadmap */}
        <section id="roadmap" className={s.section} aria-labelledby="roadmap-h">
          <h2 id="roadmap-h" className={s.h2}>Future roadmap</h2>
          <p className={s.sub}>Not in the current build. What a bank deployment would add.</p>
          <div className={s.grid3}>
            <div className={s.card}>
              <h3 className={s.h3}>Certifications, in order</h3>
              <ol className={s.list}>
                <li>SOC 2 Type II</li>
                <li>ISO 27001</li>
                <li>PCI DSS, only if card data is ever touched</li>
              </ol>
              <p style={{ margin: "8px 0 0" }}>
                GLBA / FTC Safeguards Rule, if consumer financial data is ever handled.
              </p>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Data and keys</h3>
              <ul className={s.list}>
                <li>Per-customer data segregation: one customer&rsquo;s data never crosses into another customer&rsquo;s run.</li>
                <li>KMS-backed envelope encryption with per-customer keys, rotated automatically.</li>
                <li>Audit trail on key usage.</li>
                <li>
                  Stated retention and deletion policy. <Confirm>policy to state</Confirm>
                </li>
                <li>Write-back to the bank&rsquo;s system of record, with an immutable audit trail an examiner can replay.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Model risk and fair lending</h3>
              <ul className={s.list}>
                <li>SR 11-7 discipline (now SR 26-2 since Apr 2026): independent validation, documented methodology and limitations, ongoing monitoring.</li>
                <li>An adverse-action-ready explanation on every decision.</li>
                <li>Fair-lending disparate-impact testing during development, not at the end.</li>
                <li>EU AI Act: creditworthiness assessment is high-risk, so risk management, data governance, documentation, human oversight and post-market monitoring apply.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- integrations */}
        <section id="integrations" className={s.section} aria-labelledby="int-h">
          <h2 id="int-h" className={s.h2}>Integrate, don&rsquo;t replace <span className={s.status}>Roadmap</span></h2>
          <p className={s.sub}>
            No integrations are built today: the demo works from uploaded documents. The plan is a modular layer on top
            of the buyer&rsquo;s system of record, with no rip-and-replace.
          </p>
          <div className={`${s.card} ${s.tableWrap}`}>
            <table className={s.intTable}>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Platforms buyers already run</th>
                  <th scope="col">CreditScout status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lending</td>
                  <td>
                    nCino Commercial and Small Business Solutions (its Mortgage MCP lets institutions plug in their own
                    external AI agents), ICE Encompass, Blend, MeridianLink, Fiserv
                  </td>
                  <td>Not built yet</td>
                </tr>
                <tr>
                  <td>Insurance</td>
                  <td>Guidewire, Duck Creek, Sapiens</td>
                  <td>Not built yet</td>
                </tr>
                <tr>
                  <td>Credit data</td>
                  <td>Equifax, Experian, TransUnion, plus verification providers</td>
                  <td>Not built yet</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={s.grid2} style={{ marginTop: 16 }}>
            <div className={s.card}>
              <h3 className={s.h3}>Proof that the market works this way</h3>
              <ul className={s.list}>
                <li>Parlay × nCino (Oct 8, 2026): live integration for about 1,400 SBA lenders.</li>
                <li>Convr&rsquo;s AI Underwriting Workbench (June 2026): core-system-agnostic.</li>
              </ul>
            </div>
            <div className={s.card}>
              <h3 className={s.h3}>Stated honestly</h3>
              <p style={{ margin: 0 }}>
                nCino launched its own agentic suite in Oct 2026. The differentiator is domain depth in covenant
                investigation, not being an agent.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- backward simulation */}
        <section className={s.section} aria-labelledby="sim-h">
          <h2 id="sim-h" className={s.h2}>Backward simulations <span className={s.status}>Roadmap</span></h2>
          <p className={s.sub}>
            An offer, not yet run on a bank&rsquo;s book. Today the same evaluation harness scores CreditScout against an
            owner-signed set of synthetic cases.
          </p>
          <blockquote className={s.quote} style={{ marginBottom: 16 }}>
            Connect us to your historical book. We run blind on cases your team already decided, and show you where we
            agree, where we would have caught more risk or moved faster, our explanation for every decision, and our
            disparate-impact numbers.
          </blockquote>
          <div className={s.card}>
            <h3 className={s.h3}>What it would report</h3>
            <ul className={s.list}>
              <li>Agreement rate with your team&rsquo;s decisions</li>
              <li>Lift: risk caught and time saved</li>
              <li>False-positive / false-negative split</li>
              <li>Fairness metrics</li>
              <li>Explanation quality on adverse actions</li>
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------- open questions */}
        <section className={s.section} aria-labelledby="open-h">
          <h2 id="open-h" className={s.h2}>Still to confirm</h2>
          <div className={s.confirmBlock}>
            <ul className={s.list} style={{ marginTop: 0 }}>
              <li>
                <strong>Hosting and region:</strong> where the app and data live. <Confirm>hosting and region</Confirm>
              </li>
              <li>
                <strong>Models:</strong> where models run and which model serves each stage.{" "}
                <Confirm>models per stage</Confirm>
              </li>
              <li>
                <strong>Stack:</strong> which pieces are CreditScout&rsquo;s and which belong to other projects.{" "}
                <Confirm>stack</Confirm>
              </li>
            </ul>
          </div>
        </section>

        <footer className={s.footer}>
          CreditScout · Bank of Stoic demo · Synthetic data only. No real bank data.{" "}
          <Link href="/welcome">Back to overview</Link>
        </footer>
      </main>
    </div>
  );
}
