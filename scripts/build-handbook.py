"""Design System Handbook — embeds the captured component pixel samples."""
import io
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Image, HRFlowable,
)
from reportlab.pdfgen import canvas as pdfcanvas

SHOTS = r"C:\Users\Admin\AppData\Local\Temp\opencode\storybook-shots"
VIEWS_DIR = r"C:\Users\Admin\Documents\taskmaster-pro\docs\samples\views"
OUT = r"C:\Users\Admin\Documents\TaskMaster_Pro_Design_System_Handbook.pdf"
DOCS = r"C:\Users\Admin\AppData\Local\Temp\opencode\tp"

BRAND = {"50": "#EEF0FB", "100": "#DDE0F7", "200": "#B9C0EF", "500": "#7B85DC",
         "600": "#5E6AD2", "700": "#4A56C0", "800": "#3A45A8", "900": "#2A3284"}
NEUTRAL = {"50": "#F8FAFC", "100": "#F1F5F9", "200": "#E2E8F0", "400": "#94A3B8",
           "500": "#64748B", "600": "#475569", "700": "#334155", "900": "#0F172A"}

styles = getSampleStyleSheet()
title_s = ParagraphStyle("T", parent=styles["Title"], fontName="Helvetica-Bold",
                         fontSize=26, leading=32, textColor=HexColor(NEUTRAL["900"]), spaceAfter=10)
sub_s = ParagraphStyle("Sub", parent=styles["Normal"], fontName="Helvetica",
                        fontSize=13, leading=20, textColor=HexColor(NEUTRAL["500"]), spaceAfter=6)
h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                     fontSize=17, leading=24, textColor=HexColor(NEUTRAL["900"]),
                     spaceBefore=16, spaceAfter=7)
h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                     fontSize=13, leading=19, textColor=HexColor(NEUTRAL["700"]),
                     spaceBefore=12, spaceAfter=5)
h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                     fontSize=11, leading=16, textColor=HexColor(BRAND["600"]),
                     spaceBefore=10, spaceAfter=4)
body = ParagraphStyle("B", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
                       leading=15, textColor=HexColor(NEUTRAL["600"]), spaceAfter=6)
small = ParagraphStyle("S", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5,
                       leading=13, textColor=HexColor(NEUTRAL["500"]), spaceAfter=4)
code = ParagraphStyle("C", parent=styles["Normal"], fontName="Courier", fontSize=8,
                      leading=12, textColor=HexColor(NEUTRAL["900"]),
                      backColor=HexColor(NEUTRAL["100"]), spaceBefore=4, spaceAfter=4,
                      leftIndent=6, rightIndent=6, borderPadding=5)
caption = ParagraphStyle("Cap", parent=styles["Normal"], fontName="Helvetica-Oblique",
                         fontSize=8, leading=12, textColor=HexColor(NEUTRAL["400"]),
                         spaceBefore=3, spaceAfter=10)

COMPONENTS = [
    {"file": "01-button.png", "name": "Button", "shot": "01-button.png",
     "path": "src/components/Button.jsx",
     "desc": "The only interactive primitive every view depends on. Four variants carry meaning: primary for the one action a view wants, secondary for alternatives, ghost for tertiary actions inside a row, danger for destructive ones.",
     "props": [("variant", "primary | secondary | ghost | danger", "Visual weight and meaning"),
               ("size", "sm | md | lg", "sm is 28px, md is 36px, lg is 44px"),
               ("disabled", "boolean", "Dims the button and blocks the click"),
               ("loading", "boolean", "Shows a spinner and blocks the click")],
     "usage": '<Button variant="primary" onClick={handleSave}>Save</Button>'},
    {"file": "02-input.png", "name": "Input", "shot": "02-input.png",
     "path": "src/components/Input.jsx",
     "desc": "Every field in the app. The label sits above the field in small caps, the required marker is a red asterisk, and errors appear under the field in red. Labels are always visible rather than used as placeholders, so the field stays identifiable once it has a value.",
     "props": [("type", "text | number | email | password | url | time | date", "Native input type"),
               ("label", "string", "Always shown above the field"),
               ("placeholder", "string", "Example value, not a replacement for the label"),
               ("required", "boolean", "Adds a red asterisk to the label"),
               ("error", "string", "Error text below the field, red border")],
     "usage": '<Input label="Task Title" required value={title} onChange={setTitle} />'},
    {"file": "03-card.png", "name": "Card", "shot": "03-card.png",
     "path": "src/components/Card.jsx",
     "desc": "The surface every other component sits on. White in light mode, near-black in dark mode, with a hairline border. The hover variant adds a shadow and strengthens the border — used for cards that lead somewhere.",
     "props": [("className", "string", "Extra Tailwind classes, usually padding"),
               ("hover", "boolean", "Shadow and border change on hover")],
     "usage": '<Card className="p-4" hover>Content</Card>'},
    {"file": "04-badge.png", "name": "Badge", "shot": "04-badge.png",
     "path": "src/components/Badge.jsx",
     "desc": "Small status indicators. Uppercase and letter-spaced at the small size so they read as labels rather than buttons. Six variants cover the states the app actually uses: open, urgent, closed, informational, neutral and brand.",
     "props": [("variant", "success | warning | danger | info | neutral | brand", "Semantic colour"),
               ("size", "sm | md", "sm is 10px, md is 12px")],
     "usage": '<Badge variant="success" size="sm">Open</Badge>'},
    {"file": "05-banner.png", "name": "Banner", "shot": "05-banner.png",
     "path": "src/components/Banner.jsx",
     "desc": "Failure and status messaging in four tones: error, info, success and warning. The retry action is the point of this component: the app never leaves a stale screen without saying so. By default the banner is pinned to the bottom of the viewport; inline puts it in the normal flow instead, which is what the library uses to show more than one tone at a time.",
     "props": [("variant", "error | success | info | warning", "Tone of the message"),
               ("title", "string", "Bold first line"),
               ("message", "string", "Detail line"),
               ("onDismiss", "function", "Shows the close button"),
               ("onRetry", "function", "Shows the retry button"),
               ("inline", "boolean", "Renders in the normal flow instead of pinned to the viewport")],
     "usage": '<Banner variant="error" title="Failed" message="..." onRetry={refetch} />'},
    {"file": "06-emptystate.png", "name": "EmptyState", "shot": "06-emptystate.png",
     "path": "src/components/EmptyState.jsx",
     "desc": "Shown when a view has nothing to display. The icon carries the meaning, the title says what is empty, and the action says what to do next. A blank screen is a bug; an empty state is a design decision.",
     "props": [("icon", "ReactNode", "Shown in a tinted circle above the title"),
               ("title", "string", "What is empty"),
               ("description", "string", "Why it is empty"),
               ("actionLabel", "string", "Label of the call to action"),
               ("onAction", "function", "Called when the action is pressed")],
     "usage": '<EmptyState icon={<Icon/>} title="No hackathons yet" actionLabel="Add" onAction={add} />'},
    {"file": "07-modal-open.png", "name": "Modal", "shot": "07-modal-open.png",
     "path": "src/components/Modal.jsx",
     "desc": "Overlay dialog for forms. Dismisses on backdrop click and on the close button. The content area scrolls independently of the header, so a long form never pushes the title off screen. The overlay covers the viewport, so this sample is a viewport shot rather than a crop of the component.",
     "props": [("isOpen", "boolean", "Controls visibility"),
               ("onClose", "function", "Called on backdrop click and the close button"),
               ("title", "string", "Shown in the header"),
               ("size", "sm | md | lg | xl", "Maximum width")],
     "usage": '<Modal isOpen={open} onClose={close} title="Create New Task">...</Modal>'},
    {"file": "08-email-list-row.png", "name": "Email list row", "shot": "08-email-list-row.png",
     "shot2": "09-email-list-row-with-selection.png", "shot2_name": "Email list row with selection",
     "path": "src/components/InboxPrimitives.jsx",
     "desc": "One email in the inbox list. The row is a div with role=button and tabIndex 0, and responds to Enter and Space, so the list is fully keyboard reachable. A brand dot marks unread, the platform badge names the source, and a green line shows which hackathon the email matched to. Passing onToggleCheck adds a bulk-selection checkbox; ticking it stops the click and the keypress from reaching the row, so a message can be queued without opening it.",
     "props": [("email", "object", "The inbox item"),
               ("isSelected", "boolean", "Opens the detail panel"),
               ("panelOpen", "boolean", "Tightens the padding when a panel is open"),
               ("isChecked", "boolean", "Whether the row is ticked for bulk actions"),
               ("onToggleCheck", "function", "Adds a checkbox; called with the email when it is ticked"),
               ("onSelect", "function", "Called on click, Enter or Space"),
               ("onToggleProcessed", "function", "Called by the tick button"),
               ("onDelete", "function", "Called by the delete button")],
     "usage": '<EmailListItem email={e} isSelected={sel} isChecked={sel2} onToggleCheck={pick2} onSelect={pick} onDelete={del} />'},
    {"file": "10-email-detail-panel.png", "name": "Email detail panel", "shot": "10-email-detail-panel.png",
     "path": "src/components/InboxPrimitives.jsx",
     "desc": "The open email. A circle shows the sender initial, the body renders as plain text rather than injected HTML, so there is no sanitiser to get wrong, and attachments are listed with their names along the bottom.",
     "props": [("email", "object", "The selected email"),
               ("onClose", "function", "Called by the close button")],
     "usage": '<EmailDetail email={selected} onClose={close} />'},
    {"file": "11-inbox-split-view.png", "name": "Inbox split view", "shot": "11-inbox-split-view.png",
     "path": "src/components/InboxPrimitives.jsx",
     "desc": "The list beside the detail panel. Below the md breakpoint the panel takes the full width and the list is hidden; from md up the list narrows to 380px beside the panel, so both are visible at once.",
     "props": [("children", "ReactNode", "The list"),
               ("selected", "object", "The open email, or null"),
               ("onClose", "function", "Called when the panel is dismissed")],
     "usage": '<InboxSplitView selected={sel} onClose={close}>{list}</InboxSplitView>'},
    {"file": "12-inbox-skeleton.png", "name": "Inbox skeleton", "shot": "12-inbox-skeleton.png",
     "path": "src/components/InboxPrimitives.jsx",
     "desc": "Placeholder rows shown while the inbox loads. The shape matches the real row, so the layout does not jump when the data arrives.",
     "props": [("count", "number", "How many placeholder rows")],
     "usage": '<EmailListSkeleton count={8} />'},
]



# ── Table helpers ───────────────────────────────────────────────────
# ReportLab does not wrap plain strings inside table cells: they render on a
# single line and overflow into the neighbouring column. Every cell is
# therefore converted to a Paragraph, which does wrap.

CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, leading=11.5,
                      textColor=HexColor(NEUTRAL["600"]))
CELL_HEAD = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=8.5,
                           leading=11.5, textColor=white)
CELL_MONO = ParagraphStyle("cellmono", fontName="Courier", fontSize=7.5,
                            leading=10.5, textColor=HexColor(NEUTRAL["600"]))
CELL_MUTED = ParagraphStyle("cellmuted", fontName="Helvetica", fontSize=8.5,
                             leading=11.5, textColor=HexColor(NEUTRAL["500"]))
CELL_CODE = ParagraphStyle("cellcode", fontName="Courier", fontSize=7.5,
                            leading=10.5, textColor=HexColor(NEUTRAL["600"]))


def _cells(row, style):
    """Convert one table row's strings into Paragraphs."""
    return [c if isinstance(c, Paragraph) else Paragraph(str(c), style) for c in row]


# The screens, captured from the running app rather than the component
# library. A view is a composition, so a component sample cannot stand in
# for it.
VIEWS = [
    {"file": "today.png", "name": "Today",
     "desc": "The answer to 'what should I do today'. A one-line summary of the hours "
             "you have against the work due this week, the competitions worth your "
             "time, the deadlines that collide, and the week's capacity as a grid. "
             "Everything else in the app is reachable from here.",
     "shows": "Summary, focus today, conflicts, upcoming this week, weekly capacity"},
    {"file": "hackathons.png", "name": "Hackathons",
     "desc": "Every competition being tracked. The deadline counts down, the prize is "
             "shown, and the eligibility verdict sits on the card - so a competition "
             "you cannot enter is visible as such rather than as a prize you will "
             "never win. Each card can take a screenshot and can be selected in bulk.",
     "shows": "Deadline, prize, eligibility verdict, per-card actions, bulk selection"},
    {"file": "inbox.png", "name": "Inbox",
     "desc": "The mail that arrives from the competitions, matched to the competition "
             "it belongs to. A row is a button with keyboard support, so the list is "
             "reachable without a mouse, and a message can be queued for later with "
             "the selection checkbox without opening it.",
     "shows": "Split view, per-row actions, bulk selection, linked competition"},
    {"file": "settings.png", "name": "Settings",
     "desc": "Profile, notifications, mail configuration and the storage backend, in "
             "four tabs. The profile here is the same one the eligibility engine "
             "reads, so changing your citizenship changes the verdicts.",
     "shows": "Storage, profile, notifications and email tabs"},
]


def mk_table(rows, widths, head_bg=BRAND["600"], mono_cols=(), muted_cols=()):
    """A table whose cells wrap. mono_cols are set in a monospace face."""
    body = [_cells(rows[0], CELL_HEAD)]
    for row in rows[1:]:
        cells = []
        for i, c in enumerate(row):
            if isinstance(c, Paragraph):
                cells.append(c)
            elif i in mono_cols:
                cells.append(Paragraph(str(c), CELL_MONO))
            elif i in muted_cols:
                cells.append(Paragraph(str(c), CELL_MUTED))
            else:
                cells.append(Paragraph(str(c), CELL))
        body.append(cells)
    t = Table(body, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(head_bg)),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor(NEUTRAL["200"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor(NEUTRAL["50"]), white]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t



def page_furniture(canv, doc):
    """Header, footer and page numbers on every page."""
    canv.saveState()
    # Header rule
    canv.setFillColor(HexColor(BRAND["600"]))
    canv.rect(0, A4[1] - 12*mm, A4[0], 12*mm, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.setFont("Helvetica-Bold", 8.5)
    canv.drawString(20*mm, A4[1] - 8*mm, "TaskMaster Pro — Design System Handbook")
    canv.setFont("Helvetica", 8.5)
    canv.drawRightString(A4[0] - 20*mm, A4[1] - 8*mm, "AndieKobbieTech")
    # Footer
    canv.setFillColor(HexColor(NEUTRAL["400"]))
    canv.setFont("Helvetica", 8)
    canv.drawString(20*mm, 12*mm, "Open core — source available, no forking, no redistribution")
    canv.drawRightString(A4[0] - 20*mm, 12*mm, "Page %d" % doc.page)
    canv.restoreState()


def main():
    doc = SimpleDocTemplate(
        OUT, pagesize=A4,
        topMargin=22*mm, bottomMargin=20*mm,
        leftMargin=20*mm, rightMargin=20*mm,
        title="TaskMaster Pro — Design System Handbook",
        author="AndieKobbieTech",
    )
    story = []

    # ── Cover ──────────────────────────────────────────────────────
    story.append(Spacer(1, 45*mm))
    story.append(Paragraph("TaskMaster Pro", title_s))
    story.append(Paragraph("Design System Handbook", sub_s))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        "Version 1.0 &nbsp;·&nbsp; October 2026", body))
    story.append(Paragraph("Prepared for: Product Manager and team", body))
    story.append(Paragraph("Prepared by: AndieKobbieTech", body))
    story.append(Spacer(1, 12*mm))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor(BRAND["200"])))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        "Every component in this handbook is a real pixel sample of the shipped code, "
        "captured at two times resolution. Nothing here is a mock-up: the images are "
        "rendered from <b>src/components</b> and <b>src/lib</b>, so a change to a "
        "component changes this document.", body))
    story.append(PageBreak())

    # ── Contents ───────────────────────────────────────────────────
    story.append(Paragraph("Contents", h1))
    rows = [["Section", "What it covers"]]
    rows.append(["1. Design tokens", "The colour, type, spacing and motion values every component draws from"])
    rows.append(["2. Component library", "Pixel samples, prop tables and usage for all eleven components and twelve sampled states"])
    rows.append(["3. The views", "The four screens, captured from the running app"])
    rows.append(["4. Product requirements", "What the product is, who it is for, and what each module does"])
    rows.append(["5. API reference", "Every endpoint, grouped by module"])
    rows.append(["6. Architecture", "How the pieces fit together, and where the risks are"])
    story.append(mk_table(rows, [100, 330]))
    story.append(PageBreak())

    # ── 1. Design tokens ───────────────────────────────────────────
    story.append(Paragraph("1. Design tokens", h1))
    story.append(Paragraph(
        "Tokens are the single source of truth for visual decisions. They live in "
        "<b>tailwind.config.cjs</b> (the Tailwind theme), <b>src/tailwind.css</b> (CSS "
        "custom properties) and <b>docs/design-tokens.json</b> (machine-readable, for "
        "tooling and this document). Changing a token changes every component that "
        "uses it.", body))

    story.append(Paragraph("1.1 Brand palette", h2))
    rows = [["Token", "Hex", "Use"]]
    uses = {"50": "Hover backgrounds, subtle fills", "100": "Light fills",
            "200": "Borders, dividers", "500": "Secondary text, icons",
            "600": "Primary — buttons, links, active states",
            "700": "Hover on primary", "800": "Pressed states",
            "900": "Headings on light backgrounds"}
    for k in ["50", "100", "200", "500", "600", "700", "800", "900"]:
        rows.append([f"brand-{k}", BRAND[k], uses[k]])
    story.append(mk_table(rows, [70, 80, 280], muted_cols=(1,)))
    story.append(Spacer(1, 6*mm))

    # Swatch strip
    d = Drawing(430, 34)
    x = 0
    for k in ["50", "100", "200", "500", "600", "700", "800", "900"]:
        d.add(Rect(x, 14, 53, 20, fillColor=HexColor(BRAND[k]),
                    strokeColor=HexColor(NEUTRAL["200"]), strokeWidth=0.4))
        d.add(String(x + 3, 4, k, fontName="Helvetica", fontSize=6.5,
                     fillColor=HexColor(NEUTRAL["500"])))
        x += 53
    story.append(d)
    story.append(Paragraph("Brand ramp, 50 through 900.", caption))

    story.append(Paragraph("1.2 Neutral palette", h2))
    rows = [["Token", "Hex", "Use"]]
    nuses = {"50": "Page background (light)", "100": "Card background (light)",
             "200": "Borders, dividers", "300": "Disabled borders",
             "400": "Placeholder text, subtle labels", "500": "Secondary text",
             "600": "Body text (light)", "700": "Headings (light)",
             "800": "Card background (dark)", "900": "Page background (dark)",
             "950": "Deepest background (dark)"}
    for k in ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]:
        rows.append([f"neutral-{k}", NEUTRAL.get(k, "#0F172A" if k == "900" else "#020617"), nuses[k]])
    story.append(mk_table(rows, [80, 80, 270], head_bg=NEUTRAL["700"], muted_cols=(1,)))
    story.append(PageBreak())

    story.append(Paragraph("1.3 Semantic and priority colours", h2))
    rows = [["Token", "Hex", "Meaning"]]
    sem = {"success": ("#16A34A", "Completed, eligible, passed"),
           "warning": ("#F59E0B", "Urgent, needs attention"),
           "danger": ("#DC2626", "Errors, destructive actions"),
           "info": ("#2563EB", "Neutral information")}
    for k, (hx, m) in sem.items():
        rows.append([k, hx, m])
    for k, (hx, m) in {"low": ("#16A34A", "Low priority"), "medium": ("#2563EB", "Medium priority"),
                        "high": ("#F59E0B", "High priority"), "urgent": ("#DC2626", "Urgent priority")}.items():
        rows.append([f"priority-{k}", hx, m])
    story.append(mk_table(rows, [90, 80, 260], head_bg=NEUTRAL["700"], muted_cols=(1,)))
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("1.4 Typography", h2))
    rows = [["Token", "Size", "Use"]]
    for tok, size, use in [("xs", "0.75rem / 12px", "Badges, captions, metadata"),
                           ("sm", "0.875rem / 14px", "Body text, labels, table cells"),
                           ("base", "1rem / 16px", "Default"),
                           ("lg", "1.125rem / 18px", "Section headings"),
                           ("xl", "1.25rem / 20px", "Page titles"),
                           ("2xl", "1.5rem / 24px", "Hero headings")]:
        rows.append([tok, size, use])
    story.append(mk_table(rows, [60, 110, 260]))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        "Two families: <b>Inter</b> for interface text, <b>JetBrains Mono</b> for code, "
        "timestamps, counts and match-confidence readouts.", body))
    story.append(PageBreak())

    story.append(Paragraph("1.5 Spacing, radius, shadow and motion", h2))
    rows = [["Group", "Values"]]
    rows.append(["Spacing", "0.25rem steps — 1 (4px), 2 (8px), 3 (12px), 4 (16px), 6 (24px), 8 (32px)"])
    rows.append(["Radius", "sm 4px, md 6px, lg 8px, xl 12px, full for pills and avatars"])
    rows.append(["Shadow", "xs 2px, sm 3px, md 6px, lg 15px — reserved for raised surfaces"])
    rows.append(["Motion", "fadeIn 200ms cubic-bezier(0.16, 1, 0.3, 1) for overlays; scaleIn 250ms cubic-bezier(0.34, 1.56, 0.64, 1) for cards and dialogs"])
    story.append(mk_table(rows, [80, 350], head_bg=NEUTRAL["700"]))
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("1.6 Dark mode", h2))
    story.append(Paragraph(
        "Dark mode is toggled by adding the <b>dark</b> class to the document element. "
        "Every component ships both modes — there is no separate dark stylesheet. "
        "Surfaces invert: the page goes from neutral-50 to neutral-950, cards from "
        "white to neutral-800, and body text from neutral-600 to neutral-400 so it "
        "keeps its contrast on the darker surface.", body))
    story.append(PageBreak())

    # ── 2. Component library ────────────────────────────────────────
    story.append(Paragraph("2. Component library", h1))
    story.append(Paragraph(
        "Each component below is shown as a real pixel sample, captured at two times "
        "resolution from the shipped code. The source path is given so the sample "
        "and the implementation can be read side by side.", body))

    for c in COMPONENTS:
        block = [Paragraph(c["name"], h2), Paragraph(c["desc"], body)]
        shots = [(c["shot"], c["name"])]
        if c.get("shot2"):
            shots.append((c["shot2"], c.get("shot2_name", c["name"])))
        for shot_file, shot_label in shots:
            shot_path = os.path.join(SHOTS, shot_file)
            if not os.path.exists(shot_path):
                continue
            img = Image(shot_path)
            ratio = img.imageHeight / img.imageWidth
            max_w = 430
            img.drawWidth = max_w
            img.drawHeight = max_w * ratio
            if img.drawHeight > 250:
                scale = 250 / img.drawHeight
                img.drawWidth *= scale
                img.drawHeight *= scale
            img.hAlign = "LEFT"
            block.append(Spacer(1, 4))
            block.append(img)
            block.append(Paragraph(
                f"Sample: {shot_label} &nbsp;·&nbsp; {c['path']}", caption))
        story.append(KeepTogether(block))

        # Props table
        rows = [["Prop", "Type", "Meaning"]]
        for p in c["props"]:
            rows.append(list(p))
        story.append(mk_table(rows, [95, 175, 160], mono_cols=(0,)))
        story.append(Spacer(1, 3*mm))
        story.append(Paragraph(c["usage"], code))
        story.append(Spacer(1, 8*mm))

    # ── 3. PRD ─────────────────────────────────────────────────────
    # ── 3. The views ─────────────────────────────────────────────────
    story.append(Paragraph("3. The views", h1))
    story.append(Paragraph(
        "The screens, in the order a person meets them. These are real pixels of the "
        "running application, captured at two times resolution by "
        "<b>scripts/capture-views.py</b> &mdash; not mock-ups, and not the components "
        "assembled by hand. A view is a composition, so a component sample cannot "
        "stand in for one.", body))
    story.append(Spacer(1, 3*mm))

    for v in VIEWS:
        shot_path = os.path.join(VIEWS_DIR, v["file"])
        block = [Paragraph("3.%d %s" % (VIEWS.index(v) + 1, v["name"]), h2),
                 Paragraph(v["desc"], body)]
        if os.path.exists(shot_path):
            img = Image(shot_path)
            ratio = img.imageHeight / img.imageWidth
            max_w = 430
            img.drawWidth = max_w
            img.drawHeight = max_w * ratio
            if img.drawHeight > 300:
                scale = 300 / img.drawHeight
                img.drawWidth *= scale
                img.drawHeight *= scale
            img.hAlign = "LEFT"
            block.append(Spacer(1, 4))
            block.append(img)
            block.append(Paragraph(
                "Sample: %s &nbsp;·&nbsp; shows: %s" % (v["name"], v["shows"]), caption))
        else:
            block.append(Paragraph(
                "<i>Sample not captured. Run scripts/capture-views.py.</i>", caption))
        story.append(KeepTogether(block))

    story.append(PageBreak())

    # ── 4. Product requirements ───────────────────────────────────────
    story.append(Paragraph("4. Product requirements (PRD)", h1))
    story.append(Paragraph("4.1 What the product is", h2))
    story.append(Paragraph(
        "TaskMaster Pro is a self-hosted productivity and hackathon tracking platform. "
        "It runs entirely on Cloudflare Workers with a Durable Object holding the "
        "database, so there is no server to administer and no vendor relationship to "
        "manage. The data belongs to the person running it.", body))
    story.append(Paragraph(
        "The product exists because a developer competing in many hackathons per week "
        "faces a specific problem: the information needed to enter and win a competition "
        "is scattered across a dozen platforms, and the time to act on it is measured in "
        "hours a week, not hours a day.", body))

    story.append(Paragraph("4.2 Who it is for", h2))
    story.append(Paragraph(
        "A developer or technical professional who competes in several hackathons a "
        "month while holding a full-time job and other responsibilities. They need to "
        "know which competitions they are actually eligible for, when each one closes, "
        "and what to do next given the hours they genuinely have.", body))

    story.append(Paragraph("4.3 The modules", h2))
    modules = [
        ("Todo management", "Tasks with priorities, tags, lists, due dates, pinning, search and a pomodoro counter.", "A working todo app, because the rest of the product is useless without a place to put the outcome."),
        ("Hackathon tracker", "Competitions with deadlines, prizes, platform and status, each with a rule set.", "The core entity. Everything else supports it."),
        ("Eligibility engine", "Rules are stored as data per competition, not as code, so a new competition needs no deployment.", "Answers the question that actually stops people entering: can I enter this at all?"),
        ("Attachment system", "Screenshots uploaded against any ticket, previewed inline.", "A competition page changes. The screenshot is the record of what it said."),
        ("Email inbox", "Emails filed from Cloudflare Email Routing, matched to a competition by content.", "Turns an inbox into a deadline feed without a forwarding habit to maintain."),
        ("Archive integration", "Wayback Machine adapter extracts deadlines, prizes and rules from archived pages.", "Reads competition pages without scraping live sites."),
        ("Capacity planner", "A weekly template of available hours.", "Turns a list of deadlines into a plan that fits the hours actually available."),
        ("Daily digest", "Today's tasks, conflicts, the week ahead, and the capacity left.", "One screen that answers 'what should I do today'."),
        ("Settings", "Profile, notifications, mail configuration, and a storage-backend credential test.", "One place for the settings that change how the app behaves. The mail settings drive the hourly poll; the storage provider is tested, not yet used — attachments still go to SQLite."),
    ]
    rows = [["Module", "What it does", "Why it is there"]]
    for m in modules:
        rows.append(list(m))
    story.append(mk_table(rows, [95, 165, 170]))

    story.append(Paragraph("4.4 The eligibility engine", h2))
    story.append(Paragraph(
        "Eligibility is the feature that distinguishes this from a calendar. Rules are "
        "stored as JSON on each competition, so adding a competition with new rules "
        "never needs a code change or a deployment.", body))
    story.append(Paragraph("A rule can express:", h3))
    for r in ["Which countries count — by citizenship, by residence, or by region group (EU, EEA, Schengen, UK, US)",
               "An age range",
               "Whether students only",
               "A minimum and maximum team size",
               "An exclusion for sponsor employees and their families"]:
        story.append(Paragraph(f"• {r}", body))
    story.append(Paragraph("The engine reports the route that qualified you", h3))
    story.append(Paragraph(
        "Not just eligible or not — the path. \"eligible via EU citizenship (IT)\" is a "
        "different answer from \"eligible via UK residency (GB, settled)\", and a "
        "developer with both needs to know which one is carrying the entry. When a rule "
        "blocks an entry, the specific blocking reason is shown instead of a generic "
        "failure.", body))
    story.append(Paragraph(
        '<Badge variant="success">eligible via EU citizenship (IT)</Badge>\n'
        '<Badge variant="success">eligible via UK residency (GB, settled)</Badge>\n'
        '<Badge variant="danger">Students only</Badge>', code))

    story.append(Paragraph("4.5 Data protection", h2))
    story.append(Paragraph(
        "The inbox stores extracted metadata, not raw email. Email bodies are rendered "
        "as plain text and never injected into the page, so there is no HTML sanitiser "
        "to configure and no stored payload to attack. Personal details in the seed "
        "fixtures are anonymised, following the convention used in social research: "
        "the citizenship and residency codes are placeholders, and the real values are "
        "supplied through the API by the person using the instance.", body))
    story.append(PageBreak())

    # ── 4. API reference ────────────────────────────────────────────
    story.append(Paragraph("5. API reference", h1))
    story.append(Paragraph(
        "Every route is served by the Durable Object and answers JSON. Literal paths "
        "are registered ahead of their parameter siblings, so a route such as "
        "<b>/api/hackathons/eligibility</b> is reachable even though "
        "<b>/api/hackathons/:id</b> also exists.", body))
    api_rows = [["Module", "Method and path", "Purpose"]]
    api_rows += [
        ["Todos", "GET /api/todos", "List, filter by status, priority, list or search"],
        ["", "POST /api/todos", "Create"],
        ["", "PATCH /api/todos/:id", "Update, including completion and pomodoro count"],
        ["", "DELETE /api/todos/:id", "Delete"],
        ["Lists", "GET, POST, DELETE /api/lists", "Named lists with a colour and icon"],
        ["Stats", "GET /api/stats", "Totals for the dashboard widget"],
        ["Hackathons", "GET /api/hackathons", "List, ordered by nearest deadline"],
        ["", "POST /api/hackathons", "Create"],
        ["", "GET /api/hackathons/:id", "Fetch one"],
        ["", "PATCH /api/hackathons/:id", "Update, with field type validation"],
        ["", "DELETE /api/hackathons/:id", "Delete"],
        ["", "GET /api/hackathons/eligibility", "Evaluate the profile against every open competition"],
        ["", "GET, PUT /api/hackathons/profile", "Read and write the eligibility profile"],
        ["Attachments", "POST /api/tickets/:id/attachments", "Upload a screenshot against any ticket"],
        ["", "GET /api/tickets/:id/attachments", "List a ticket's attachments"],
        ["", "GET /api/attachments/:id", "Download or preview an attachment"],
        ["", "DELETE /api/attachments/:id", "Delete an attachment"],
        ["Inbox", "POST /api/inbox", "Receive a parsed email and link it by content"],
        ["", "POST /api/inbox/fetch", "Pull new mail from the configured server"],
        ["", "GET /api/inbox", "List, filter by unread or platform"],
        ["", "GET /api/inbox/stats", "Counts by read, processed and platform"],
        ["", "PATCH /api/inbox/:id", "Mark read, processed, or relink"],
        ["", "DELETE /api/inbox/:id", "Delete"],
        ["Archive", "GET, POST, DELETE /api/archive/sources", "Manage archive sources"],
        ["", "POST /api/archive/fetch", "Fetch an archived page and extract its metadata"],
        ["", "GET /api/archive/check", "Check whether a URL has a snapshot"],
        ["Capacity", "GET, PUT /api/capacity", "Read and write the weekly hours template"],
        ["", "GET /api/digest", "Today's prioritised digest"],
        ["", "GET /api/digest/weekly", "The week ahead with hours"],
        ["Settings", "GET, PUT, PATCH /api/settings", "Read and write settings by section"],
        ["", "POST /api/settings/test-storage", "Test a storage connection"],
        ["", "POST /api/settings/reset", "Restore defaults"],
        ["Health", "GET /health", "Liveness check"],
    ]
    story.append(mk_table(api_rows, [70, 175, 185]))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph("Cross-cutting behaviour", h2))
    for b in ["Security headers on every response — nosniff, DENY framing, strict referrer policy, and a content security policy that allows only same-origin scripts",
              "Rate limiting at 100 requests per minute per IP, tracked in the Durable Object",
              "A React error boundary around the whole app, so one failing component cannot blank the screen",
              "Parameterised SQL throughout, with writes consuming their cursor so a read-back cannot miss a row that was written"]:
        story.append(Paragraph(f"• {b}", body))
    story.append(PageBreak())

    # ── 5. Architecture ─────────────────────────────────────────────
    story.append(Paragraph("6. Architecture", h1))
    story.append(Paragraph("6.1 Shape", h2))
    story.append(Paragraph(
        "A single Cloudflare Worker serves the compiled single-page app and exposes "
        "the API. All state lives in one Durable Object with an embedded SQLite "
        "database, so there is no separate database to run, secure or pay for. Screenshots "
        "sit in the same database as BLOB data. There is no R2 binding yet, so moving "
        "them out is work rather than a setting.", body))

    story.append(Paragraph("6.2 Layout", h2))
    layout = [["Path", "Role"]]
    layout += [
        ["src/index.ts", "Worker entry. Durable Object, Hono router, security middleware, schema"],
        ["src/hackathons.ts", "Hackathon CRUD, the eligibility engine, the user profile"],
        ["src/attachments.ts", "Upload, list, download and delete for attachments"],
        ["src/inbox.ts", "Email ingestion and content-based matching to a ticket"],
        ["src/archive.ts", "Wayback Machine adapter and metadata extraction"],
        ["src/capacity.ts", "Weekly hours template, prioritisation, conflict detection"],
        ["src/settings.ts", "Configurable settings, with sensitive values obfuscated at rest"],
        ["src/profile.ts", "The eligibility profile: one type, one default, read by both the engine and the Settings screen"],
        ["src/jmap.ts", "JMAP client for JMAP-compatible mail servers"],
        ["src/mail.ts", "Mail ingestion: reads the configured server and hands the messages to the inbox"],
        ["src/app.jsx", "The whole front end — one file, compiled by esbuild"],
        ["src/components/", "Reusable interface components"],
        ["src/lib/", "Shared helpers: the API client, and email formatting"],
        ["scripts/", "Email search, screenshot pipeline, sync, and the API test suite"],
        ["docs/", "Generated inventories, SBOM, readiness gates and this handbook's source"],
    ]
    story.append(mk_table(layout, [140, 290]))

    story.append(Paragraph("6.3 Known risks", h2))
    story.append(Paragraph(
        "Stated plainly, because a design document that only lists strengths is a "
        "marketing document.", body))
    risks = [["Risk", "Where", "Mitigation"]]
    risks += [
        ["No authentication — anyone with the URL has full read and write", "All routes", "Must not be deployed publicly without it. A token scheme is the first item of work before any paid offering."],
        ["Attachments stored as BLOBs in SQLite, with no object-storage path behind them", "src/attachments.ts", "Known gap. The provider setting only runs a credential test: there is no R2 binding in wrangler.json and nothing uploads. Moving attachments to R2 is a code change, not a setting change."],
        ["BLOBs share the Durable Object's 10GB ceiling with everything else", "src/index.ts", "Same fix. The storage path has to be written before it can be moved."],
        ["The daily digest is computed when the Today view opens — nothing sends it", "src/capacity.ts", "Known gap. There is now an hourly cron, but it polls mail rather than sending a digest. The daily_digest and digest_time settings still have no consumer."],
        ["The digest ranks competitions but not your own tasks", "src/capacity.ts", "The digest never reads the todos table, so it cannot tell what is already committed. Its today_tasks field holds competitions, not tasks, which the heading in the Today view gets wrong."],
        ["Email body rendered as plain text, so rich email loses its formatting", "src/components/InboxPrimitives.jsx", "Deliberate. Injecting HTML would need a sanitiser; plain text has nothing to sanitise."],
        ["The seed fixtures contain example personal data", "seed/hackathons.json", "Anonymised to placeholder country codes. The real profile is supplied through the API."],
        ["Only JMAP is supported, so the IMAP settings do nothing", "src/settings.ts, src/mail.ts", "Known gap. Mail is fetched over JMAP (RFC 8620) by an hourly cron, or by the Fetch mail now button. There is no IMAP client, so a Yahoo or Gmail user has to use a JMAP provider or keep forwarding mail to POST /api/inbox."],
    ]
    story.append(mk_table(risks, [150, 110, 170]))

    story.append(Paragraph("6.4 What comes next", h2))
    for n in ["Authentication and a per-user data model, before any public deployment",
              "An ingestion route that connects to the configured mail server, so the inbox fills itself",
              "Attachments to R2 with signed URLs, removing the size ceiling",
              "A composed reply path, so the inbox can be worked rather than only read",
              "Calendar synchronisation, so deadlines reach the calendar you already use",
              "A written ADR for the storage decision, in the style of the existing ones"]:
        story.append(Paragraph(f"• {n}", body))
    story.append(Spacer(1, 10*mm))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor(BRAND["200"])))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        "This handbook is generated from the repository. The samples are real pixels of "
        "the shipped components, and the inventories it cites are the same ones CI "
        "checks for drift. If the code changes, the handbook changes with it.", small))


    doc.build(story, onFirstPage=page_furniture, onLaterPages=page_furniture)
    print("Handbook built:", OUT)
    print("Size:", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
