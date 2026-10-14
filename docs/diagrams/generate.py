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
A = []
RAIL, CX, CW = 64, 238, 1362

# ---------------------------------------------------------------- brand marks
#
# THE REAL MARKS, not approximations. Vercel, Node.js and Supabase come from
# simple-icons (the icon files are CC0; the trademarks remain their owners').
# Azure comes from devicons (MIT) with its gradients flattened to Azure blue —
# Microsoft's marks are not in simple-icons, which honours their removal
# request. Using them here identifies the actual platform in an architecture
# diagram, which is what they are for.
#
# Each entry is (viewBox size, [paths], brand colour). `mark()` scales to 20px.
LOGOS = {
    "vercel": (24, [
        'M24 22.525H0l12-21.05 12 21.05z',
    ], "#FFFFFF"),
    "azure": (128, [
        'M46.09.002h40.685L44.541 125.137a6.485 6.485 0 01-6.146 4.413H6.733a6.482 6.482 0 01-5.262-2.699 6.474 6.474 0 01-.876-5.848L39.944 4.414A6.488 6.488 0 0146.09 0z',
        'M97.28 81.607H37.987a2.743 2.743 0 00-1.874 4.751l38.1 35.562a5.991 5.991 0 004.087 1.61h33.574z',
        'M46.09.002A6.434 6.434 0 0039.93 4.5L.644 120.897a6.469 6.469 0 006.106 8.653h32.48a6.942 6.942 0 005.328-4.531l7.834-23.089 27.985 26.101a6.618 6.618 0 004.165 1.519h36.396l-15.963-45.616-46.533.011L86.922.002z',
        'M98.055 4.408A6.476 6.476 0 0091.917.002H46.575a6.478 6.478 0 016.137 4.406l39.35 116.594a6.476 6.476 0 01-6.137 8.55h45.344a6.48 6.48 0 006.136-8.55z',
    ], "#2E8FDF"),
    "node": (24, [
        'M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L3.075,6.68C2.99,6.729,2.936,6.825,2.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L2.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z',
    ], "#5FA04E"),
    "supabase": (24, [
        'M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z',
    ], "#3FCF8E"),
}

BROWSER_GLYPH = "browser"  # drawn, not a brand: the analyst's browser has no vendor


def mark(kind, x, y, col):
    """A 20px mark for the rail."""
    if kind == BROWSER_GLYPH:
        return (f'<rect x="{x}" y="{y}" width="20" height="16" rx="2.5" fill="none" stroke="{col}" stroke-width="1.6"/>'
                f'<line x1="{x}" y1="{y+5.5}" x2="{x+20}" y2="{y+5.5}" stroke="{col}" stroke-width="1.6"/>'
                f'<circle cx="{x+3.4}" cy="{y+2.9}" r="1" fill="{col}"/>')
    logo = LOGOS.get(kind)
    if not logo:
        return ""
    vb, paths, brand = logo
    k = 20 / vb
    body = "".join(f'<path d="{d}" fill="{brand}"/>' for d in paths)
    return f'<g transform="translate({x},{y}) scale({k:.6f})">{body}</g>'


def band(y, name, note, glyph=None):
    tx = RAIL + (30 if glyph else 0)
    if glyph:
        A.append(mark(glyph, RAIL, y + 6, SECOND))
    A.append(f'<text x="{tx}" y="{y+22}" fill="{TEXT}" font-size="16" font-weight="700" letter-spacing="-0.2">{esc(name)}</text>')
    A.append(f'<text x="{RAIL}" y="{y+44}" fill="{MUTED}" font-size="13" font-weight="500">{esc(note)}</text>')

y1 = 132
band(y1, "Analyst", "Browser", BROWSER_GLYPH)
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
              "not the analyst's screens."], "code", tag="AI access · secret key required"))
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
