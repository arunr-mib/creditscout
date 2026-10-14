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

write("creditscout-user-flow.svg", ldoc(1664, 1012, "\n  ".join(P)))
print("user flow written")

# ========================================================= ARCHITECTURE
#
# Four bands, read top to bottom: who uses it, what runs it, what the agent is
# allowed to do, and where things are kept. Each band carries its own one-line
# purpose on the rail, so the picture explains itself before any box is read.
#
# WHAT THIS DELIBERATELY DOES NOT CARRY: model versions, embedding dimensions
# and filenames. Those are deployment facts and they belong in deployment
# documentation, where they can change without redrawing the architecture.
#
# TWO CLAIMS WERE CORRECTED WHEN THIS WAS REDRAWN, both overstated before:
#
#   "The model never produces a number" — too absolute. The agent supplies the
#   inputs and the term definitions a calculation runs on. What is true: the
#   result is calculated and validated by application code.
#
#   "Neither reachable by the model" — ambiguous, since the agent does invoke
#   the calculator. It can request a calculation; it cannot change the
#   calculation logic or the validation rules.
#
# ON THE GATEWAY AND THE SPECIALISTS: the three specialists are serviced
# in-process (`orchestrator.ts`: "they have no route"), while retrieval and the
# calculator are HTTP routes carrying a key. That difference is TRANSPORT, and
# transport is a deployment fact. What holds for all three, and what this band
# claims, is that they are approved operations scoped to the active case: the
# borrower and the period come from the casefile, never from the agent's
# arguments. The gateway bar is drawn over all three on that basis.

A_BG, A_CARD, A_EDGE = "#F5F8F9", "#FFFFFF", "#CBD6DB"
A_TEXT, A_SECOND, A_MUTED = "#15232A", "#4E6069", "#7C8B93"
A_TEAL = "#146C67"
A_BAND = "#EEF3F4"
A_LINE = "#5E7984"

A = []


def icon(kind, x, y, col=A_TEAL, s=1.0):
    """A 34px line icon, drawn here so the set stays consistent."""
    def p(d, w=2.0, fill="none"):
        return f'<path d="{d}" fill="{fill}" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
    g = {
        "person": f'<circle cx="{x+17}" cy="{y+12}" r="6.5" fill="none" stroke="{col}" stroke-width="2"/>'
                  + p(f"M{x+5},{y+30} a12,10 0 0 1 24,0"),
        "window": p(f"M{x+3},{y+7} h28 a2,2 0 0 1 2,2 v16 a2,2 0 0 1 -2,2 h-28 a2,2 0 0 1 -2,-2 v-16 a2,2 0 0 1 2,-2 z")
                  + p(f"M{x+1},{y+14} h32", 1.6)
                  + f'<circle cx="{x+6}" cy="{y+10.5}" r="1.4" fill="{col}"/>',
        "gear": f'<circle cx="{x+17}" cy="{y+18}" r="5" fill="none" stroke="{col}" stroke-width="2"/>'
                + p(f"M{x+17},{y+18} m0,-11 a11,11 0 1 1 -0.1,0 z", 2.0)
                + p(f"M{x+17},{y+5} v3 M{x+17},{y+28} v3 M{x+4},{y+18} h3 M{x+27},{y+18} h3"
                    f" M{x+8},{y+9} l2,2 M{x+24},{y+25} l2,2 M{x+26},{y+9} l-2,2 M{x+10},{y+25} l-2,2", 1.8),
        "shield": p(f"M{x+17},{y+4} l12,5 v9 c0,8 -5,13 -12,16 c-7,-3 -12,-8 -12,-16 v-9 z")
                  + p(f"M{x+11},{y+18} l4,4 l8,-8", 2.1),
        "doc": p(f"M{x+6},{y+4} h14 l8,8 v20 a2,2 0 0 1 -2,2 h-20 a2,2 0 0 1 -2,-2 v-26 a2,2 0 0 1 2,-2 z")
               + p(f"M{x+20},{y+4} v8 h8", 1.7)
               + p(f"M{x+11},{y+21} h12 M{x+11},{y+27} h12", 1.7),
        "people": f'<circle cx="{x+11}" cy="{y+12}" r="5" fill="none" stroke="{col}" stroke-width="1.9"/>'
                  + f'<circle cx="{x+24}" cy="{y+13}" r="4.2" fill="none" stroke="{col}" stroke-width="1.9"/>'
                  + p(f"M{x+2},{y+29} a9,8 0 0 1 18,0", 1.9)
                  + p(f"M{x+20},{y+29} a7,6 0 0 1 13,0", 1.9),
        "calc": p(f"M{x+6},{y+4} h22 a2,2 0 0 1 2,2 v26 a2,2 0 0 1 -2,2 h-22 a2,2 0 0 1 -2,-2 v-26 a2,2 0 0 1 2,-2 z")
                + p(f"M{x+9},{y+10} h16 v5 h-16 z", 1.7)
                + f'<circle cx="{x+11}" cy="{y+22}" r="1.5" fill="{col}"/><circle cx="{x+17}" cy="{y+22}" r="1.5" fill="{col}"/>'
                + f'<circle cx="{x+23}" cy="{y+22}" r="1.5" fill="{col}"/><circle cx="{x+11}" cy="{y+28}" r="1.5" fill="{col}"/>'
                + f'<circle cx="{x+17}" cy="{y+28}" r="1.5" fill="{col}"/><circle cx="{x+23}" cy="{y+28}" r="1.5" fill="{col}"/>',
        "db": f'<ellipse cx="{x+17}" cy="{y+9}" rx="12" ry="4.6" fill="none" stroke="{col}" stroke-width="2"/>'
              + p(f"M{x+5},{y+9} v18 c0,2.6 5.4,4.6 12,4.6 s12,-2 12,-4.6 v-18")
              + p(f"M{x+5},{y+18} c0,2.6 5.4,4.6 12,4.6 s12,-2 12,-4.6", 1.7),
    }
    return g.get(kind, "")


def band(y, h, label, lines):
    o = [f'<rect x="48" y="{y}" width="1504" height="{h}" rx="14" fill="{A_BAND}" stroke="{A_EDGE}" stroke-width="1"/>',
         f'<text x="72" y="{y+34}" fill="{A_TEXT}" font-size="13" font-weight="700" letter-spacing="1.5">{esc(label)}</text>']
    for i, ln in enumerate(lines):
        o.append(f'<text x="72" y="{y+56+i*17}" fill="{A_MUTED}" font-size="12.5">{esc(ln)}</text>')
    return "\n  ".join(o)


def comp(x, y, w, h, title, sub, ic=None, foot=None, top=False):
    """`top` anchors the text to the card's head, for a card that carries
    something else below it — the gateway's tool chips."""
    o = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{A_CARD}" stroke="{A_EDGE}" stroke-width="1.2"/>']
    tx = x + (76 if ic else 24)
    base = y + 36 if top else y + h / 2 - 4
    if ic:
        o.append(icon(ic, x + 24, (y + 8) if top else (y + (h - 34) / 2)))
    o.append(f'<text x="{tx}" y="{base}" fill="{A_TEXT}" font-size="17" font-weight="700">{esc(title)}</text>')
    o.append(f'<text x="{tx}" y="{base+20}" fill="{A_SECOND}" font-size="13.5">{esc(sub)}</text>')
    if foot:
        o.append(f'<text x="{tx}" y="{base+40}" fill="{A_MUTED}" font-size="12.5">{esc(foot)}</text>')
    return "\n  ".join(o)


def arr(pts, label=None, lx=None, ly=None, both=False, turn=False):
    d = " ".join(("M" if i == 0 else "L") + f"{p[0]},{p[1]}" for i, p in enumerate(pts))
    o = [f'<path d="{d}" fill="none" stroke="{A_LINE}" stroke-width="1.6" marker-end="url(#ae)"'
         + (' marker-start="url(#as)"' if both else "") + "/>"]
    if label:
        # `turn` sets the label along a vertical run, where a horizontal one
        # would be written across the line it belongs to.
        rot = f' transform="rotate(-90 {lx} {ly})"' if turn else ""
        o.append(f'<text x="{lx}" y="{ly}" fill="{A_SECOND}" font-size="13" text-anchor="middle"{rot}>{esc(label)}</text>')
    return "\n  ".join(o)


def logo(x, y):
    """The CreditScout reticle and wordmark, mapped for a light page."""
    k = 0.42
    return "\n  ".join([
        f'<g transform="translate({x},{y}) scale({k})" fill="none" stroke-linecap="round" stroke-linejoin="round">',
        f'  <path d="M39 20h-9a10 10 0 0 0-10 10v9M73 20h9a10 10 0 0 1 10 10v9M92 73v9a10 10 0 0 1-10 10h-9M20 73v9a10 10 0 0 0 10 10h9" stroke="{A_TEXT}" stroke-width="6.5"/>',
        f'  <path d="M37 56h38" stroke="{A_TEAL}" stroke-width="4.5"/>',
        f'  <circle cx="39" cy="56" r="4.5" fill="{A_TEAL}"/>',
        f'  <circle cx="56" cy="56" r="6" fill="{A_TEAL}"/>',
        f'  <circle cx="74" cy="56" r="4.5" fill="{A_TEAL}"/>',
        f'  <path d="M56 44v-7" stroke="{A_TEAL}" stroke-width="3.5"/>',
        '</g>',
        f'<text x="{x+56}" y="{y+32}" font-size="20" font-weight="700" letter-spacing="1.6">'
        f'<tspan fill="{A_TEXT}">CREDIT</tspan><tspan fill="{A_TEAL}">SCOUT</tspan></text>',
    ])


# ----------------------------------------------------------------- bands
#
# One centred content column, 296..1496, for every band. The rail sits to its
# left; the gutters either side of the column are even.
C0, C1 = 296, 1496          # the content column
HALF = 540                  # a two-up card, with a gap wide enough for a label
THIRD = 380                 # a three-up card
LC, RC = C0 + HALF / 2, C1 - HALF / 2

A.append(band(118, 132, "EXPERIENCE", ["Analysts review results", "and make decisions."]))
A.append(band(274, 150, "APPLICATION", ["Run investigations", "and orchestrate analysis."]))
A.append(band(448, 342, "CONTROLLED OPERATIONS", ["The agent works through", "approved, case-scoped", "operations."]))
A.append(band(814, 152, "DATA", ["Persistent case data", "with secure access."]))

# ----------------------------------------------------------------- experience
A.append(comp(C0, 140, HALF, 88, "Analyst workspace", "Review exceptions and inspect evidence", "person"))
A.append(comp(C1 - HALF, 140, HALF, 88, "Analyst decision", "Approve, override, or request more evidence", "person"))
A.append(arr([(C1 - HALF, 184), (C0 + HALF, 184)], "Record decision", (C0 + HALF + C1 - HALF) / 2, 174))

# ----------------------------------------------------------------- application
A.append(comp(C0, 296, HALF, 106, "Application services", "Authorize access and manage investigations", "window", foot="Next.js \u00b7 Vercel"))
A.append(comp(C1 - HALF, 296, HALF, 106, "Investigation orchestrator", "Select evidence and coordinate analysis", "gear", foot="Azure AI Foundry"))
A.append(arr([(LC, 228), (LC, 296)], "Start investigation", LC + 96, 266))
A.append(arr([(C0 + HALF, 349), (C1 - HALF, 349)], "Coordinate run", (C0 + HALF + C1 - HALF) / 2, 339))
A.append(arr([(RC, 296), (RC, 228)], "Validated recommendation", RC + 128, 266))

# ------------------------------------------------------- controlled operations
#
# THE SIX TOOLS, NAMED. Three are deterministic code and three are specialist
# models; they sit inside one control boundary because the control is the same
# for all six — scope comes from the casefile, never from the agent's
# arguments. The tint is the only thing that separates them, which is the
# honest amount of separation: the difference is what runs, not what is
# permitted.
A.append(comp(C0, 486, C1 - C0, 118, "Tool gateway", "Approved operations, scoped to the active case", "shield", top=True))
TOOLS = [("search_documents", False), ("dscr_calculator", False), ("search_past_cases", False),
         ("definition_agent", True), ("research_agent", True), ("document_agent", True)]
cw, gap = 182, 14
tx = C0 + 20
for name, is_model in TOOLS:
    fill, edge, col = ("#E8F2F1", A_TEAL, A_TEAL) if is_model else (A_BG, A_EDGE, A_SECOND)
    A.append(f'<rect x="{tx}" y="562" width="{cw}" height="30" rx="15" fill="{fill}" stroke="{edge}" stroke-width="1.1"/>')
    A.append(f'<text x="{tx+cw/2}" y="582" fill="{col}" font-size="12.5" font-family="{MONO}" text-anchor="middle">{name}</text>')
    tx += cw + gap
A.append(f'<text x="{C1-20}" y="516" fill="{A_MUTED}" font-size="11.5" text-anchor="end">three deterministic tools \u00b7 three specialist models</text>')

A.append(arr([(RC, 402), (RC, 486)], "Request / result", RC + 92, 448, both=True))

TC = [C0, C0 + THIRD + 30, C0 + 2 * (THIRD + 30)]
A.append(comp(TC[0], 648, THIRD, 112, "Document retrieval", "Find passages and prior lessons", "doc"))
A.append(comp(TC[1], 648, THIRD, 112, "Specialist services", "Interpret terms, answer questions", "people"))
A.append(comp(TC[2], 648, THIRD, 112, "Calculation & validation", "Compute results, apply policy", "calc"))
for c in TC:
    A.append(arr([(c + THIRD / 2, 604), (c + THIRD / 2, 648)], "Request / result", c + THIRD / 2 + 92, 628, both=True))

# ----------------------------------------------------------------- data
A.append(comp(C0, 838, C1 - C0, 104, "Case data and history",
              "Documents \u00b7 Approved terms \u00b7 Tests \u00b7 Investigations \u00b7 Calculations \u00b7 Decisions \u00b7 Lessons",
              "db", foot="Postgres \u00b7 pgvector \u00b7 Row-level security"))

# the connector used to end on the card's rounded corner; it meets the edge at
# mid-height now, where an arrowhead reads as arriving rather than clipping.
A.append(arr([(C0, 360), (252, 360), (252, 890), (C0, 890)], "Read / write", 240, 640, both=True, turn=True))
A.append(arr([(TC[0] + THIRD / 2, 760), (TC[0] + THIRD / 2, 838)], "Search sections and lessons", TC[0] + THIRD / 2 + 134, 800))

# THE LOOP CLOSES. A recorded decision becomes a lesson, and a later
# investigation retrieves it through the same gateway as any other evidence.
A.append(arr([(C1, 212), (1540, 212), (1540, 890), (C1, 890)], "Decision recorded as a lesson", C1 - 108, 806))

# ----------------------------------------------------------------- footer
FY = 1012
A.append(f'<line x1="48" y1="{FY-26}" x2="1552" y2="{FY-26}" stroke="{A_EDGE}" stroke-width="1"/>')
A.append(f'<text x="48" y="{FY}" fill="{A_TEXT}" font-size="14">The agent directs the investigation. Application code calculates and validates results. An analyst records the decision.</text>')
A.append(f'<text x="1552" y="{FY}" fill="{A_MUTED}" font-size="12.5" text-anchor="end">Model versions and infrastructure details belong in deployment documentation.</text>')


def adoc(w, h, body):
    return "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{SANS}">',
        '  <defs>',
        '    <marker id="ae" markerWidth="9" markerHeight="8" refX="8.5" refY="4" orient="auto">',
        f'      <path d="M0,0 L9,4 L0,8 Z" fill="{A_LINE}"/>',
        '    </marker>',
        '    <marker id="as" markerWidth="9" markerHeight="8" refX="0.5" refY="4" orient="auto">',
        f'      <path d="M9,0 L0,4 L9,8 Z" fill="{A_LINE}"/>',
        '    </marker>',
        '  </defs>',
        f'  <rect width="{w}" height="{h}" fill="{A_BG}"/>',
        f'  <text x="48" y="58" fill="{A_TEXT}" font-size="30" font-weight="700" letter-spacing="-0.6">CreditScout architecture</text>',
        f'  <text x="48" y="88" fill="{A_SECOND}" font-size="16">Agent orchestration. Deterministic calculations. Analyst decisions.</text>',
        "  " + logo(1330, 26),
        "  " + body,
        '</svg>',
        '',
    ])


write("creditscout-architecture.svg", adoc(1600, 1046, "\n  ".join(A)))
print("architecture written")
