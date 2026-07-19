"""
Financial validation utilities using Decimal arithmetic.

All monetary calculations use Decimal (not float) to avoid
floating-point rounding errors common in currency computations.
"""
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

# ── Copied from app.py to keep this module self-contained ─────────────────────

AMOUNT_PATTERN = re.compile(
    r"(?:rs\.?|inr|usd|eur|gbp|aed|\$|₹|€|£)?\s?[-+]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?",
    re.IGNORECASE,
)


def decimal_string(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return f"{Decimal(cleaned):.2f}"
    except InvalidOperation:
        return None


def extract_amounts(text: str) -> List[str]:
    values = []
    for match in AMOUNT_PATTERN.findall(text):
        amount = decimal_string(match)
        if amount is not None:
            values.append(amount)
    return values

# ── Local helpers ────────────────────────────────────────────────────────────

def to_decimal(value: Any, default: Optional[Decimal] = None) -> Optional[Decimal]:
    """Coerce a value to Decimal, returning default if impossible."""
    if value is None:
        return default
    try:
        s = str(value).replace(",", "").strip()
        return Decimal(s) if s else default
    except (InvalidOperation, TypeError):
        return default


def round_currency(value: Decimal, places: int = 2) -> Decimal:
    """Round a Decimal to the given decimal places using ROUND_HALF_UP."""
    quantize_str = Decimal("0" + "." + "0" * places)
    return value.quantize(quantize_str, rounding=ROUND_HALF_UP)


def money(value: Optional[Decimal], places: int = 2) -> Optional[str]:
    """Format a Decimal as a localised currency string, or None."""
    if value is None:
        return None
    rounded = round_currency(value, places)
    return f"{rounded:.{places}f}"


# ── Line-item total validation ───────────────────────────────────────────────

VALIDATION_ERROR = "validation_error"
EXACT = "exact"
APPROXIMATE = "approximate"
MISSING = "missing"


def validate_line_item_totals(
    line_items: List[Dict[str, Any]],
    tolerance: Decimal = Decimal("0.04"),
) -> List[Dict[str, Any]]:
    """
    Validate that each line item's `total` equals ``rate × quantity`` within
    the given tolerance.

    Returns a list of validated items, each augmented with:
        * ``totals_match``: EXACT | APPROXIMATE | MISSING | VALIDATION_ERROR
        * ``expected_total``: computed rate × qty (rounded), or None
        * ``discrepancy``: |actual − expected|, or None
    """
    validated = []
    for item in line_items:
        rate = to_decimal(item.get("rate"))
        qty = to_decimal(item.get("quantity"), Decimal("1"))
        total = to_decimal(item.get("total"))

        if rate is None or qty is None or total is None:
            result = MISSING
            expected = None
            discrepancy = None
        else:
            try:
                expected = round_currency(rate * qty)
                diff = abs(total - expected)
                if diff == Decimal("0"):
                    result = EXACT
                elif diff <= tolerance:
                    result = APPROXIMATE
                else:
                    result = VALIDATION_ERROR
                discrepancy = diff
            except Exception:
                result = VALIDATION_ERROR
                expected = None
                discrepancy = None

        validated.append({
            **item,
            "totals_match": result,
            "expected_total": money(expected) if expected is not None else None,
            "discrepancy": money(discrepancy) if discrepancy is not None else None,
        })
    return validated


def validate_tax_totals(
    subtotal: Optional[str],
    cgst: Optional[str],
    sgst: Optional[str],
    igst: Optional[str],
    tax: Optional[str],
    cess: Optional[str],
    tolerance: Decimal = Decimal("0.04"),
) -> Dict[str, Any]:
    """
    Cross-validate tax components.

    Checks
    ------
    1. CGST ≈ SGST  (both should be equal for domestic transactions)
    2. IGST is absent when CGST/SGST are present (mutual exclusion)
    3. CGST + SGST ≈ tax (where tax is a combined figure)
    4. IGST alone ≈ tax

    Returns a dict of warnings keyed by check name.
    """
    warnings: Dict[str, Any] = {}

    d_subtotal = to_decimal(subtotal)
    d_cgst = to_decimal(cgst)
    d_sgst = to_decimal(sgst)
    d_igst = to_decimal(igst)
    d_tax = to_decimal(tax)
    d_cess = to_decimal(cess)

    # Check 1: CGST ≈ SGST
    if d_cgst is not None and d_sgst is not None:
        diff = abs(d_cgst - d_sgst)
        if diff > tolerance:
            warnings["cgst_sgst_mismatch"] = {
                "message": f"CGST ({cgst}) and SGST ({sgst}) differ by {money(diff)}",
                "severity": "error",
                "diff": money(diff),
            }
        elif diff > Decimal("0"):
            warnings["cgst_sgst_slight_diff"] = {
                "message": f"CGST and SGST differ slightly by {money(diff)}",
                "severity": "warning",
                "diff": money(diff),
            }

    # Check 2: IGST vs CGST/SGST mutual exclusion
    if d_igst is not None and (d_cgst is not None or d_sgst is not None):
        warnings["igst_with_cgst_sgst"] = {
            "message": "Both IGST and CGST/SGST are present; they should be mutually exclusive",
            "severity": "error",
        }

    # Check 3: CGST + SGST ≈ tax
    if d_cgst is not None and d_sgst is not None and d_tax is not None:
        combined = d_cgst + d_sgst
        diff = abs(combined - d_tax)
        if diff > tolerance:
            warnings["cgst_sgst_vs_tax_mismatch"] = {
                "message": f"CGST+SGST ({money(combined)}) differs from tax ({tax}) by {money(diff)}",
                "severity": "warning",
                "diff": money(diff),
            }

    # Check 4: IGST ≈ tax (when only IGST is present)
    if d_igst is not None and d_tax is not None and d_cgst is None and d_sgst is None:
        diff = abs(d_igst - d_tax)
        if diff > tolerance:
            warnings["igst_vs_tax_mismatch"] = {
                "message": f"IGST ({igst}) differs from tax ({tax}) by {money(diff)}",
                "severity": "warning",
                "diff": money(diff),
            }

    # Check 5: cess should be small relative to subtotal
    if d_cess is not None and d_subtotal is not None and d_subtotal > 0:
        cess_pct = (d_cess / d_subtotal) * 100
        if cess_pct > Decimal("20"):
            warnings["cess_seems_high"] = {
                "message": f"CESS ({cess}) is {round_currency(cess_pct)}% of subtotal — unusually high",
                "severity": "warning",
            }

    return warnings


def detect_price_includes_tax(
    subtotal: Optional[str],
    grand_total: Optional[str],
    tax: Optional[str],
    cgst: Optional[str],
    sgst: Optional[str],
) -> Optional[str]:
    """
    Detect whether unit prices on the bill include GST.

    Returns
    -------
    "yes"   – prices appear to be inclusive of tax
    "no"    – prices appear to be exclusive of tax
    None    – insufficient data to determine
    """
    d_subtotal = to_decimal(subtotal)
    d_grand_total = to_decimal(grand_total)
    d_tax = to_decimal(tax)
    d_cgst = to_decimal(cgst)
    d_sgst = to_decimal(sgst)

    if d_grand_total is None or d_subtotal is None:
        return None

    # Simple heuristic: if grand_total ≈ subtotal + tax, prices are exclusive
    # If grand_total ≈ subtotal, prices might be inclusive
    tax_amount = d_cgst + d_sgst if d_cgst is not None or d_sgst is not None else to_decimal(tax)

    if tax_amount is None:
        return None

    diff_excl = abs(d_grand_total - (d_subtotal + tax_amount))
    diff_incl = abs(d_grand_total - d_subtotal)

    tolerance = Decimal("1.00")
    if diff_incl <= tolerance and diff_excl > tolerance:
        return "yes"
    if diff_excl <= tolerance and diff_incl > tolerance:
        return "no"
    return None


# ── GSTIN validation ──────────────────────────────────────────────────────────

GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{3}$",
    re.IGNORECASE,
)


def validate_gstin(gstin: Optional[str]) -> Dict[str, Any]:
    """
    Validate a GSTIN (Goods and Services Tax Identification Number).

    Returns a dict with ``valid`` (bool), ``formatted`` (str or None),
    and ``error`` (str or None).
    """
    if not gstin:
        return {"valid": False, "formatted": None, "error": "GSTIN is empty"}

    raw = str(gstin).strip().upper().replace(" ", "")
    # Remove common prefix like "GSTIN:" if present
    if ":" in raw:
        raw = raw.split(":")[-1].strip()

    match = GSTIN_PATTERN.match(raw)
    if not match:
        return {"valid": False, "formatted": None, "error": "Invalid GSTIN format (expected 15 characters: 2 digits + 5 letters + 4 digits + 1 letter + 1 letter/digit + 1 letter/digit + 1 letter/digit)"}

    return {"valid": True, "formatted": raw, "error": None}


# ── Date validation ───────────────────────────────────────────────────────────

DATE_FORMATS = [
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
    "%m/%d/%Y", "%m-%d-%Y",
    "%Y-%m-%d",
    "%d %b %Y", "%d %B %Y",
    "%d %b %y",
    "%d/%m/%y", "%m/%d/%y", "%d-%m-%y", "%m-%d-%y",
]


def validate_date(date_str: Optional[str]) -> Dict[str, Any]:
    """
    Validate and parse a date string.

    Returns ``valid`` (bool), ``parsed`` (ISO str YYYY-MM-DD or None),
    and ``error`` (str or None).
    """
    if not date_str:
        return {"valid": False, "parsed": None, "error": "Date is empty"}

    cleaned = str(date_str).strip()
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return {"valid": True, "parsed": dt.strftime("%Y-%m-%d"), "error": None}
        except ValueError:
            continue

    return {"valid": False, "parsed": None, "error": f"Unrecognised date format: {date_str}"}


# ── Full bill validation ──────────────────────────────────────────────────────

def _resolve_field(parsed: Dict[str, Any], nested_key: str, flat_key: str) -> Any:
    """
    Resolve a field that may exist in either nested (amounts.*) or flat form.

    For the new normalized schema, ``nested_key`` is a dot-separated path
    into the nested dict (e.g. ``"amounts.cgst"``). For the old flat schema,
    ``flat_key`` is the top-level key.

    Returns the value from the nested path if it exists and is not None,
    otherwise falls back to the flat key.
    """
    # Try nested first
    parts = nested_key.split(".")
    val = parsed
    for part in parts:
        if isinstance(val, dict):
            val = val.get(part)
        else:
            val = None
            break
    if val is not None:
        return val
    # Fall back to flat
    return parsed.get(flat_key)


def _resolve_line_items(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return line items from the new nested schema (``parsed["line_items"]``)
    or the old flat schema (``parsed["line_items"]`` at top level).
    Both schemas use the same ``line_items`` key, but field names differ
    inside each item. ``validate_line_item_totals`` handles both.
    """
    return parsed.get("line_items", [])


def validate_bill(
    parsed: Dict[str, Any],
    tolerance: Decimal = Decimal("0.04"),
) -> Dict[str, Any]:
    """
    Run all financial validations on a parsed bill dict.

    Supports both the new normalized schema (with nested ``amounts`` dict)
    and the old flat schema. Resolution is automatic via ``_resolve_field``.

    Adds the following keys to the returned dict:
        * ``validation``: {
              ``line_items``: validated line items,
              ``tax_warnings``: dict from ``validate_tax_totals``,
              ``price_includes_tax``: "yes" | "no" | None,
              ``gstin``: validation result dict,
              ``date``: validation result dict,
          }
    """
    # Resolve from nested or flat schema
    line_items = _resolve_line_items(parsed)
    validated_items = validate_line_item_totals(line_items, tolerance=tolerance)

    # Amounts — try nested first, fall back to flat
    subtotal   = _resolve_field(parsed, "amounts.subtotal", "subtotal")
    cgst       = _resolve_field(parsed, "amounts.cgst", "cgst")
    sgst       = _resolve_field(parsed, "amounts.sgst", "sgst")
    igst       = _resolve_field(parsed, "amounts.igst", "igst")
    cess       = _resolve_field(parsed, "amounts.cess", "cess")
    tax_total  = _resolve_field(parsed, "amounts.tax_total", "tax")
    grand_total = _resolve_field(parsed, "amounts.grand_total", "grand_total") or _resolve_field(parsed, "amounts.grand_total", "total")
    tax        = tax_total or _resolve_field(parsed, "amounts.tax_total", "tax")

    tax_warnings = validate_tax_totals(
        subtotal=subtotal,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        tax=tax,
        cess=cess,
    )

    price_includes_tax = detect_price_includes_tax(
        subtotal=subtotal,
        grand_total=grand_total,
        tax=tax,
        cgst=cgst,
        sgst=sgst,
    )

    gstin_result = validate_gstin(_resolve_field(parsed, "vendor.gstin", "tax_id"))
    date_result = validate_date(_resolve_field(parsed, "document.date", "date"))

    return {
        **parsed,
        "validation": {
            "line_items": validated_items,
            "tax_warnings": tax_warnings,
            "price_includes_tax": price_includes_tax,
            "gstin": gstin_result,
            "date": date_result,
        },
    }
