"""
Expense categories routes — CRUD for personal and team expense categories.
"""
from flask import Blueprint, request, jsonify, g

from services.auth_service import require_auth, db_connect

cat_bp = Blueprint("categories", __name__, url_prefix="/categories")


def api_error(code: str, message: str, status: int = 400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


def serialize_cat(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "icon": row.get("icon", "receipt"),
        "color": row.get("color", "#64748B"),
        "is_system": bool(row.get("is_system", 0)),
        "sort_order": int(row.get("sort_order", 0)),
        "org_id": row.get("org_id"),
    }


@cat_bp.route("", methods=["GET"])
@require_auth
def list_categories():
    """List all categories for the user (personal + org-level)."""
    org_id = request.args.get("org_id", type=int)

    if org_id:
        # Verify membership
        if not _is_org_member(org_id, g.user_id):
            return api_error("FORBIDDEN", "Not a member of this organization.", 403)
        query = """
            SELECT * FROM expense_categories
            WHERE (user_id = %s OR user_id IS NULL) AND (org_id = %s OR org_id IS NULL)
            ORDER BY is_system DESC, sort_order ASC, name ASC
        """
        params = (g.user_id, org_id)
    else:
        # Personal categories only
        query = """
            SELECT * FROM expense_categories
            WHERE user_id = %s AND org_id IS NULL
            ORDER BY is_system DESC, sort_order ASC, name ASC
        """
        params = (g.user_id,)

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            categories = [serialize_cat(dict(row)) for row in cur.fetchall()]

    return jsonify({"success": True, "categories": categories})


@cat_bp.route("", methods=["POST"])
@require_auth
def create_category():
    """Create a custom expense category."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    icon = data.get("icon", "receipt")
    color = data.get("color", "#64748B")
    org_id = data.get("org_id", type=int) or None

    if not name:
        return api_error("MISSING_NAME", "Category name is required.")
    if len(name) > 100:
        return api_error("NAME_TOO_LONG", "Category name must be 100 characters or less.")

    if org_id:
        if not _is_org_member(org_id, g.user_id):
            return api_error("FORBIDDEN", "Not a member of this organization.", 403)
        role = _get_member_role(org_id, g.user_id)
        if role not in ("owner", "admin"):
            return api_error("FORBIDDEN", "Only owners and admins can create team categories.", 403)

    with db_connect() as conn:
        with conn.cursor() as cur:
            # Check duplicate
            cur.execute(
                """
                SELECT 1 FROM expense_categories
                WHERE name = %s AND user_id = %s AND org_id IS NOT DISTINCT FROM %s
                """,
                (name, g.user_id if not org_id else None, org_id)
            )
            if cur.fetchone():
                return api_error("DUPLICATE_NAME", "A category with this name already exists.", 409)

            cur.execute(
                """
                INSERT INTO expense_categories (user_id, org_id, name, icon, color, is_system, sort_order)
                VALUES (%s, %s, %s, %s, %s, 0,
                    (SELECT COALESCE(MAX(sort_order), 0) + 1
                     FROM (SELECT sort_order FROM expense_categories WHERE user_id = %s AND org_id IS NOT DISTINCT FROM %s) AS t)
                )
                """,
                (g.user_id, org_id, name, icon, color, g.user_id, org_id)
            )
            cat_id = int(cur.lastrowid)
            cur.execute("SELECT * FROM expense_categories WHERE id = %s", (cat_id,))
            cat = dict(cur.fetchone())
        conn.commit()

    return jsonify({"success": True, "category": serialize_cat(cat)}), 201


@cat_bp.route("/<int:cat_id>", methods=["PUT"])
@require_auth
def update_category(cat_id: int):
    """Update a custom category (not system categories)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    icon = data.get("icon")
    color = data.get("color")
    sort_order = data.get("sort_order", type=int)

    with db_connect() as conn:
        with conn.cursor() as cur:
            # Check ownership
            cur.execute(
                "SELECT * FROM expense_categories WHERE id = %s AND user_id = %s",
                (cat_id, g.user_id)
            )
            existing = cur.fetchone()
            if not existing:
                return api_error("NOT_FOUND", "Category not found.", 404)
            if existing.get("is_system") and name:
                return api_error("CANNOT_RENAME_SYSTEM",
                    "System categories cannot be renamed. Create a custom category instead.", 400)

            updates = []
            params = []
            if name:
                updates.append("name = %s")
                params.append(name)
            if icon:
                updates.append("icon = %s")
                params.append(icon)
            if color:
                updates.append("color = %s")
                params.append(color)
            if sort_order is not None:
                updates.append("sort_order = %s")
                params.append(sort_order)

            if updates:
                params.append(cat_id)
                cur.execute(
                    f"UPDATE expense_categories SET {', '.join(updates)} WHERE id = %s",
                    params
                )

            cur.execute("SELECT * FROM expense_categories WHERE id = %s", (cat_id,))
            cat = dict(cur.fetchone())
        conn.commit()

    return jsonify({"success": True, "category": serialize_cat(cat)})


@cat_bp.route("/<int:cat_id>", methods=["DELETE"])
@require_auth
def delete_category(cat_id: int):
    """Delete a custom category (not system categories)."""
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM expense_categories WHERE id = %s AND user_id = %s",
                (cat_id, g.user_id)
            )
            existing = cur.fetchone()
            if not existing:
                return api_error("NOT_FOUND", "Category not found.", 404)
            if existing.get("is_system"):
                return api_error("CANNOT_DELETE_SYSTEM",
                    "System categories cannot be deleted.", 400)

            cur.execute("DELETE FROM expense_categories WHERE id = %s", (cat_id,))
        conn.commit()

    return jsonify({"success": True, "message": "Category deleted."})


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _is_org_member(org_id: int, user_id: int) -> bool:
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM organizations WHERE id = %s AND owner_user_id = %s",
                    (org_id, user_id)
                )
                if cur.fetchone():
                    return True
                cur.execute(
                    "SELECT 1 FROM organization_members WHERE org_id = %s AND user_id = %s",
                    (org_id, user_id)
                )
                return cur.fetchone() is not None
    except Exception:
        return False


def _get_member_role(org_id: int, user_id: int) -> str:
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM organizations WHERE id = %s AND owner_user_id = %s",
                    (org_id, user_id)
                )
                if cur.fetchone():
                    return "owner"
                cur.execute(
                    "SELECT role FROM organization_members WHERE org_id = %s AND user_id = %s",
                    (org_id, user_id)
                )
                row = cur.fetchone()
                return row["role"] if row else None
    except Exception:
        return None
