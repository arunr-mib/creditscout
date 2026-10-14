"""Generate the two CreditScout diagrams.

    python3 docs/diagrams/generate.py        (run from the repo root)

Writes creditscout-user-flow.svg and creditscout-architecture.svg beside this
file. Hand-editing the SVGs is a mistake — edit here and regenerate, so the
coordinates stay consistent.

Restraint is the point: ONE accent (teal, the product's model colour since the
2026-10-13 palette change) and nothing else. The model / code / human
distinction is load-bearing in this product, so it is carried by line treatment
and typeface rather than by three competing hues — teal border for the agent,
plain light border plus a monospace label for deterministic code, dashed border
for a human step.

The diagrams stay dark on purpose: they are read in documents and decks, not in
the lit workspace the application itself now uses.
"""
import os
from html import escape

# The app serves these too (Governance -> Knowledge), so every run writes both
# copies from the same string. `public/` is a build artifact of this script, not
# a second source — never edit either SVG by hand.
PUBLIC = "public/diagrams"


def write(name, svg):
    open(f"docs/diagrams/{name}", "w").write(svg)
    os.makedirs(PUBLIC, exist_ok=True)
    open(f"{PUBLIC}/{name}", "w").write(svg)

BG, PANEL, BORDER = "#0A1628", "#11243D", "#2A3A52"
TEXT, SECOND, MUTED = "#F8FAFC", "#CBD5E1", "#94A3B8"
ACCENT, ACCENT_DIM, ACCENT_FILL = "#5EC2BA", "#146C67", "#10302E"
# A HUMAN step is LIGHTER than everything else on the page. It used to share
# `PANEL` with the deterministic-code boxes and differ only by a dashed stroke,
# which is not a difference you can see across a room — and the human/code
# distinction is the one the whole diagram exists to make.
HUMAN_FILL, HUMAN_STROKE, HUMAN_TEXT = "#2B4A6B", "#C3D5E8", "#FFFFFF"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"
SANS = "Inter, -apple-system, Helvetica, Arial, sans-serif"

def esc(s): return escape(str(s), quote=False)

def box(x, y, w, h, title, lines=(), kind="plain", tag=None):
    """kind: plain | model | code | human"""
    o = []
    if kind == "model":
        fill, stroke, dash, tcol = ACCENT_FILL, ACCENT, "", "#8FD8D1"
    elif kind == "human":
        fill, stroke, dash, tcol = HUMAN_FILL, HUMAN_STROKE, ' stroke-dasharray="5 4"', HUMAN_TEXT
    else:
        fill, stroke, dash, tcol = PANEL, BORDER, "", TEXT
    o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" stroke="{stroke}" stroke-width="1.25"{dash}/>')
    cx = x + w / 2
    ty = y + (26 if tag else 30)
    if tag:
        tagcol = "#DCE7F2" if kind == "human" else MUTED
        o.append(f'<text x="{cx}" y="{y+20}" fill="{tagcol}" font-size="10.5" letter-spacing="1.3" text-anchor="middle">{esc(tag.upper())}</text>')
        ty = y + 42
    tf = MONO if kind == "code" else SANS
    fs = 14 if kind == "code" else 15
    o.append(f'<text x="{cx}" y="{ty}" fill="{tcol}" font-size="{fs}" font-weight="600" font-family="{tf}" text-anchor="middle">{esc(title)}</text>')
    lcol = "#DCE7F2" if kind == "human" else MUTED
    for i, ln in enumerate(lines):
        o.append(f'<text x="{cx}" y="{ty+21+i*17}" fill="{lcol}" font-size="12.5" text-anchor="middle">{esc(ln)}</text>')
    return "\n  ".join(o)

def arrow(x1, y1, x2, y2, label=None, dashed=False, mid_dx=0):
    d = ' stroke-dasharray="4 4"' if dashed else ""
    o = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#4A5B76" stroke-width="1.25"{d} marker-end="url(#a)"/>']
    if label:
        mx, my = (x1 + x2) / 2 + mid_dx, (y1 + y2) / 2
        anchor = "middle" if y1 == y2 else "start"
        dy = -9 if y1 == y2 else 4
        dx = 0 if y1 == y2 else 10
        o.append(f'<text x="{mx+dx}" y="{my+dy}" fill="{MUTED}" font-size="11.5" text-anchor="{anchor}">{esc(label)}</text>')
    return "\n  ".join(o)

def lane(y, label, note, w=1536, x=64):
    return "\n  ".join([
        f'<text x="{x}" y="{y}" fill="{ACCENT}" font-size="11.5" font-weight="700" letter-spacing="1.6">{esc(label.upper())}</text>',
        f'<text x="{x+len(label)*8.2+34}" y="{y}" fill="{MUTED}" font-size="12">{esc(note)}</text>',
        f'<line x1="{x}" y1="{y+12}" x2="{w+x}" y2="{y+12}" stroke="{BORDER}" stroke-width="1"/>',
    ])

def doc(w, h, title, sub, body, legend_y=52):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{SANS}">
  <defs>
    <marker id="a" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
      <path d="M0,0 L9,3.5 L0,7 Z" fill="#4A5B76"/>
    </marker>
  </defs>
  <rect width="{w}" height="{h}" fill="{BG}"/>
  <text x="64" y="54" fill="{TEXT}" font-size="26" font-weight="700" letter-spacing="-0.4">{esc(title)}</text>
  <text x="64" y="80" fill="{MUTED}" font-size="14">{esc(sub)}</text>
  {legend(w - 64, legend_y)}
  {body}
  <text x="64" y="{h-26}" fill="#5A6B86" font-size="11.5">CreditScout · synthetic data only · the agent recommends, a human decides</text>
</svg>
'''

def legend(xr, y):
    items = [("model", "Agent / model"), ("code", "Deterministic code"), ("human", "Human approval")]
    out, x = [], xr
    for kind, label in reversed(items):
        tw = len(label) * 6.9
        x -= tw + 26
        if kind == "model":
            sw = f'fill="{ACCENT_FILL}" stroke="{ACCENT}"'
        elif kind == "human":
            sw = f'fill="{HUMAN_FILL}" stroke="{HUMAN_STROKE}" stroke-dasharray="3 2.5"'
        else:
            sw = f'fill="{PANEL}" stroke="{BORDER}"'
        out.append(f'<rect x="{x}" y="{y-11}" width="13" height="13" rx="3" {sw} stroke-width="1.25"/>')
        lf = MONO if kind == "code" else SANS
        out.append(f'<text x="{x+20}" y="{y}" fill="{SECOND}" font-size="12" font-family="{lf}">{esc(label)}</text>')
        x -= 14
    return "\n  ".join(out)

# ============================================================ USER FLOW
P = []
P.append(lane(140, "Flow A — Loan onboarding", "once per loan · re-runs when an amendment arrives"))
ay, ah = 166, 104
P.append(box(64, ay, 232, ah, "Add a borrower", ["name + documents on ONE", "screen; each file classified"], "human", tag="Analyst"))
P.append(arrow(302, ay+ah/2, 336, ay+ah/2))
P.append(box(342, ay, 256, ah, "definition_agent", ["reads the definitions article", "and every amendment on file"], "model", tag="Extract"))
P.append(arrow(604, ay+ah/2, 638, ay+ah/2))
P.append(box(644, ay, 244, ah, "provenance checks", ["every term needs a citation", "and a verbatim quote"], "code", tag="Verify"))
P.append(arrow(894, ay+ah/2, 928, ay+ah/2))
P.append(box(934, ay, 232, ah, "Approve terms", ["four-eyes; nothing is", "testable until approved"], "human", tag="Analyst"))
P.append(arrow(1172, ay+ah/2, 1206, ay+ah/2))
P.append(box(1212, ay, 388, ah, "covenant_terms v1 — approved", ["versioned, effective-dated; an amendment creates v2", "and supersedes, it never overwrites"], "plain", tag="Boarded"))

P.append(lane(336, "Flow B — Quarterly covenant test", "every loan, every quarter · no model involved"))
by, bh = 362, 104
P.append(box(64, by, 232, bh, "Run Covenant Tests", ["one click, whole book"], "human", tag="Analyst"))
P.append(arrow(302, by+bh/2, 336, by+bh/2))
P.append(box(342, by, 256, bh, "calc/dscr.js", ["computes EVERY test from the", "approved terms — never infers"], "code", tag="Compute"))
P.append(arrow(604, by+bh/2, 638, by+bh/2))
P.append(box(644, by, 244, bh, "reconcile", ["our figure vs the borrower's", "reported figure"], "code", tag="Compare"))
# Pass and fail are BRANCHES, not a sequence. Chaining them read as
# "a pass leads to a breach", which is the opposite of what happens.
P.append(f'<path d="M894 {by+bh/2} H912 V{by+22} H928" fill="none" stroke="#4A5B76" stroke-width="1.25" marker-end="url(#a)"/>')
P.append(f'<path d="M894 {by+bh/2} H912 V{by+80} H928" fill="none" stroke="#4A5B76" stroke-width="1.25" marker-end="url(#a)"/>')
P.append(box(934, by, 666, 46, "Meets minimum — no action", ["variance logged if the borrower's figure disagrees with ours"], "plain", tag=None))
P.append(box(934, by+58, 666, 46, "Below minimum — exception raised", ["OUR figure raises it, never theirs: a borrower whose arithmetic favours them is invisible otherwise"], "plain", tag=None))

P.append(lane(532, "Flow C — Investigation", "only on an exception · the agent decides what to read next"))
cy, ch = 558, 150
P.append(box(64, cy, 232, ch, "Investigate", ["analyst starts it;", "nothing runs unasked"], "human", tag="Analyst"))
P.append(arrow(302, cy+ch/2, 336, cy+ch/2))
P.append(box(342, cy, 388, ch, "CreditScout Agent", ["gpt-4.1-mini orchestrator, six function tools.", "Plans, reads, delegates, re-calculates —", "then decides whether the evidence is enough."], "model", tag="Reason"))
P.append(arrow(736, cy+ch/2, 770, cy+ch/2))
P.append(box(776, cy, 300, ch, "guardrails/*.js", ["six checks, zero dependencies.", "A figure with no logged calculation", "and no cited quote forces abstain."], "code", tag="Enforce"))
P.append(arrow(1082, cy+ch/2, 1116, cy+ch/2))
P.append(box(1122, cy, 220, ch, "Casefile", ["recommendation,", "cited claims,", "calculation log"], "plain", tag="Output"))
P.append(arrow(1348, cy+ch/2, 1382, cy+ch/2))
P.append(box(1388, cy, 212, ch, "Analyst decides", ["approve or override —", "the decision of record", "is always a person's"], "human", tag="Review"))

tools_y = 740
P.append(f'<text x="342" y="{tools_y}" fill="{MUTED}" font-size="11.5" letter-spacing="1.3">THE SIX TOOLS IT CHOOSES BETWEEN</text>')
tools = [("search_documents", "code"), ("dscr_calculator", "code"), ("search_past_cases", "code"),
         ("definition_agent", "model"), ("research_agent", "model"), ("document_agent", "model")]
tx = 342
for name, kind in tools:
    w = 196
    col = ACCENT if kind == "model" else SECOND
    bd = ACCENT_DIM if kind == "model" else BORDER
    P.append(f'<rect x="{tx}" y="{tools_y+12}" width="{w}" height="34" rx="5" fill="{PANEL}" stroke="{bd}" stroke-width="1"/>')
    P.append(f'<text x="{tx+w/2}" y="{tools_y+34}" fill="{col}" font-size="12.5" font-family="{MONO}" text-anchor="middle">{name}</text>')
    tx += w + 12

P.append(f'<line x1="64" y1="{tools_y+86}" x2="1600" y2="{tools_y+86}" stroke="{BORDER}" stroke-width="1"/>')
P.append(f'<text x="64" y="{tools_y+118}" fill="{SECOND}" font-size="13.5">Memory closes the loop: an approved or overridden casefile becomes a lesson, retrieved by <tspan font-family="{MONO}" fill="{ACCENT}">search_past_cases</tspan> on the next similar exception.</text>')
P.append(f'<text x="64" y="{tools_y+140}" fill="{MUTED}" font-size="12.5">Measured across three live runs it has not shortened investigations — the effect is neutral, and the claim that memory saves steps is not made.</text>')

write("creditscout-user-flow.svg",
      doc(1664, 960, "CreditScout — end-to-end covenant monitoring",
          "A reasoning layer decides what evidence to inspect. A calculation layer never guesses. A human always approves.",
          "\n  ".join(P)))
print("user flow written")

# ========================================================= ARCHITECTURE
A = []
RAIL, CX, CW = 64, 238, 1362

def mark(kind, x, y, col):
    """A 20px glyph for the rail.

    SIMPLIFIED MARKS, DRAWN HERE — not the vendors' brand assets. They evoke
    the platform (a triangle for Vercel, a hexagon for Node, a bolt for
    Supabase, a chevron pair for Azure) without shipping a trademark into a
    document we redraw at will. Swap in official SVGs if this ever leaves
    internal use.
    """
    g = {
        # a browser window
        "browser": f'<rect x="{x}" y="{y}" width="20" height="16" rx="2.5" fill="none" stroke="{col}" stroke-width="1.6"/>'
                   f'<line x1="{x}" y1="{y+5.5}" x2="{x+20}" y2="{y+5.5}" stroke="{col}" stroke-width="1.6"/>'
                   f'<circle cx="{x+3.4}" cy="{y+2.9}" r="1" fill="{col}"/>',
        # Vercel-style triangle
        "vercel": f'<path d="M{x+10},{y+1} L{x+20},{y+17} L{x},{y+17} Z" fill="{col}"/>',
        # Azure-style chevrons
        "azure": f'<path d="M{x+8},{y+1} L{x+1},{y+17} L{x+8},{y+17} Z" fill="{col}"/>'
                 f'<path d="M{x+12},{y+5} L{x+6.5},{y+17} L{x+20},{y+17} L{x+16},{y+12.5} Z" fill="{col}"/>',
        # Node-style hexagon
        "node": f'<path d="M{x+10},{y} L{x+19},{y+4.8} L{x+19},{y+13.2} L{x+10},{y+18} L{x+1},{y+13.2} L{x+1},{y+4.8} Z" fill="none" stroke="{col}" stroke-width="1.7"/>',
        # Supabase-style bolt
        "supabase": f'<path d="M{x+12},{y} L{x+2},{y+10.5} L{x+9},{y+10.5} L{x+8},{y+18} L{x+18},{y+7.5} L{x+11},{y+7.5} Z" fill="{col}"/>',
    }
    return g.get(kind, "")


def band(y, name, note, glyph=None):
    tx = RAIL + (30 if glyph else 0)
    if glyph:
        A.append(mark(glyph, RAIL, y + 7, SECOND))
    A.append(f'<text x="{tx}" y="{y+22}" fill="{TEXT}" font-size="16" font-weight="700" letter-spacing="-0.2">{esc(name)}</text>')
    A.append(f'<text x="{RAIL}" y="{y+44}" fill="{MUTED}" font-size="13" font-weight="500">{esc(note)}</text>')

y1 = 132
band(y1, "Analyst", "Browser", "browser")
A.append(box(CX, y1, CW, 78, "Onboarding · Credit Analysis Queue · Recommendation · Documents · Covenant terms · Lessons · Governance",
             ["User sign-in required.",
              "The browser can only read what the rules allow it to see. Every change is made by the server, never by the browser."], "human"))

y2 = 262
band(y2, "Application", "Next.js · Vercel", "vercel")
A.append(arrow(CX+216, y1+72, CX+216, y2-6))
A.append(box(CX, y2, 432, 108, "Analyst API + Server Actions", ["investigate · review · approve terms · propose", "session-gated; service-role key stays server-side"], "plain", tag="Signed-in analyst"))
A.append(box(CX+450, y2, 432, 108, "Agent tool routes",
             ["Published as OpenAPI; every call must present a secret key.",
              "The agent can reach nothing else — not the database,",
              "not the analyst's screens."], "code", tag="The agent's only door"))
A.append(box(CX+900, y2, 462, 108, "Ingest + embeddings",
             ["chunk by section, 1536-dim vectors", "text-embedding-3-small", "Searched by the agent, not pre-loaded — see Agentic RAG below"], "code", tag="Retrieval index"))

y3 = 432
band(y3, "Reasoning", "Azure AI Foundry", "azure")
A.append(arrow(CX+216, y2+108, CX+216, y3-6, "starts a run"))
A.append(arrow(CX+666, y3+118, CX+666, y2+114, "six function tools over HTTPS"))
A.append(box(CX, y3, CW, 118, "CreditScout Agent — gpt-4.1-mini",
             ["One orchestrator. It chooses what to read next, delegates, re-calculates, and stops when the evidence is enough.",
              "AGENTIC RAG: it is handed the document INVENTORY — titles, types, dates — and never the text. Every passage it uses,",
              "it went and retrieved, with a query and a document type it chose. Past lessons are the one exception: those are",
              "pre-fetched into the brief, and it can search for more."], "model", tag="Orchestrator · Agentic RAG"))

y4 = 600
band(y4, "In process", "Same Node process", "node")
A.append(arrow(CX+216, y3+118, CX+216, y4-6, "delegates"))
A.append(box(CX, y4, 648, 118, "Three specialists — gpt-5-mini", 
             ["definition_agent · research_agent · document_agent", "Serviced in-process by lib/agent/specialists.ts.", "facility_id is never a tool parameter — it comes from the casefile."], "model", tag="Delegation"))
A.append(box(CX+678, y4, 684, 118, "calc/dscr.js   ·   guardrails/*.js",
             ["Zero dependencies, import-free, never a model. The calculator refuses a missing input",
              "rather than defaulting it. Six guardrail checks run on every answer; a figure with no logged",
              "calculation and no cited quote forces the recommendation to abstain."], "code", tag="Deterministic core"))

y5 = 786
band(y5, "Data", "Supabase · cloud only", "supabase")
A.append(arrow(CX+340, y4+118, CX+340, y5-6))
A.append(arrow(CX+1020, y4+118, CX+1020, y5-6))
A.append(box(CX, y5, CW, 96, "Postgres + pgvector",
             ["facilities · documents · doc_chunks (vector 1536, chunk_index) · covenant_terms (versioned, approved) · tests · exceptions",
              "casefiles · calc_log · reviews · lessons · policy · eval_runs.  The uploaded FILE is not retained: a document is its indexed sections."], "plain", tag="Row-level security"))

A.append(f'<line x1="{RAIL}" y1="{y5+134}" x2="1600" y2="{y5+134}" stroke="{BORDER}" stroke-width="1"/>')
A.append(f'<text x="{RAIL}" y="{y5+166}" fill="{SECOND}" font-size="13.5">The boundary that matters: <tspan fill="{ACCENT}">the model never produces a number.</tspan> It decides what to inspect; <tspan font-family="{MONO}">calc/dscr.js</tspan> computes and <tspan font-family="{MONO}">guardrails/*.js</tspan> enforces — both zero-dependency, neither reachable by the model.</text>')

write("creditscout-architecture.svg",
      doc(1664, 1010, "CreditScout — system architecture",
          "One orchestrator, six function tools, and a deterministic core the model cannot reach.",
          "\n  ".join(A)))
print("architecture written")
