"""
build_normalized_document() — transforms the flat parse_bill() output
into the new nested OCR V1.00 normalized JSON schema.
"""
import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

# ── Shared pattern (duplicated here so this module is self-contained) ──────────
AMOUNT_PATTERN = re.compile(
    r"(?:rs\.?|inr|usd|eur|gbp|aed|\$|₹|€|£)?\s?[-+]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?",
    re.IGNORECASE,
)


def _decimal_string(value: Any, places: int = 2) -> Optional[str]:
    """Format a value as a decimal string with the given number of decimal places."""
    if value is None or value == "":
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        d = Decimal(cleaned)
        fmt = "0." + "0" * places
        return f"{d.quantize(Decimal(fmt), rounding=ROUND_HALF_UP):.{places}f}"
    except (InvalidOperation, TypeError):
        return None


def _quantity_string(value: Any) -> str:
    """Always return a quantity as a 3-decimal-place string."""
    result = _decimal_string(value, places=3)
    return result if result is not None else "1.000"


# ── Date / time parsing ───────────────────────────────────────────────────────

DATE_FORMATS = [
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%m/%d/%Y",
    "%m-%d-%Y",
    "%Y-%m-%d",
    "%d %b %Y",
    "%d %B %Y",
    "%d %b %y",
]

TIME_PATTERN = re.compile(
    r"\b(?:time|lat)?[:\s]*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?)\b",
    re.IGNORECASE,
)


def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Convert a date string to YYYY-MM-DD. Returns None if unparseable."""
    if not date_str:
        return None
    cleaned = str(date_str).strip()
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_time(text: str) -> Optional[str]:
    """Extract a time string like '14:30' from OCR text. Returns None if not found."""
    match = TIME_PATTERN.search(text)
    if not match:
        return None
    time_str = match.group(1).strip().upper()
    # Normalize "14:30 PM" -> "14:30"
    time_str = re.sub(r"\s*(AM|PM)\s*$", "", time_str, flags=re.IGNORECASE)
    try:
        dt = datetime.strptime(time_str, "%H:%M:%S")
        return dt.strftime("%H:%M")
    except ValueError:
        try:
            dt = datetime.strptime(time_str, "%H:%M")
            return dt.strftime("%H:%M")
        except ValueError:
            return None


# ── Address parsing ───────────────────────────────────────────────────────────

ADDRESS_KEYWORDS = (
    "road", "street", "st.", "st,", "lane", "nagar", "city", "pin", "zip",
    "area", "colony", "block", "sector", "opp", "near", "building",
    "flat", "#", "floor", "district", "dist",
)


def parse_address(address_str: Optional[str]) -> Dict[str, Optional[str]]:
    """Split a flat address string into address component fields."""
    if not address_str:
        return {
            "line1": None, "line2": None,
            "city": None, "state": None,
            "postal_code": None, "country": "India",
        }

    # Try to split on common delimiters first
    parts = re.split(r"[,|\n]+", address_str)
    parts = [p.strip() for p in parts if p.strip()]

    line1 = None
    line2 = None
    city = None
    state = None
    postal_code = None

    # Look for postal code (6 digits for India)
    postal_pattern = re.compile(r"\b\d{6}\b")
    # Look for state names (simplified list)
    INDIAN_STATES = [
        "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
        "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka",
        "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya",
        "mizoram", "nagaland", "odisha", "punjab", "rajasthan", "sikkim",
        "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand",
        "west bengal", "delhi", "chandigarh",
    ]

    remaining = []
    for part in parts:
        part_lower = part.lower()
        # postal code
        pc_match = postal_pattern.search(part)
        if pc_match and postal_code is None:
            postal_code = pc_match.group(0)
            remaining.append(part[: pc_match.start()].strip())
            continue
        # state
        state_found = None
        for st in INDIAN_STATES:
            if st in part_lower:
                state_found = st.title()
                break
        if state_found and state is None:
            state = state_found
            remaining.append(part[: part_lower.index(st_found if (st_found := next((s for s in INDIAN_STATES if s in part_lower), None)) else len(part))].strip())
            continue
        remaining.append(part)

    remaining = [r for r in remaining if r]

    if remaining:
        line1 = remaining[0]
    if len(remaining) > 1:
        line2 = remaining[1]
    if len(remaining) > 2:
        city = remaining[2]

    return {
        "line1": line1,
        "line2": line2,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "country": "India",
    }


# ── Tax rate extraction ───────────────────────────────────────────────────────

def extract_tax_rate(gst_str: Optional[str]) -> Optional[str]:
    """Extract a tax rate like '5%' or '18.0' from a GST string like '5%' or 'GST 18%'."""
    if not gst_str:
        return None
    # Remove spaces then look for percentage
    cleaned = gst_str.replace(" ", "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*%", cleaned)
    if match:
        rate = Decimal(match.group(1))
        return f"{rate.quantize(Decimal('0.01')):.2f}"
    # Maybe it's just a number
    try:
        rate = Decimal(cleaned)
        return f"{rate.quantize(Decimal('0.01')):.2f}"
    except (InvalidOperation, TypeError):
        return None


# ── Tax total computation ─────────────────────────────────────────────────────

def compute_tax_total(
    cgst: Optional[str],
    sgst: Optional[str],
    igst: Optional[str],
    cess: Optional[str],
) -> str:
    """Sum CGST + SGST + IGST + CESS using Decimal arithmetic."""
    total = Decimal("0.00")
    for val in (cgst, sgst, igst, cess):
        if val:
            try:
                total += Decimal(val)
            except (InvalidOperation, TypeError):
                pass
    return f"{total.quantize(Decimal('0.01')):.2f}"


# ── Money helpers ─────────────────────────────────────────────────────────────

ZERO = "0.00"


def _opt_decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value).replace(",", ""))
    except (InvalidOperation, TypeError):
        return None


# ── Main normalizer ────────────────────────────────────────────────────────────

def build_normalized_document(
    ocr: Dict[str, Any],
    parsed: Dict[str, Any],
    start_time: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Transform ``ocr`` (raw OCR output) and ``parsed`` (flat parse_bill output)
    into the new normalized nested JSON schema.

    Parameters
    ----------
    ocr : dict
        Raw OCR output from ``read_ocr()`` — keys include ``lines``, ``rows``.
    parsed : dict
        Output of the existing ``parse_bill()`` — flat schema.
    start_time : float, optional
        Unix timestamp when the /extract request started. Used to compute
        ``processing_time_ms``.

    Returns
    -------
    dict
        The complete normalized document conforming to OCR V1.00 schema 1.0.
    """
    lines = ocr.get("lines", [])
    rows = ocr.get("rows", [])
    text = "\n".join(lines)

    # ── document.date ────────────────────────────────────────────────────────
    raw_date = parsed.get("date")
    document_date = parse_date(raw_date)

    # ── document.time ───────────────────────────────────────────────────────
    document_time = parse_time(text)

    # ── document.currency ───────────────────────────────────────────────────
    currency = parsed.get("currency") or "INR"

    # ── document.prices_include_tax ─────────────────────────────────────────
    # detect_price_includes_tax needs: subtotal, grand_total, tax, cgst, sgst
    from services.decimal_utils import detect_price_includes_tax
    prices_include_tax = detect_price_includes_tax(
        subtotal=parsed.get("subtotal"),
        grand_total=parsed.get("grand_total") or parsed.get("total"),
        tax=parsed.get("tax"),
        cgst=parsed.get("cgst"),
        sgst=parsed.get("sgst"),
    )

    # ── vendor ──────────────────────────────────────────────────────────────
    address_raw = parsed.get("address")
    address_parsed = parse_address(address_raw)

    # ── amounts ─────────────────────────────────────────────────────────────
    subtotal = parsed.get("subtotal")
    cgst_val = parsed.get("cgst")
    sgst_val = parsed.get("sgst")
    igst_val = parsed.get("igst")     # may be None in current schema
    cess_val = parsed.get("cess")
    round_off = parsed.get("round_off")
    grand_total = parsed.get("grand_total") or parsed.get("total")

    tax_total = compute_tax_total(cgst_val, sgst_val, igst_val, cess_val)

    # ── line items ──────────────────────────────────────────────────────────
    raw_items = parsed.get("line_items", [])
    transformed_items: List[Dict[str, Any]] = []

    for idx, item in enumerate(raw_items, start=1):
        rate_val = item.get("rate")
        qty_val = item.get("quantity")
        total_val = item.get("total")
        gst_val = item.get("gst")

        unit_price = _decimal_string(rate_val, places=2)
        item_total = _decimal_string(total_val, places=2)
        qty_str = _quantity_string(qty_val)
        tax_rate = extract_tax_rate(gst_val)
        confidence = round(float(item.get("confidence", 0.65)), 3)

        transformed_items.append({
            # New normalized field names (primary)
            "id": None,
            "name": item.get("item_name"),
            "description": None,
            "hsn_code": None,
            "quantity": qty_str,
            "unit": "item",
            "unit_price": unit_price,
            "gross_amount": None,
            "discount": ZERO,
            "tax_rate": tax_rate,
            "tax_amount": None,
            "total": item_total,
            "confidence": confidence,
            "manually_corrected": False,
            # Flat aliases for backward compat with existing ResultScreen & store_document
            "item_name": item.get("item_name"),
            "text": item.get("raw_text"),
            "rate": unit_price,
            "quantity": qty_str,
            "amount": item_total,
            "gst": gst_val,
            "raw_text": item.get("raw_text"),
            "learned": item.get("learned"),
        })

    # ── amounts completeness check → prices_include_tax ──────────────────────
    # If we have line items and a grand_total, check if sum of item totals
    # is close to grand_total (prices include tax) or subtotal (exclusive).
    # Only update prices_include_tax if the existing heuristic returned None.
    if prices_include_tax is None and transformed_items and grand_total:
        item_sum = Decimal("0.00")
        for item in transformed_items:
            tv = _opt_decimal(item.get("total"))
            if tv is not None:
                item_sum += tv

        d_grand = _opt_decimal(grand_total)
        d_sub = _opt_decimal(subtotal)

        if d_grand is not None and d_sub is not None:
            diff_to_grand = abs(d_grand - item_sum)
            diff_to_sub = abs(d_sub - item_sum)
            tolerance = Decimal("1.00")
            if diff_to_grand <= tolerance and diff_to_sub > tolerance:
                prices_include_tax = "yes"
            elif diff_to_sub <= tolerance and diff_to_grand > tolerance:
                prices_include_tax = "no"

    # ── verification ────────────────────────────────────────────────────────
    total_matches_items = None
    if transformed_items and grand_total:
        item_sum = Decimal("0.00")
        for item in transformed_items:
            tv = _opt_decimal(item.get("total"))
            if tv is not None:
                item_sum += tv
        d_grand = _opt_decimal(grand_total)
        if d_grand is not None:
            diff = abs(d_grand - item_sum)
            total_matches_items = diff <= Decimal("1.00")

    tax_calculation_valid = None
    if all(v is not None for v in [cgst_val, sgst_val, grand_total, subtotal]):
        d_cgst = _opt_decimal(cgst_val)
        d_sgst = _opt_decimal(sgst_val)
        d_grand = _opt_decimal(grand_total)
        d_sub = _opt_decimal(subtotal)
        d_round = _opt_decimal(round_off) or Decimal("0.00")
        if all(v is not None for v in [d_cgst, d_sgst, d_grand, d_sub]):
            expected_grand = d_sub + d_cgst + d_sgst + d_round
            tax_calculation_valid = abs(d_grand - expected_grand) <= Decimal("0.04")

    verification_warnings: List[str] = []
    if parsed.get("validation", {}).get("tax_warnings"):
        for key, val in parsed["validation"]["tax_warnings"].items():
            if isinstance(val, dict) and val.get("severity") == "error":
                verification_warnings.append(val.get("message", key))

    # ── processing_time_ms ──────────────────────────────────────────────────
    processing_time_ms: Optional[int] = None
    if start_time is not None:
        elapsed = time.time() - start_time
        processing_time_ms = int(elapsed * 1000)

    # ── ocr_metadata ─────────────────────────────────────────────────────────
    ocr_engine = parsed.get("ocr_engine")
    avg_confidence = ocr.get("avg_confidence", 0.65)

    # ── Build the normalized document ────────────────────────────────────────
    normalized: Dict[str, Any] = {
        "schema_version": "1.0",
        "document_id": None,
        "document": {
            "type": (parsed.get("document_type") or "Document").lower(),
            "invoice_number": parsed.get("invoice_number"),
            "date": document_date,
            "time": document_time,
            "currency": currency,
            "language": "en",
            "prices_include_tax": prices_include_tax,
        },
        "vendor": {
            "name": parsed.get("vendor"),
            "branch": None,
            "phone": parsed.get("phone"),
            "email": parsed.get("email"),
            "gstin": parsed.get("tax_id"),
            "fssai_number": None,
            "address": address_parsed,
        },
        "transaction": {
            "payment_method": parsed.get("payment_method"),
            "expense_category": None,
            "notes": None,
        },
        "amounts": {
            "subtotal": _decimal_string(subtotal, places=2) if subtotal else None,
            "discount": ZERO,
            "cgst": _decimal_string(cgst_val, places=2) if cgst_val else ZERO,
            "sgst": _decimal_string(sgst_val, places=2) if sgst_val else ZERO,
            "igst": _decimal_string(igst_val, places=2) if igst_val else ZERO,
            "cess": _decimal_string(cess_val, places=2) if cess_val else ZERO,
            "tax_total": tax_total,
            "round_off": _decimal_string(round_off, places=2) if round_off else ZERO,
            "grand_total": _decimal_string(grand_total, places=2) if grand_total else None,
        },
        "line_items": transformed_items,
        "files": {
            "original_image_url": None,
            "cropped_image_url": None,
            "digital_copy_url": None,
            "pdf_url": None,
        },
        "verification": {
            "status": "unreviewed",
            "corrected_by_user": False,
            "reviewed_at": None,
            "total_matches_items": total_matches_items,
            "tax_calculation_valid": tax_calculation_valid,
            "duplicate_suspected": False,
            "warnings": verification_warnings,
        },
        "ocr_metadata": {
            "engine": ocr_engine,
            "overall_confidence": round(avg_confidence, 3),
            "processing_time_ms": processing_time_ms,
        },
    }

    return normalized
