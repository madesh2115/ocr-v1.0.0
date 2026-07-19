"""
Analytics queries for the expense manager dashboard.
All queries filter by user_id and optionally organization_id.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from services.database import db_connect


def get_date_range(period: str) -> tuple:
    """Return (start_date, end_date, label) for the given period string."""
    now = datetime.now(timezone.utc)
    now_local = now.replace(hour=23, minute=59, second=59)

    if period == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        label = "Today"
    elif period == "yesterday":
        yesterday = now - timedelta(days=1)
        start = yesterday.replace(hour=0, minute=0, second=0, microsecond=0)
        end = yesterday.replace(hour=23, minute=59, second=59)
        label = "Yesterday"
    elif period == "weekly":
        start = now - timedelta(days=now.weekday())
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        label = "This Week"
    elif period == "monthly":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        label = "This Month"
    elif period == "yearly":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        label = "This Year"
    else:
        start = now - timedelta(days=30)
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        label = "Last 30 Days"
    return start, end, label


def analytics_summary(user_id: int, period: str, org_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Main analytics summary for a given time period.
    Returns all expense stats, breakdowns, and comparisons.
    """
    import json
    start_dt, end_dt, period_label = get_date_range(period)

    # Build date filters
    if org_id:
        query = """
            SELECT id, parsed_json, created_at, expense_category
            FROM ocr_documents
            WHERE user_id = %s
              AND (organization_id = %s OR organization_id IS NULL)
              AND created_at BETWEEN %s AND %s
        """
        params = [user_id, org_id, start_dt, end_dt]
    else:
        query = """
            SELECT id, parsed_json, created_at, expense_category
            FROM ocr_documents
            WHERE user_id = %s
              AND organization_id IS NULL
              AND created_at BETWEEN %s AND %s
        """
        params = [user_id, start_dt, end_dt]

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    # Process rows in Python
    expense_count = 0
    total_expenses = Decimal("0.00")
    total_tax = Decimal("0.00")
    vendors = set()
    category_map = {}
    payment_map = {}
    day_map = {}
    vendor_map = {}
    tax_breakdown = {"cgst": Decimal("0.00"), "sgst": Decimal("0.00"), "igst": Decimal("0.00"), "cess": Decimal("0.00")}

    for row in rows:
        try:
            parsed = json.loads(row["parsed_json"]) if row.get("parsed_json") else {}
        except Exception:
            continue

        grand_total = Decimal(str(parsed.get("grand_total") or parsed.get("total") or "0.00"))
        if grand_total <= 0:
            continue

        expense_count += 1
        total_expenses += grand_total

        tax = Decimal(str(parsed.get("tax") or "0.00"))
        total_tax += tax

        tax_breakdown["cgst"] += Decimal(str(parsed.get("cgst") or "0.00"))
        tax_breakdown["sgst"] += Decimal(str(parsed.get("sgst") or "0.00"))
        tax_breakdown["igst"] += Decimal(str(parsed.get("igst") or "0.00"))
        tax_breakdown["cess"] += Decimal(str(parsed.get("cess") or "0.00"))

        vendor = parsed.get("vendor")
        if vendor:
            vendors.add(vendor)
            if vendor not in vendor_map:
                vendor_map[vendor] = {"count": 0, "total": Decimal("0.00"), "largest": Decimal("0.00")}
            vendor_map[vendor]["count"] += 1
            vendor_map[vendor]["total"] += grand_total
            vendor_map[vendor]["largest"] = max(vendor_map[vendor]["largest"], grand_total)

        category = parsed.get("expense_category") or row.get("expense_category") or "Uncategorized"
        if category not in category_map:
            category_map[category] = {"count": 0, "total": Decimal("0.00")}
        category_map[category]["count"] += 1
        category_map[category]["total"] += grand_total

        payment = parsed.get("payment_method") or "Unknown"
        if payment not in payment_map:
            payment_map[payment] = {"count": 0, "total": Decimal("0.00")}
        payment_map[payment]["count"] += 1
        payment_map[payment]["total"] += grand_total

        created_date = row["created_at"].strftime("%Y-%m-%d")
        if created_date not in day_map:
            day_map[created_date] = {"count": 0, "total": Decimal("0.00")}
        day_map[created_date]["count"] += 1
        day_map[created_date]["total"] += grand_total

    # Load categories metadata (icons/colors)
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT name, icon, color 
                FROM expense_categories 
                WHERE (user_id = %s OR user_id IS NULL) AND org_id IS NULL
            """, (user_id,))
            cat_meta = {r["name"]: r for r in cur.fetchall()}

    by_category_list = []
    for cat_name, info in category_map.items():
        meta = cat_meta.get(cat_name, {})
        by_category_list.append({
            "category": cat_name,
            "count": info["count"],
            "total": info["total"],
            "average": round(float(info["total"]) / info["count"], 2) if info["count"] > 0 else 0.0,
            "icon": meta.get("icon", "receipt"),
            "color": meta.get("color", "#64748B"),
        })
    by_category_list.sort(key=lambda x: x["total"], reverse=True)

    by_payment_list = [
        {"method": pay_name, "count": info["count"], "total": info["total"]}
        for pay_name, info in payment_map.items()
    ]
    by_payment_list.sort(key=lambda x: x["total"], reverse=True)

    by_day_list = [
        {"date": d_str, "count": info["count"], "total": info["total"]}
        for d_str, info in sorted(day_map.items())
    ]

    top_vendors_list = [
        {"name": v_name, "count": info["count"], "total": info["total"], "largest_expense": info["largest"]}
        for v_name, info in vendor_map.items()
    ]
    top_vendors_list.sort(key=lambda x: x["total"], reverse=True)
    top_vendors_list = top_vendors_list[:5]

    # Calculate comparison for previous period
    period_length = max((end_dt - start_dt).days, 1)
    prev_start = start_dt - timedelta(days=period_length)
    prev_end = start_dt - timedelta(seconds=1)

    if org_id:
        prev_query = """
            SELECT parsed_json FROM ocr_documents
            WHERE user_id = %s
              AND (organization_id = %s OR organization_id IS NULL)
              AND created_at BETWEEN %s AND %s
        """
        prev_params = [user_id, org_id, prev_start, prev_end]
    else:
        prev_query = """
            SELECT parsed_json FROM ocr_documents
            WHERE user_id = %s
              AND organization_id IS NULL
              AND created_at BETWEEN %s AND %s
        """
        prev_params = [user_id, prev_start, prev_end]

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(prev_query, prev_params)
            prev_rows = cur.fetchall()

    prev_total = Decimal("0.00")
    for row in prev_rows:
        try:
            parsed = json.loads(row["parsed_json"]) if row.get("parsed_json") else {}
            grand_total = Decimal(str(parsed.get("grand_total") or parsed.get("total") or "0.00"))
            if grand_total > 0:
                prev_total += grand_total
        except Exception:
            continue

    if prev_total > 0:
        pct_change = round(float((total_expenses - prev_total) / prev_total * 100), 1)
    else:
        pct_change = 100.0 if total_expenses > 0 else 0.0

    return {
        "period": period,
        "period_label": period_label,
        "start_date": start_dt.strftime("%Y-%m-%d"),
        "end_date": end_dt.strftime("%Y-%m-%d"),
        "total_expenses": total_expenses,
        "expense_count": expense_count,
        "average_expense": round(float(total_expenses) / expense_count, 2) if expense_count > 0 else 0.0,
        "total_tax": total_tax,
        "vendor_count": len(vendors),
        "by_category": by_category_list,
        "by_payment_method": by_payment_list,
        "by_day": by_day_list,
        "top_vendors": top_vendors_list,
        "comparison": {
            "previous_period_total": prev_total,
            "percentage_change": pct_change,
            "trend": "up" if pct_change > 2 else "down" if pct_change < -2 else "flat",
        },
        "tax_breakdown": tax_breakdown,
    }
