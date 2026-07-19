"""
PDF expense receipt generator using ReportLab.

Generates a proper A4 PDF receipt from a parsed document dict.
Uses the same data structure as digital_receipt_generator.py.
"""
import io
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER


# ── Colour palette ────────────────────────────────────────────────────────────

TEAL       = HexColor("#14B8A6")
TEAL_DARK  = HexColor("#0D9488")
AMBER      = HexColor("#F59E0B")
AMBER_LIGHT= HexColor("#FEF3C7")
SLATE_50   = HexColor("#F8FAFC")
SLATE_100  = HexColor("#F1F5F9")
SLATE_200  = HexColor("#E2E8F0")
SLATE_500  = HexColor("#64748B")
SLATE_700  = HexColor("#334155")
SLATE_900  = HexColor("#0F172A")


# ── Page constants ─────────────────────────────────────────────────────────────

PAGE_W, PAGE_H = A4                          # 595.28 × 841.89 pt
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN              # ~170 mm


# ── Money formatting ───────────────────────────────────────────────────────────

CURRENCY_SYMBOLS = {
    "INR": "₹",   # ₹
    "USD": "$",
    "EUR": "€",   # €
    "GBP": "£",   # £
    "AED": "AED ",
}


def format_money(value: Any, currency: str = "INR") -> str:
    """Format a numeric value as a locale-aware currency string."""
    if value is None or value == "":
        return "—"
    try:
        amount = float(str(value).replace(",", ""))
    except (ValueError, TypeError):
        return str(value)
    sym = CURRENCY_SYMBOLS.get(currency.upper(), "")
    return f"{sym}{amount:,.2f}"


# ── Style helpers ──────────────────────────────────────────────────────────────

def _make_styles():
    base = getSampleStyleSheet()

    def style(name: str, **kw) -> ParagraphStyle:
        return ParagraphStyle(name, **kw)

    return {
        "vendor_name": style("VendorName",
            fontName="Helvetica-Bold", fontSize=14,
            textColor=SLATE_900, spaceAfter=2),
        "vendor_meta": style("VendorMeta",
            fontName="Helvetica", fontSize=9,
            textColor=SLATE_500, spaceAfter=1),
        "section_hdr": style("SectionHdr",
            fontName="Helvetica-Bold", fontSize=8,
            textColor=SLATE_500, spaceAfter=2, spaceBefore=6),
        "field_label": style("FieldLabel",
            fontName="Helvetica", fontSize=9,
            textColor=SLATE_500, leading=13),
        "field_value": style("FieldValue",
            fontName="Helvetica", fontSize=9,
            textColor=SLATE_900, leading=13),
        "item_name": style("ItemName",
            fontName="Helvetica", fontSize=8.5,
            textColor=SLATE_900, leading=12),
        "item_name_bold": style("ItemNameBold",
            fontName="Helvetica-Bold", fontSize=8.5,
            textColor=SLATE_900, leading=12),
        "item_num": style("ItemNum",
            fontName="Helvetica", fontSize=8.5,
            textColor=SLATE_500, alignment=TA_CENTER),
        "money": style("Money",
            fontName="Helvetica", fontSize=8.5,
            textColor=SLATE_900, alignment=TA_RIGHT, leading=12),
        "money_bold": style("MoneyBold",
            fontName="Helvetica-Bold", fontSize=8.5,
            textColor=SLATE_900, alignment=TA_RIGHT, leading=12),
        "grand_total_label": style("GrandTotalLabel",
            fontName="Helvetica-Bold", fontSize=10,
            textColor=white, alignment=TA_RIGHT, leading=14),
        "grand_total_val": style("GrandTotalVal",
            fontName="Helvetica-Bold", fontSize=10,
            textColor=white, alignment=TA_RIGHT, leading=14),
        "warning": style("Warning",
            fontName="Helvetica", fontSize=8.5,
            textColor=HexColor("#92400E"), leading=12),
        "footer": style("Footer",
            fontName="Helvetica", fontSize=7.5,
            textColor=SLATE_500, alignment=TA_CENTER),
        "banner": style("Banner",
            fontName="Helvetica-Bold", fontSize=10,
            textColor=black, alignment=TA_CENTER, leading=14),
        "totals_label": style("TotalsLabel",
            fontName="Helvetica", fontSize=9,
            textColor=SLATE_700, alignment=TA_RIGHT, leading=13),
        "totals_value": style("TotalsValue",
            fontName="Helvetica", fontSize=9,
            textColor=SLATE_900, alignment=TA_RIGHT, leading=13),
    }


STYLES = _make_styles()


# ── Header canvas callback ──────────────────────────────────────────────────────

def _draw_header(canvas, doc):
    """Draw the teal header band and document type before each page."""
    canvas.saveState()

    # Teal header bar
    canvas.setFillColor(TEAL)
    canvas.rect(0, PAGE_H - 28 * mm, PAGE_W, 28 * mm, fill=1, stroke=0)

    # "DIGITAL EXPENSE COPY" text
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 14)
    canvas.drawString(MARGIN, PAGE_H - 18 * mm, "DIGITAL EXPENSE COPY")

    # Document ID right-aligned (if we have it stored in doc category)
    doc_id = getattr(doc, "_doc_id", None)
    if doc_id:
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 12 * mm, f"#{doc_id}")

    # Subtitle
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor("#99F6E4"))
    canvas.drawString(MARGIN, PAGE_H - 24 * mm, "Reconstructed from a scanned receipt  |  OCR V1.00")

    canvas.restoreState()


# ── Core generator ────────────────────────────────────────────────────────────

def generate_receipt_pdf(
    parsed: Dict[str, Any],
    output_path: Optional[str] = None,
) -> bytes:
    """
    Render a parsed bill as a PDF byte string.

    Parameters
    ----------
    parsed : dict
        Full extraction result dict (same shape as returned by parse_bill).
        Supports both flat schema (item.item_name, item.rate, etc.)
        and new nested schema (item.name, item.unit_price, etc.).
    output_path : str, optional
        If provided, the PDF is saved to this path as well as returned.

    Returns
    -------
    bytes
        PDF-encoded document data.
    """

    # Determine doc_id for header
    doc_id = parsed.get("document_id") or parsed.get("id")

    # Currency
    currency = parsed.get("currency") or parsed.get("document", {}).get("currency") or "INR"

    # Verification status
    verification = parsed.get("verification", {})
    verification_status = verification.get("status", "unreviewed")

    # Build buffer
    buf = io.BytesIO()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=18 * mm,
        title="Digital Expense Receipt",
        author="OCR V1.00 API",
        creator="OCR V1.00 PDF Receipt Generator",
    )
    doc._doc_id = doc_id   # pass doc_id to header callback

    story: List[Any] = []

    # ── Unverified banner ─────────────────────────────────────────────────────
    if verification_status == "unreviewed":
        banner_table = Table(
            [[Paragraph(
                "⚠ UNVERIFIED OCR RESULT — User Review Required",
                STYLES["banner"],
            )]],
            colWidths=[CONTENT_W],
        )
        banner_table.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, -1), AMBER_LIGHT),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",(0, 0), (-1, -1), 8),
            ("TOPPADDING",  (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING",(0,0),(-1, -1), 6),
            ("BOX",         (0, 0), (-1, -1), 0.5, AMBER),
        ]))
        story.append(banner_table)
        story.append(Spacer(1, 4 * mm))

    # ── Document info section ─────────────────────────────────────────────────
    story.append(_build_info_section(parsed))
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=SLATE_200))
    story.append(Spacer(1, 3 * mm))

    # ── Vendor section ────────────────────────────────────────────────────────
    story.append(_build_vendor_section(parsed))
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=SLATE_200))
    story.append(Spacer(1, 3 * mm))

    # ── Payment & category ───────────────────────────────────────────────────
    story.append(_build_payment_section(parsed))
    story.append(Spacer(1, 4 * mm))

    # ── Line items table ─────────────────────────────────────────────────────
    story.append(_build_line_items_table(parsed, currency))
    story.append(Spacer(1, 4 * mm))

    # ── Totals section ───────────────────────────────────────────────────────
    story.append(_build_totals_section(parsed, currency))
    story.append(Spacer(1, 4 * mm))

    # ── Warnings section ─────────────────────────────────────────────────────
    warnings = verification.get("warnings") or []
    if warnings:
        story.append(_build_warnings_section(warnings))
        story.append(Spacer(1, 4 * mm))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(_build_footer(parsed))

    doc.build(story, onFirstPage=_draw_header, onLaterPages=_draw_header)

    pdf_data = buf.getvalue()
    if output_path:
        with open(output_path, "wb") as f:
            f.write(pdf_data)
    return pdf_data


# ── Section builders ───────────────────────────────────────────────────────────

def _build_info_section(parsed: Dict[str, Any]) -> Table:
    """Document type, invoice number, date, time."""
    doc_info = parsed.get("document", {})   # nested schema
    flat = parsed                           # flat schema fallback

    doc_type   = doc_info.get("type") or flat.get("document_type") or "Document"
    invoice_no = doc_info.get("invoice_number") or flat.get("invoice_number")
    date_val   = doc_info.get("date") or flat.get("date")
    time_val   = doc_info.get("time")
    conf       = flat.get("confidence") or flat.get("ocr_metadata", {}).get("overall_confidence")
    conf_pct   = f"{conf * 100:.0f}%" if conf else None

    rows = []
    row_data = [
        ("Document Type", doc_type.upper()),
        ("Invoice No.", invoice_no or "—"),
    ]
    if date_val:
        row_data.append(("Date", date_val))
    if time_val:
        row_data.append(("Time", time_val))
    if conf_pct:
        row_data.append(("OCR Confidence", conf_pct))

    col1 = CONTENT_W * 0.35
    col2 = CONTENT_W * 0.65

    tbl_data = []
    for i in range(0, len(row_data), 2):
        left  = row_data[i]
        right = row_data[i + 1] if i + 1 < len(row_data) else ("", "")
        tbl_data.append([
            Paragraph(left[0],  STYLES["field_label"]),
            Paragraph(left[1],  STYLES["field_value"]),
            Paragraph(right[0], STYLES["field_label"]),
            Paragraph(right[1], STYLES["field_value"]),
        ])

    if not tbl_data:
        tbl_data = [[Paragraph("No document information available.", STYLES["field_label"])]]

    tbl = Table(tbl_data, colWidths=[col1 * 0.45, col1 * 0.55, col2 * 0.45, col2 * 0.55])
    tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def _build_vendor_section(parsed: Dict[str, Any]) -> Table:
    """Vendor name, address, phone, GSTIN, FSSAI."""
    vendor = parsed.get("vendor", {})    # nested schema
    flat   = parsed                       # flat schema fallback

    name    = vendor.get("name") or flat.get("vendor") or "—"
    phone   = vendor.get("phone") or flat.get("phone")
    email   = vendor.get("email") or flat.get("email")
    gstin   = vendor.get("gstin") or flat.get("tax_id")
    fssai   = vendor.get("fssai_number")

    addr_nested = vendor.get("address") or {}
    addr_flat   = flat.get("address")
    if addr_nested and addr_nested.get("line1"):
        addr_parts = [addr_nested["line1"]]
        if addr_nested.get("line2"):
            addr_parts.append(addr_nested["line2"])
        if addr_nested.get("city"):
            city_line = ", ".join(filter(None, [
                addr_nested.get("city"),
                addr_nested.get("state"),
                addr_nested.get("postal_code"),
            ]))
            if city_line:
                addr_parts.append(city_line)
        address_str = "\n".join(addr_parts)
    else:
        address_str = addr_flat

    # Layout: name+address left, meta right
    left_col  = CONTENT_W * 0.55
    right_col = CONTENT_W * 0.45

    left_items = [
        Paragraph(name.upper(), STYLES["vendor_name"]),
    ]
    if address_str:
        for line in str(address_str).split("\n"):
            left_items.append(Paragraph(line, STYLES["vendor_meta"]))

    right_items = []
    if phone:
        right_items.append(Paragraph(f"Phone: {phone}", STYLES["vendor_meta"]))
    if email:
        right_items.append(Paragraph(f"Email: {email}", STYLES["vendor_meta"]))
    if gstin:
        right_items.append(Paragraph(f"GSTIN: {gstin}", STYLES["vendor_meta"]))
    if fssai:
        right_items.append(Paragraph(f"FSSAI: {fssai}", STYLES["vendor_meta"]))

    if not right_items:
        right_items = [Paragraph("", STYLES["vendor_meta"])]

    tbl = Table(
        [[left_items, right_items]],
        colWidths=[left_col, right_col],
    )
    tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _build_payment_section(parsed: Dict[str, Any]) -> Table:
    """Payment method and expense category."""
    txn   = parsed.get("transaction", {})
    flat  = parsed

    payment = txn.get("payment_method") or flat.get("payment_method")
    category = txn.get("expense_category")

    col = CONTENT_W
    rows_data = []
    if payment:
        rows_data.append(("Payment Method", payment))
    if category:
        rows_data.append(("Expense Category", category))

    if not rows_data:
        return Table([[Paragraph("", STYLES["field_label"])]], colWidths=[col])

    tbl_data = []
    for label, value in rows_data:
        tbl_data.append([
            Paragraph(label, STYLES["field_label"]),
            Paragraph(value, STYLES["field_value"]),
        ])

    tbl = Table(tbl_data, colWidths=[col * 0.35, col * 0.65])
    tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def _build_line_items_table(parsed: Dict[str, Any], currency: str) -> Table:
    """Line items with columns: # | Item Name | Qty | Unit Price | GST% | Tax | Total."""
    items: List[Dict[str, Any]] = parsed.get("line_items", [])
    if not items:
        return Table(
            [[Paragraph("No line items detected.", STYLES["field_label"])]],
            colWidths=[CONTENT_W],
        )

    # Column widths (total ~170 mm)
    col_widths = [
        10 * mm,   # #
        68 * mm,   # Item Name
        16 * mm,   # Qty
        24 * mm,   # Unit Price
        16 * mm,   # GST%
        18 * mm,   # Tax
        18 * mm,   # Total
    ]

    # Header row
    headers = [
        Paragraph("#",             STYLES["item_num"]),
        Paragraph("Item Name",    STYLES["item_name_bold"]),
        Paragraph("Qty",          STYLES["item_num"]),
        Paragraph("Unit Price",   STYLES["money_bold"]),
        Paragraph("GST%",        STYLES["money_bold"]),
        Paragraph("Tax",          STYLES["money_bold"]),
        Paragraph("Total",        STYLES["money_bold"]),
    ]

    table_data = [headers]
    styles_cmds = [
        # Header styling
        ("BACKGROUND",   (0, 0), (-1, 0), SLATE_100),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0), 8.5),
        ("ALIGN",       (0, 0), (-1, 0), "CENTER"),
        ("VALIGN",      (0, 0), (-1, 0), "MIDDLE"),
        ("TOPPADDING",  (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING",(0,0), (-1, 0), 5),
        # Table borders
        ("BOX",         (0, 0), (-1, -1), 0.5, SLATE_200),
        ("LINEBELOW",   (0, 0), (-1, -1), 0.25, SLATE_200),
        # Padding
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",(0, 0), (-1, -1), 4),
        ("TOPPADDING",  (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING",(0,1),(-1, -1), 4),
        # Numeric columns right-aligned
        ("ALIGN",       (2, 1), (-1, -1), "RIGHT"),
        ("ALIGN",       (0, 1), (0, -1), "CENTER"),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
    ]

    for idx, item in enumerate(items, start=1):
        # Support both old flat schema and new nested schema
        item_name  = item.get("name") or item.get("item_name") or "—"
        qty        = item.get("quantity") or item.get("qty") or "1.000"
        unit_price = item.get("unit_price") or item.get("rate")
        gst_rate   = item.get("tax_rate") or item.get("gst")
        tax_amount = item.get("tax_amount")
        total_val  = item.get("total") or item.get("amount")

        # Shorten qty to sensible decimal
        try:
            qty_short = f"{float(qty):.2f}"
        except (ValueError, TypeError):
            qty_short = str(qty)

        # Format monetary values
        unit_str = format_money(unit_price, currency)
        tax_str  = format_money(tax_amount, currency) if tax_amount else "—"
        total_str = format_money(total_val, currency)

        # Alternate row background
        bg = SLATE_50 if idx % 2 == 0 else white
        row_idx = idx   # data rows start at 1 (0 is header)
        styles_cmds.append(("BACKGROUND", (0, row_idx), (-1, row_idx), bg))

        # For long item names, wrap in Paragraph
        name_para = Paragraph(item_name, STYLES["item_name"])

        row = [
            Paragraph(str(idx),                          STYLES["item_num"]),
            name_para,
            Paragraph(qty_short,                         STYLES["money"]),
            Paragraph(unit_str,                          STYLES["money"]),
            Paragraph(gst_rate or "—",                   STYLES["money"]),
            Paragraph(tax_str,                           STYLES["money"]),
            Paragraph(total_str,                         STYLES["money_bold"]),
        ]
        table_data.append(row)

    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle(styles_cmds))
    return tbl


def _build_totals_section(parsed: Dict[str, Any], currency: str) -> Table:
    """Subtotal, tax breakdown, round off, grand total."""
    amounts = parsed.get("amounts", {})   # nested schema
    flat    = parsed                      # flat schema fallback

    subtotal    = amounts.get("subtotal")    or flat.get("subtotal")
    cgst        = amounts.get("cgst")         or flat.get("cgst")
    sgst        = amounts.get("sgst")         or flat.get("sgst")
    igst        = amounts.get("igst")
    cess        = amounts.get("cess")
    tax_total   = amounts.get("tax_total")   or flat.get("tax")
    round_off   = amounts.get("round_off")
    grand_total = amounts.get("grand_total") or flat.get("grand_total") or flat.get("total")

    # Right-aligned totals, label | value pairs
    right_col = CONTENT_W * 0.40
    left_col  = CONTENT_W * 0.60

    rows: List[tuple] = []

    def add_row(label, value):
        rows.append((label, value))

    add_row("Subtotal", format_money(subtotal, currency))
    add_row("CGST",     format_money(cgst, currency))
    add_row("SGST",     format_money(sgst, currency))
    if igst:
        add_row("IGST", format_money(igst, currency))
    if cess:
        add_row("CESS", format_money(cess, currency))
    if tax_total and not (cgst or sgst):
        add_row("Tax", format_money(tax_total, currency))
    add_row("Round Off", format_money(round_off, currency))

    # Grand total row
    rows.append(("GRAND TOTAL", format_money(grand_total, currency)))

    # Build two-column table: empty left col | right-aligned label+value
    tbl_data = []
    for i, (label, value) in enumerate(rows):
        is_total = label == "GRAND TOTAL"
        lbl_style = STYLES["grand_total_label"] if is_total else STYLES["totals_label"]
        val_style = STYLES["grand_total_val"]  if is_total else STYLES["totals_value"]
        tbl_data.append([
            Paragraph("", lbl_style),
            Paragraph(label, lbl_style),
            Paragraph(value, val_style),
        ])

    tbl = Table(tbl_data, colWidths=[left_col * 0.55, left_col * 0.45, right_col])
    ts = TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ])
    # Highlight grand total row
    total_row_idx = len(rows) - 1
    ts.add("BACKGROUND", (0, total_row_idx), (-1, total_row_idx), TEAL)
    tbl.setStyle(ts)
    return tbl


def _build_warnings_section(warnings: List[str]) -> Table:
    """Amber warning box."""
    content = [Paragraph(f"⚠ {w}", STYLES["warning"]) for w in warnings]
    tbl = Table([content], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), AMBER_LIGHT),
        ("BOX",         (0, 0), (-1, -1), 0.5, AMBER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",(0, 0), (-1, -1), 8),
        ("TOPPADDING",  (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0,0),(-1, -1), 6),
    ]))
    return tbl


def _build_footer(parsed: Dict[str, Any]) -> Table:
    """Disclaimer footer with timestamp and page numbers."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    conf = parsed.get("confidence")
    conf_str = f"  |  OCR Confidence: {conf * 100:.0f}%" if conf else ""

    footer_left = (
        "Digitally reconstructed from OCR and user-reviewed data. "
        "This document is an expense record and not a replacement for the original tax invoice."
    )
    footer_right = f"Generated {now}{conf_str}"

    col1 = CONTENT_W * 0.60
    col2 = CONTENT_W * 0.40

    tbl = Table(
        [[
            Paragraph(footer_left, STYLES["footer"]),
            Paragraph(footer_right, STYLES["footer"]),
        ]],
        colWidths=[col1, col2],
    )
    tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


# ── Public helper ──────────────────────────────────────────────────────────────

def save_receipt_pdf(
    parsed: Dict[str, Any],
    upload_dir: str,
    document_id: int,
) -> str:
    """
    Generate and persist a PDF receipt.

    Returns the absolute file path of the saved PDF.
    """
    pdf_data = generate_receipt_pdf(parsed)
    filename = f"receipt_{document_id}.pdf"
    os.makedirs(upload_dir, exist_ok=True)
    path = os.path.join(upload_dir, filename)
    with open(path, "wb") as f:
        f.write(pdf_data)
    return path
