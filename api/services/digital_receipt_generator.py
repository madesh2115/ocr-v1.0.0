"""
Digital receipt PNG generator using Pillow.

Generates a clean, printable A5-style receipt PNG from a parsed bill dict.
Used to produce the digital_copy_path artefact stored alongside the original scan.
"""
import io
import os
import textwrap
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

# ── Colour palette ────────────────────────────────────────────────────────────

BG = (255, 255, 255)          # white
TEXT_DARK = (15, 23, 42)       # near-black  #0F172A
TEXT_MID  = (71, 85, 105)      # slate-600   #475569
TEXT_LIGHT= (100, 116, 139)    # slate-500   #64748B
ACCENT    = (20, 184, 166)    # teal-500    #14B8A6
ACCENT2   = (13, 148, 136)    # teal-600    #0D9488
DIVIDER   = (226, 232, 240)    # slate-200   #E2E8F0
WARN_BG   = (254, 242, 242)   # red-50
WARN_TEXT = (153, 27, 27)     # red-700     #991B1B
SECTION_HDR_BG = (248, 250, 252) # slate-50 #F8FAFC

# ── Font loader ──────────────────────────────────────────────────────────────

# Try to use a system monospace / sans-serif; fall back to default.
def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
        "C:\\Windows\\Fonts\\consola.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


FONT_TITLE    = _load_font(18, bold=True)
FONT_SECTION  = _load_font(12, bold=True)
FONT_BODY     = _load_font(10)
FONT_BODY_BOLD= _load_font(10, bold=True)
FONT_MONO     = _load_font(9)
FONT_SMALL    = _load_font(8)
FONT_FOOTER   = _load_font(7)

# ── Page dimensions (A5 at 72dpi: 420 × 595 pt → 420 × 595 px) ───────────────

PAGE_W = 420
MARGIN = 28
LINE_H = 14
SECTION_GAP = 10


# ── Core generator ───────────────────────────────────────────────────────────

def generate_receipt_png(
    parsed: Dict[str, Any],
    output_path: Optional[str] = None,
) -> bytes:
    """
    Render a parsed bill as a PNG byte string.

    Parameters
    ----------
    parsed : dict
        The full extraction result dict (same shape as returned by parse_bill).
    output_path : str, optional
        If provided, the PNG is saved to this path as well as returned.

    Returns
    -------
    bytes
        PNG-encoded image data.
    """
    img = Image.new("RGB", (PAGE_W, 800), BG)
    draw = ImageDraw.Draw(img)

    y = 0  # current cursor Y

    # ── Header band ────────────────────────────────────────────────────────────
    y = _draw_header(draw, parsed, y)

    # ── Vendor / address ───────────────────────────────────────────────────────
    y = _draw_vendor(draw, parsed, y)

    # ── Bill meta (invoice no, date, GSTIN) ───────────────────────────────────
    y = _draw_meta(draw, parsed, y)

    # ── Divider ───────────────────────────────────────────────────────────────
    y = _draw_divider(draw, y)

    # ── Line items table ──────────────────────────────────────────────────────
    y = _draw_line_items(draw, parsed, y)

    # ── Divider ───────────────────────────────────────────────────────────────
    y = _draw_divider(draw, y)

    # ── Tax breakdown ─────────────────────────────────────────────────────────
    y = _draw_tax(draw, parsed, y)

    # ── Totals panel ──────────────────────────────────────────────────────────
    y = _draw_totals(draw, parsed, y)

    # ── Payment / contact ─────────────────────────────────────────────────────
    y = _draw_payment(draw, parsed, y)

    # ── Validation warnings ───────────────────────────────────────────────────
    if parsed.get("validation"):
        y = _draw_validation_warnings(draw, parsed, y)

    # ── Footer ───────────────────────────────────────────────────────────────
    y = _draw_footer(draw, y)

    # Crop to content
    img = img.crop((0, 0, PAGE_W, max(y + MARGIN, 700)))

    if output_path:
        img.save(output_path, "PNG")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Section renderers ────────────────────────────────────────────────────────

def _draw_header(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    # Teal accent bar
    draw.rectangle([0, y, PAGE_W, y + 4], fill=ACCENT)
    y += 6

    # Document type label
    doc_type = parsed.get("document_type", "RECEIPT").upper()
    draw.text((MARGIN, y), doc_type, font=FONT_TITLE, fill=TEXT_DARK)
    y += LINE_H + 4

    # Confidence badge
    conf = parsed.get("confidence", 0)
    conf_pct = f"{conf * 100:.0f}%" if conf else "—"
    conf_color = ACCENT2 if conf and conf >= 0.7 else (200, 100, 100)
    draw.text((MARGIN, y), f"OCR Confidence: {conf_pct}", font=FONT_SMALL, fill=conf_color)
    y += LINE_H + 2

    # Separator line
    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=DIVIDER)
    y += SECTION_GAP
    return y


def _draw_vendor(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    vendor = parsed.get("vendor")
    if not vendor:
        return y

    draw.text((MARGIN, y), "VENDOR", font=FONT_SECTION, fill=TEXT_LIGHT)
    y += LINE_H - 2
    draw.text((MARGIN, y), vendor.upper(), font=FONT_BODY_BOLD, fill=TEXT_DARK)
    y += LINE_H

    address = parsed.get("address")
    if address:
        draw.text((MARGIN, y), str(address), font=FONT_SMALL, fill=TEXT_MID)
        y += LINE_H

    return y + SECTION_GAP // 2


def _draw_meta(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    fields = [
        ("Invoice No.", parsed.get("invoice_number")),
        ("Date", parsed.get("date")),
        ("GSTIN / Tax ID", parsed.get("tax_id")),
    ]

    for label, value in fields:
        if not value:
            continue
        draw.text((MARGIN, y), label, font=FONT_SMALL, fill=TEXT_LIGHT)
        draw.text((MARGIN + 100, y), str(value), font=FONT_BODY, fill=TEXT_DARK)
        y += LINE_H - 2

    return y + SECTION_GAP // 2


def _draw_divider(draw: ImageDraw.ImageDraw, y: int) -> int:
    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=DIVIDER)
    return y + SECTION_GAP


def _draw_line_items(
    draw: ImageDraw.ImageDraw,
    parsed: Dict[str, Any],
    y: int,
) -> int:
    line_items: List[Dict[str, Any]] = parsed.get("line_items", [])
    if not line_items:
        draw.text((MARGIN, y), "No line items detected.", font=FONT_SMALL, fill=TEXT_LIGHT)
        return y + LINE_H

    # ── Table header ─────────────────────────────────────────────────────────
    col_widths = [200, 54, 50, 60]  # name | rate | qty | total
    headers = ["Item", "Rate", "Qty", "Total"]

    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + LINE_H], fill=SECTION_HDR_BG)
    x = MARGIN
    for i, header in enumerate(headers):
        draw.text((x + 2, y), header, font=FONT_SMALL, fill=TEXT_LIGHT)
        x += col_widths[i]
    y += LINE_H

    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=DIVIDER)
    y += 2

    # ── Rows ─────────────────────────────────────────────────────────────────
    for item in line_items:
        # Support both old schema (item_name, rate) and new schema (name, unit_price)
        name  = item.get("name") or item.get("item_name") or item.get("text") or "—"
        rate  = item.get("unit_price") or item.get("rate") or "—"
        qty   = item.get("quantity") or "1"
        total = item.get("total") or item.get("amount") or "—"

        # Wrap long item names
        wrapped = textwrap.wrap(name, width=28) or [name]
        row_h = len(wrapped) * (FONT_SMALL.size + 2)

        # Draw row background (zebra)
        if (parsed["line_items"].index(item)) % 2 == 0:
            draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + row_h], fill=SECTION_HDR_BG)

        x = MARGIN + 2
        # Item name (may wrap)
        for line in wrapped:
            draw.text((x, y), line, font=FONT_SMALL, fill=TEXT_DARK)
            y += FONT_SMALL.size + 2
        y -= len(wrapped) * (FONT_SMALL.size + 2)  # reset to start of row for next col

        x += col_widths[0]
        draw.text((x, y), str(rate), font=FONT_SMALL, fill=TEXT_MID); x += col_widths[1]
        draw.text((x, y), str(qty),  font=FONT_SMALL, fill=TEXT_MID); x += col_widths[2]
        draw.text((x, y), str(total), font=FONT_SMALL, fill=TEXT_DARK)

        y += max(row_h, LINE_H - 2) + 1

    # Validation indicators for line items
    if any(item.get("totals_match") for item in line_items):
        y += 4
        for item in line_items:
            match = item.get("totals_match")
            if match and match != "exact":
                name = (item.get("name") or item.get("item_name") or "?")[:30]
                color = (200, 80, 80) if match == "validation_error" else (200, 160, 60)
                draw.text(
                    (MARGIN, y),
                    f"! {name}: {match.replace('_', ' ')} (exp: {item.get('expected_total', '?')})",
                    font=FONT_SMALL, fill=color,
                )
                y += LINE_H - 2

    return y + SECTION_GAP


def _draw_tax(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    tax_rows = []
    for label, key in [
        ("CGST", "cgst"),
        ("SGST", "sgst"),
        ("CESS", "cess"),
        ("Tax", "tax"),
    ]:
        val = parsed.get(key)
        if val:
            tax_rows.append((label, val))

    if not tax_rows:
        return y

    draw.text((MARGIN, y), "TAX BREAKDOWN", font=FONT_SECTION, fill=TEXT_LIGHT)
    y += LINE_H - 2

    for label, value in tax_rows:
        draw.text((MARGIN, y), label, font=FONT_BODY, fill=TEXT_MID)
        draw.text((MARGIN + 60, y), str(value), font=FONT_BODY, fill=TEXT_DARK)
        y += LINE_H - 2

    gst_rate = parsed.get("gst_rate")
    if gst_rate:
        draw.text((MARGIN, y), f"GST Rate: {gst_rate}", font=FONT_SMALL, fill=TEXT_LIGHT)

    return y + SECTION_GAP


def _draw_totals(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=ACCENT)
    y += 6

    total_rows = [
        ("Subtotal", parsed.get("subtotal")),
        ("Round Off", parsed.get("round_off")),
        ("Grand Total", parsed.get("grand_total")),
        ("TOTAL", parsed.get("total")),
    ]

    for label, value in total_rows:
        is_total = label in ("TOTAL", "Grand Total")
        font = FONT_BODY_BOLD if is_total else FONT_BODY
        color = TEXT_DARK
        draw.text((MARGIN, y), label, font=font, fill=color)
        val_str = str(value) if value else "—"
        # Right-align value
        val_w = draw.textlength(val_str, font=font)
        draw.text((PAGE_W - MARGIN - val_w, y), val_str, font=font, fill=color)
        y += LINE_H - 2

    currency = parsed.get("currency", "INR")
    if currency:
        y -= 2
        draw.text((MARGIN, y), f"Currency: {currency}", font=FONT_SMALL, fill=TEXT_LIGHT)

    return y + SECTION_GAP


def _draw_payment(draw: ImageDraw.ImageDraw, parsed: Dict[str, Any], y: int) -> int:
    payment = parsed.get("payment_method")
    phone   = parsed.get("phone")
    email   = parsed.get("email")

    if any([payment, phone, email]):
        draw.text((MARGIN, y), "PAYMENT & CONTACT", font=FONT_SECTION, fill=TEXT_LIGHT)
        y += LINE_H - 2

    if payment:
        draw.text((MARGIN, y), f"Payment: {payment}", font=FONT_BODY, fill=TEXT_DARK)
        y += LINE_H - 2
    if phone:
        draw.text((MARGIN, y), f"Phone: {phone}", font=FONT_SMALL, fill=TEXT_MID)
        y += LINE_H - 2
    if email:
        draw.text((MARGIN, y), f"Email: {email}", font=FONT_SMALL, fill=TEXT_MID)
        y += LINE_H - 2

    return y + SECTION_GAP


def _draw_validation_warnings(
    draw: ImageDraw.ImageDraw,
    parsed: Dict[str, Any],
    y: int,
) -> int:
    validation = parsed["validation"]
    tax_warnings = validation.get("tax_warnings", {})

    if not tax_warnings:
        return y

    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=DIVIDER)
    y += SECTION_GAP

    draw.text((MARGIN, y), "VALIDATION WARNINGS", font=FONT_SECTION, fill=WARN_TEXT)
    y += LINE_H

    for key, warning in tax_warnings.items():
        msg = warning.get("message", key)
        draw.text((MARGIN, y), f"⚠ {msg}", font=FONT_SMALL, fill=WARN_TEXT)
        y += LINE_H - 2

    return y + SECTION_GAP // 2


def _draw_footer(draw: ImageDraw.ImageDraw, y: int) -> int:
    y = max(y + SECTION_GAP, 640)
    draw.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 1], fill=DIVIDER)
    y += 4

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    draw.text(
        (MARGIN, y),
        f"Generated by OCR API  •  {now}  •  Not a tax invoice",
        font=FONT_FOOTER, fill=TEXT_LIGHT,
    )
    return y + LINE_H


# ── Public helper ────────────────────────────────────────────────────────────

def save_digital_receipt(
    parsed: Dict[str, Any],
    user_id: int,
    document_id: int,
) -> str:
    """
    Generate and persist a digital receipt PNG to the structured document directory.

    Parameters
    ----------
    parsed : dict
        The parsed bill dict passed through from parse_bill.
    user_id : int
        Owner user ID (placeholder until auth is implemented).
    document_id : int
        The newly-assigned document ID.

    Returns
    -------
    str
        Absolute file path of the saved PNG
        (e.g. ``.../uploads/users/1/documents/42/digital-copy.png``).
    """
    # Import here to avoid circular dependency at module load time
    from services.file_storage_service import get_document_dir

    png_data = generate_receipt_png(parsed)
    filename = "digital-copy.png"
    doc_dir = get_document_dir(user_id, document_id)
    path = os.path.join(doc_dir, filename)
    with open(path, "wb") as f:
        f.write(png_data)

    return path
