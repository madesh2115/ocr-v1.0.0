"""
Analytics routes — summary, trends, category breakdown.
"""
from flask import Blueprint, request, jsonify, g

from services.auth_service import require_auth
from services.analytics_service import analytics_summary

analytics_bp = Blueprint("analytics", __name__, url_prefix="/analytics")


@analytics_bp.route("/summary", methods=["GET"])
@require_auth
def summary():
    """
    Get expense analytics summary for a time period.

    Query params:
      period: daily | yesterday | weekly | monthly | yearly  (default: monthly)
      org_id: optional organization ID for team analytics
    """
    period = request.args.get("period", "monthly")
    if period not in ("daily", "yesterday", "weekly", "monthly", "yearly"):
        period = "monthly"

    org_id = request.args.get("org_id", type=int) or None

    result = analytics_summary(g.user_id, period, org_id=org_id)

    # Convert Decimals to strings for JSON serialization
    def convert(obj):
        from decimal import Decimal
        if isinstance(obj, Decimal):
            return str(obj)
        if isinstance(obj, dict):
            return {k: convert(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [convert(i) for i in obj]
        return obj

    return jsonify({"success": True, **convert(result)})
