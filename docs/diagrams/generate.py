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
#
# A DIFFERENT DIAGRAM, ON PURPOSE. The architecture picture answers "what is
# wired to what"; this one answers "what is it like to use". It was being read
# as a second architecture diagram because it looked like one — same dark page,
# same rectangles, same tags.
#
# So: a lit page, warm neutrals, the product's own teal, rounded cards, a
# person at the start of every flow, and copy in the second person. The facts
# are unchanged; only the register is.

# the app's own light palette, warmed half a step
L_BG, L_CARD, L_EDGE = "#FAF8F5", "#FFFFFF", "#DED7CE"
L_TEXT, L_SECOND, L_MUTED = "#1F2A2E", "#51626A", "#8A959B"
L_MODEL, L_MODEL_BG = "#146C67", "#E6F2F0"
L_CODE, L_CODE_BG = "#A4590B", "#FCF4E6"
L_YOU, L_YOU_BG = "#2B4A6B", "#E9F0F7"


def avatar(x, y, r=19):
    """The analyst. A person, not a dashed rectangle."""
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{L_YOU_BG}" stroke="{L_YOU}" stroke-width="1.6"/>'
            f'<circle cx="{x}" cy="{y-5}" r="{r*0.3:.1f}" fill="{L_YOU}"/>'
            f'<path d="M{x-r*0.52:.1f},{y+r*0.62:.1f} a{r*0.52:.1f},{r*0.46:.1f} 0 0 1 {r*1.04:.1f},0" fill="{L_YOU}"/>')


def card(x, y, w, h, title, lines=(), kind="plain", step=None):
    """A soft card. `kind` tints it: you | model | code | plain."""
    fill, edge, tcol = L_CARD, L_EDGE, L_TEXT
    if kind == "you":
        fill, edge, tcol = L_YOU_BG, L_YOU, L_YOU
    elif kind == "model":
        fill, edge, tcol = L_MODEL_BG, L_MODEL, L_MODEL
    elif kind == "code":
        fill, edge, tcol = L_CODE_BG, L_CODE, L_CODE
    o = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{edge}" stroke-width="1.4"/>']
    ty = y + 34
    if step is not None:
        o.append(f'<circle cx="{x+24}" cy="{y+24}" r="12" fill="{tcol}"/>')
        o.append(f'<text x="{x+24}" y="{y+28.5}" fill="{L_CARD}" font-size="12.5" font-weight="700" text-anchor="middle">{step}</text>')
        ty = y + 56
    o.append(f'<text x="{x+22}" y="{ty}" fill="{tcol}" font-size="15.5" font-weight="700">{esc(title)}</text>')
    for i, ln in enumerate(lines):
        o.append(f'<text x="{x+22}" y="{ty+22+i*18}" fill="{L_SECOND}" font-size="13">{esc(ln)}</text>')
    return "\n  ".join(o)


def flow(x, y, n, name, when):
    """A flow's heading: a numbered dot, the name, and when it happens."""
    return "\n  ".join([
        f'<circle cx="{x+13}" cy="{y-6}" r="13" fill="{L_MODEL}"/>',
        f'<text x="{x+13}" y="{y-1.5}" fill="#FFFFFF" font-size="13" font-weight="700" text-anchor="middle">{n}</text>',
        f'<text x="{x+36}" y="{y}" fill="{L_TEXT}" font-size="19" font-weight="700" letter-spacing="-0.2">{esc(name)}</text>',
        f'<text x="{x+36+len(name)*10.6}" y="{y-1}" fill="{L_MUTED}" font-size="13.5">{esc(when)}</text>',
    ])


def hop(x1, y, x2):
    """A soft arrow between cards."""
    return f'<line x1="{x1}" y1="{y}" x2="{x2-4}" y2="{y}" stroke="{L_EDGE}" stroke-width="2" marker-end="url(#l)"/>'


def ldoc(w, h, body):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{SANS}">'
    return "\n".join([
        head,
        '  <defs>',
        '    <marker id="l" markerWidth="8" markerHeight="7" refX="7.5" refY="3.5" orient="auto">',
        f'      <path d="M0,0 L8,3.5 L0,7 Z" fill="{L_EDGE}"/>',
        '    </marker>',
        '  </defs>',
        f'  <rect width="{w}" height="{h}" fill="{L_BG}"/>',
        f'  <text x="64" y="58" fill="{L_TEXT}" font-size="27" font-weight="700" letter-spacing="-0.5">What it is like to use CreditScout</text>',
        f'  <text x="64" y="86" fill="{L_SECOND}" font-size="15">Three moments in a quarter. You start every one of them, and you finish every one of them.</text>',
        "  " + body,
        f'  <text x="64" y="{h-26}" fill="{L_MUTED}" font-size="12">CreditScout · synthetic data only · the agent recommends, a human decides</text>',
        '</svg>',
        '',
    ])


P = []

# Card heights are driven by the longest body: with a step badge the first body
# line sits 78px below the card top and each line is 18 more. Three lines needs
# 136, four needs 154. They were 104 and the last line fell out of the card.
H3, H4 = 136, 154

# ----------------------------------------------------------------- flow 1
y = 152
P.append(flow(64, y, 1, "Onboarding a loan", "once per loan \u2014 and again when an amendment arrives"))
ry, mid = y + 24, y + 24 + H3 / 2
P.append(avatar(86, mid))
P.append(card(118, ry, 262, H3, "You add the borrower", ["Name, industry and the documents,", "all on one screen. Every file is", "classified as you drop it in."], "you", step=1))
P.append(hop(386, mid, 410))
P.append(card(410, ry, 288, H3, "It reads the agreement", ["The definitions article and every", "amendment on file \u2014 and quotes", "back what it found."], "model", step=2))
P.append(hop(704, mid, 728))
P.append(card(728, ry, 268, H3, "Code checks the work", ["Every term needs a citation and a", "verbatim quote, or it does not", "reach you."], "code", step=3))
P.append(hop(1002, mid, 1026))
P.append(avatar(1048, mid))
P.append(card(1080, ry, 226, H3, "You approve", ["Nothing can be tested", "until you say so."], "you", step=4))
P.append(hop(1312, mid, 1336))
P.append(card(1336, ry, 264, H3, "The terms go live", ["Version 1, effective-dated. An", "amendment makes version 2 \u2014", "it never overwrites."]))

# ----------------------------------------------------------------- flow 2
y = 364
P.append(flow(64, y, 2, "The quarterly test", "every loan, every quarter \u2014 no AI anywhere in this row"))
ry, mid = y + 24, y + 24 + H3 / 2
P.append(avatar(86, mid))
P.append(card(118, ry, 262, H3, "You press one button", ["Runs the whole book for", "the quarter."], "you", step=1))
P.append(hop(386, mid, 410))
P.append(card(410, ry, 288, H3, "We compute every test", ["From the approved terms only.", "A missing input is refused, never", "guessed at."], "code", step=2))
P.append(hop(704, mid, 728))
P.append(card(728, ry, 268, H3, "We compare", ["Our figure against the one the", "borrower reported."], "code", step=3))
P.append(f'<path d="M1002,{mid} H1018 V{ry+32} H1034" fill="none" stroke="{L_EDGE}" stroke-width="2" marker-end="url(#l)"/>')
P.append(f'<path d="M1002,{mid} H1018 V{ry+104} H1034" fill="none" stroke="{L_EDGE}" stroke-width="2" marker-end="url(#l)"/>')
P.append(f'<rect x="1038" y="{ry+10}" width="562" height="44" rx="14" fill="{L_CARD}" stroke="{L_EDGE}" stroke-width="1.4"/>')
P.append(f'<text x="1060" y="{ry+31}" fill="{L_TEXT}" font-size="14.5" font-weight="700">It passes \u2014 nothing to do</text>')
P.append(f'<text x="1060" y="{ry+47}" fill="{L_SECOND}" font-size="12.5">a disagreement with the borrower\u2019s own figure is still logged</text>')
P.append(f'<rect x="1038" y="{ry+82}" width="562" height="44" rx="14" fill="{L_CARD}" stroke="{L_EDGE}" stroke-width="1.4"/>')
P.append(f'<text x="1060" y="{ry+103}" fill="{L_TEXT}" font-size="14.5" font-weight="700">It fails \u2014 an exception is raised</text>')
P.append(f'<text x="1060" y="{ry+119}" fill="{L_SECOND}" font-size="12.5">OUR figure raises it, never theirs</text>')

# ----------------------------------------------------------------- flow 3
y = 576
P.append(flow(64, y, 3, "The investigation", "only when a test fails \u2014 and only when you ask for it"))
ry, mid = y + 24, y + 24 + H4 / 2
P.append(avatar(86, mid))
P.append(card(118, ry, 262, H4, "You press Investigate", ["Nothing runs unasked. This is", "the only thing that starts it."], "you", step=1))
P.append(hop(386, mid, 410))
P.append(card(410, ry, 340, H4, "The agent goes and looks", ["It plans, reads what it chooses to", "read, asks a specialist when it needs", "one, and re-calculates. It stops when", "the evidence is enough."], "model", step=2))
P.append(hop(756, mid, 780))
P.append(card(780, ry, 300, H4, "Guardrails check it", ["Six of them, in plain code. A figure", "with no calculation behind it and no", "quote to stand on forces the answer", "back to \u201cabstain\u201d."], "code", step=3))
P.append(hop(1086, mid, 1110))
P.append(card(1110, ry, 228, H4, "A recommendation", ["With its calculations, its", "citations, and whatever is", "still unresolved."], "plain", step=4))
P.append(hop(1344, mid, 1368))
P.append(avatar(1390, mid))
P.append(card(1422, ry, 178, H4, "You decide", ["Approve or override.", "Yours is the decision", "of record."], "you", step=5))

# ----------------------------------------------------------------- the tools
ty = 790
P.append(f'<text x="64" y="{ty}" fill="{L_TEXT}" font-size="15.5" font-weight="700">What the agent can reach for, in step 2</text>')
P.append(f'<text x="64" y="{ty+21}" fill="{L_MUTED}" font-size="13.5">Six tools. It chooses which, and when — nothing is handed to it in advance.</text>')
tools = [("search_documents", "code"), ("dscr_calculator", "code"), ("search_past_cases", "code"),
         ("definition_agent", "model"), ("research_agent", "model"), ("document_agent", "model")]
tx = 64
for name, kind in tools:
    col, bg, bd = (L_MODEL, L_MODEL_BG, L_MODEL) if kind == "model" else (L_CODE, L_CODE_BG, L_CODE)
    P.append(f'<rect x="{tx}" y="{ty+36}" width="238" height="40" rx="20" fill="{bg}" stroke="{bd}" stroke-width="1.3"/>')
    P.append(f'<text x="{tx+119}" y="{ty+61}" fill="{col}" font-size="13.5" font-family="{MONO}" text-anchor="middle">{name}</text>')
    tx += 250

# ----------------------------------------------------------------- the footer
fy = 898
P.append(f'<line x1="64" y1="{fy}" x2="1600" y2="{fy}" stroke="{L_EDGE}" stroke-width="1"/>')
P.append(f'<text x="64" y="{fy+30}" fill="{L_TEXT}" font-size="14.5">It remembers. A decision you record becomes a lesson, and the next similar exception starts with that lesson in hand.</text>')
P.append(f'<text x="64" y="{fy+54}" fill="{L_MUTED}" font-size="13">Across three live runs that has not made investigations shorter. The effect is neutral, and we do not claim otherwise.</text>')

write("creditscout-user-flow.svg", ldoc(1664, 1012, "\n  ".join(P)))
print("user flow written")

# ========================================================= ARCHITECTURE
#
# An architecture review, not a pitch. Responsibilities, boundaries and short
# descriptions; the longer explanations are numbered notes beneath the drawing
# and the versions and filenames are in one strip at the foot.
#
# TWO CLAIMS WERE CORRECTED HERE, both of which had been overstated:
#
#   "The model never produces a number" — too absolute. The agent supplies the
#   inputs and the term definitions a calculation runs on. What is true, and
#   what matters, is that covenant results are CALCULATED AND VALIDATED BY
#   APPLICATION CODE.
#
#   "Neither reachable by the model" — ambiguous, since the agent does invoke
#   the calculator. The accurate statement is that it can request a calculation
#   and supply its inputs, and cannot change the calculation logic or the
#   validation rules.
#
# AND ONE CONNECTOR WAS WRONG. The specialists are serviced IN-PROCESS by the
# application (`orchestrator.ts`: "they have no route"), and they reach
# documents through the application's own retrieval, never through the tool
# gateway and never with a database handle of their own. The old drawing let
# both of those be read the other way.

A_BG, A_CARD, A_EDGE = "#F7F9FA", "#FFFFFF", "#C7D3DA"
A_TEXT, A_SECOND, A_MUTED = "#19282F", "#52646D", "#6B7C85"
A_TEAL, A_TEAL_SOFT = "#146C67", "#E8F2F1"
A_ZONE = {
    "Experience": "#EEF2F4",
    "Application": "#EDF2F1",
    "Investigation": "#E9F0F3",
    "Data": "#EFF1F2",
}
A_LINE, A_DATA_LINE = "#8B9BA5", "#B3C0C8"

A = []


def zone(x, y, w, h, label):
    return "\n  ".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{A_ZONE[label]}" stroke="{A_EDGE}" stroke-width="1" stroke-dasharray="2 4"/>',
        f'<text x="{x+18}" y="{y+24}" fill="{A_MUTED}" font-size="11.5" font-weight="700" letter-spacing="1.4">{esc(label.upper())}</text>',
    ])


def comp(x, y, w, h, n, title, lines, accent=False, approval=False):
    """One component: a number, a title, and at most two short lines."""
    edge = A_TEAL if accent else A_EDGE
    o = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{A_CARD}" stroke="{edge}" stroke-width="{1.6 if accent else 1.2}"/>']
    o.append(f'<circle cx="{x+24}" cy="{y+24}" r="11.5" fill="{A_TEAL_SOFT}" stroke="{A_TEAL}" stroke-width="1.2"/>')
    o.append(f'<text x="{x+24}" y="{y+28.5}" fill="{A_TEAL}" font-size="12" font-weight="700" text-anchor="middle">{n}</text>')
    o.append(f'<text x="{x+46}" y="{y+29}" fill="{A_TEXT}" font-size="15.5" font-weight="700">{esc(title)}</text>')
    for i, ln in enumerate(lines):
        o.append(f'<text x="{x+20}" y="{y+52+i*17}" fill="{A_SECOND}" font-size="12.5">{esc(ln)}</text>')
    if approval:
        o.append(f'<rect x="{x+w-122}" y="{y+h-30}" width="104" height="21" rx="10.5" fill="{A_TEAL_SOFT}" stroke="{A_TEAL}" stroke-width="1"/>')
        o.append(f'<text x="{x+w-70}" y="{y+h-15.5}" fill="{A_TEAL}" font-size="10" font-weight="700" letter-spacing="0.3" text-anchor="middle">HUMAN APPROVAL</text>')
    return "\n  ".join(o)


def link(pts, label=None, lx=None, ly=None, data=False, both=False):
    """A connector. Solid = request/response, dashed = data access."""
    col = A_DATA_LINE if data else A_LINE
    dash = ' stroke-dasharray="5 4"' if data else ""
    d = " ".join(("M" if i == 0 else "L") + f"{p[0]},{p[1]}" for i, p in enumerate(pts))
    o = [f'<path d="{d}" fill="none" stroke="{col}" stroke-width="1.5"{dash} marker-end="url(#ar)"'
         + (' marker-start="url(#as)"' if both else "") + '/>']
    if label:
        o.append(f'<text x="{lx}" y="{ly}" fill="{A_MUTED}" font-size="11.5" text-anchor="middle">{esc(label)}</text>')
    return "\n  ".join(o)


def note(x, y, n, text_lines):
    o = [f'<text x="{x}" y="{y}" fill="{A_TEAL}" font-size="12" font-weight="700">{n}</text>']
    for i, ln in enumerate(text_lines):
        o.append(f'<text x="{x+18}" y="{y+i*16}" fill="{A_SECOND}" font-size="12.3">{esc(ln)}</text>')
    return "\n  ".join(o)


# ----------------------------------------------------------------- zones
#
# Wide gaps between zones on purpose: a connector's label belongs in the gap,
# not on top of the component it points at.
A.append(zone(56, 128, 360, 152, "Experience"))
A.append(zone(526, 128, 640, 480, "Application"))
A.append(zone(1276, 128, 332, 152, "Investigation"))
A.append(zone(56, 636, 1552, 124, "Data"))

# ----------------------------------------------------------------- row 1
A.append(comp(76, 162, 320, 100, 1, "Analyst workspace",
              ["Review exceptions, inspect evidence, approve",
               "covenant terms, and record decisions."], approval=True))
A.append(comp(546, 162, 600, 100, 2, "Application services",
              ["Onboarding, document processing, covenant tests,",
               "investigations, and analyst reviews."]))
A.append(comp(1296, 162, 292, 100, 3, "Investigation orchestrator",
              ["Selects evidence, requests calculations,",
               "and delegates research tasks."], accent=True))

A.append(link([(396, 194), (546, 194)], "Starts investigation", 471, 184))
A.append(link([(546, 236), (396, 236)], "Records decision", 471, 256))
A.append(link([(1146, 194), (1296, 194)], "Starts run", 1221, 184))
A.append(link([(1296, 236), (1146, 236)], "Returns findings", 1221, 256))

# ----------------------------------------------------------------- row 2
A.append(comp(576, 330, 280, 92, 4, "Specialist services",
              ["Covenant interpretation, document review,",
               "targeted research."], accent=True))
A.append(comp(896, 330, 280, 92, 5, "Tool gateway",
              ["Exposes the approved operations available",
               "to the agent."]))

# the orchestrator reaches the gateway for evidence and calculations, and the
# specialists through the application, which services those calls in-process.
A.append(link([(1442, 262), (1442, 292), (1036, 292), (1036, 330)], "Requests evidence \u00b7 Runs calculation", 1200, 284))
A.append(link([(1340, 262), (1340, 310), (716, 310), (716, 330)], "Delegates research task", 930, 324))

# ----------------------------------------------------------------- row 3
A.append(comp(576, 470, 280, 100, 7, "Document retrieval",
              ["Processes documents into searchable",
               "sections; returns relevant passages."]))
A.append(comp(896, 470, 280, 100, 6, "Calculation and validation",
              ["Computes covenant results from supplied",
               "inputs; validates the answer."]))

A.append(link([(716, 422), (716, 470)], "In-process", 676, 450))
A.append(link([(1036, 422), (1036, 470)], "Calculates", 1078, 450))
A.append(link([(936, 422), (936, 446), (816, 446), (816, 470)], "Retrieves", 876, 440))

# ----------------------------------------------------------------- data
A.append(comp(76, 672, 1512, 76, 8, "Case data and history",
              ["Borrower records, document sections, versioned covenant terms, tests, investigations, calculations, decisions, lessons, evaluations."]))
A.append(link([(566, 262), (566, 286), (466, 286), (466, 672)], "Reads \u00b7 writes", 500, 470, data=True))
A.append(link([(716, 570), (716, 672)], "", data=True))
A.append(link([(1036, 570), (1036, 672)], "", data=True))

# ----------------------------------------------------------------- legend
LX, LY = 1040, 54
A.append(f'<line x1="{LX}" y1="{LY}" x2="{LX+26}" y2="{LY}" stroke="{A_LINE}" stroke-width="1.5" marker-end="url(#ar)"/>')
A.append(f'<text x="{LX+34}" y="{LY+4}" fill="{A_SECOND}" font-size="12">Request / response</text>')
A.append(f'<line x1="{LX+160}" y1="{LY}" x2="{LX+186}" y2="{LY}" stroke="{A_DATA_LINE}" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ar)"/>')
A.append(f'<text x="{LX+194}" y="{LY+4}" fill="{A_SECOND}" font-size="12">Data access</text>')
A.append(f'<rect x="{LX+292}" y="{LY-10}" width="104" height="21" rx="10.5" fill="{A_TEAL_SOFT}" stroke="{A_TEAL}" stroke-width="1"/>')
A.append(f'<text x="{LX+344}" y="{LY+4.5}" fill="{A_TEAL}" font-size="10" font-weight="700" letter-spacing="0.3" text-anchor="middle">HUMAN APPROVAL</text>')
A.append(f'<text x="{LX+406}" y="{LY+4}" fill="{A_SECOND}" font-size="12">Decision point</text>')

# ----------------------------------------------------------------- notes
NY = 820
A.append(f'<line x1="56" y1="{NY-32}" x2="1608" y2="{NY-32}" stroke="{A_EDGE}" stroke-width="1"/>')
A.append(f'<text x="56" y="{NY-8}" fill="{A_TEXT}" font-size="14" font-weight="700">Notes</text>')
col2 = 852
A.append(note(56, NY + 16, "1", ["Authenticated access. Server-side authorization controls what each",
                                 "request may read and change."]))
A.append(note(56, NY + 58, "2", ["Services the agent's specialist calls in-process: those have no HTTP",
                                 "route. Quarterly covenant tests call the calculation service directly,",
                                 "with no agent involved."]))
A.append(note(56, NY + 116, "3", ["Starts from the document inventory — titles, types and dates — and",
                                  "retrieves source passages as needed. Relevant prior lessons are",
                                  "supplied as additional context."]))
A.append(note(56, NY + 174, "4", ["Operate within the investigation's case scope. The borrower and the",
                                  "period come from the casefile, not from the agent's arguments."]))
A.append(note(col2, NY + 16, "5", ["Requests are authenticated and scoped to the active case.",
                                   "The agent has no direct database access."]))
A.append(note(col2, NY + 58, "6", ["Missing required inputs return an explicit error rather than a",
                                   "default. The agent can request a calculation and supply its inputs;",
                                   "it cannot change the calculation logic or the validation rules."]))
A.append(note(col2, NY + 116, "7", ["Sections are embedded once at upload and searched per request.",
                                    "Original uploads are not retained: a document is its indexed",
                                    "sections, and every citation resolves to one of them."]))
A.append(note(col2, NY + 174, "8", ["Row-level security applies to every read. Covenant terms are",
                                    "versioned and effective-dated; an amendment supersedes."]))

# ------------------------------------------------- implementation details
IY = 1038
A.append(f'<rect x="56" y="{IY}" width="1552" height="58" rx="10" fill="{A_CARD}" stroke="{A_EDGE}" stroke-width="1.2"/>')
A.append(f'<text x="76" y="{IY+22}" fill="{A_MUTED}" font-size="11" font-weight="700" letter-spacing="1.3">IMPLEMENTATION DETAILS</text>')
A.append(f'<text x="76" y="{IY+43}" fill="{A_SECOND}" font-size="12.3" font-family="{MONO}">Next.js on Vercel  ·  Azure AI Foundry, gpt-4.1-mini orchestrator  ·  gpt-5-mini specialists  ·  text-embedding-3-small, 1536 dimensions  ·  calc/dscr.js  ·  guardrails/*.js  ·  Postgres + pgvector</text>')

# ------------------------------------------------------- control summary
CY = 1130
A.append(f'<text x="56" y="{CY}" fill="{A_TEXT}" font-size="14.5" font-weight="700">Control summary</text>')
A.append(f'<text x="56" y="{CY+24}" fill="{A_SECOND}" font-size="13.5">The agent directs the investigation. Application code calculates and validates the result. An analyst records the decision.</text>')


def adoc(w, h, body):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{SANS}">'
    return "\n".join([
        head,
        '  <defs>',
        '    <marker id="ar" markerWidth="8" markerHeight="7" refX="7.5" refY="3.5" orient="auto">',
        f'      <path d="M0,0 L8,3.5 L0,7 Z" fill="{A_LINE}"/>',
        '    </marker>',
        '    <marker id="as" markerWidth="8" markerHeight="7" refX="0.5" refY="3.5" orient="auto">',
        f'      <path d="M8,0 L0,3.5 L8,7 Z" fill="{A_LINE}"/>',
        '    </marker>',
        '  </defs>',
        f'  <rect width="{w}" height="{h}" fill="{A_BG}"/>',
        f'  <text x="56" y="56" fill="{A_TEXT}" font-size="26" font-weight="700" letter-spacing="-0.4">CreditScout architecture</text>',
        f'  <text x="56" y="84" fill="{A_SECOND}" font-size="14">An analyst-led investigation workflow with agent orchestration, deterministic calculations, and server-enforced controls.</text>',
        "  " + body,
        '</svg>',
        '',
    ])


write("creditscout-architecture.svg", adoc(1664, 1178, "\n  ".join(A)))
print("architecture written")
