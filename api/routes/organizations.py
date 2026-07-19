"""
Organization (Team) management routes.
"""
import secrets
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from flask import Blueprint, request, jsonify, g

from services.auth_service import (
    require_auth, db_connect,
    get_user_by_id,
    get_client_ip, get_user_agent,
)

org_bp = Blueprint("organizations", __name__, url_prefix="/organizations")


def api_error(code: str, message: str, status: int = 400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


def slugify(name: str) -> str:
    """Generate a URL-safe slug from a name."""
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{slug[:80]}-{secrets.token_hex(3)}"


def serialize_org(org: dict) -> dict:
    return {
        "id": org["id"],
        "name": org["name"],
        "slug": org["slug"],
        "owner_user_id": org["owner_user_id"],
        "logo_url": org.get("logo_url"),
        "subscription_tier": org.get("subscription_tier", "free"),
        "subscription_status": org.get("subscription_status", "active"),
        "created_at": str(org.get("created_at", "")),
    }


def serialize_member(row: dict) -> dict:
    return {
        "user_id": row["user_id"],
        "role": row["role"],
        "joined_at": str(row.get("joined_at", "")),
        "full_name": row.get("full_name", ""),
        "email": row.get("email", ""),
        "avatar_url": row.get("avatar_url"),
    }


def parse_org_id(org_id_str: str) -> Optional[int]:
    """Parse org_id from URL path, returning None for invalid values like 'undefined'."""
    if org_id_str in ("undefined", "null", "none", ""):
        return None
    try:
        val = int(org_id_str)
        if val <= 0:
            return None
        return val
    except (ValueError, TypeError):
        return None


def require_valid_org_id(org_id_str: str):
    """Decorator helper to validate org_id before route handler runs."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    return org_id


@org_bp.route("", methods=["GET"])
@require_auth
def list_organizations():
    """List all organizations the user belongs to (as owner or member)."""
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT o.*
                FROM organizations o
                LEFT JOIN organization_members om ON om.org_id = o.id
                WHERE o.owner_user_id = %s OR om.user_id = %s
                ORDER BY o.created_at DESC
                """,
                (g.user_id, g.user_id)
            )
            orgs = [serialize_org(dict(row)) for row in cur.fetchall()]
    return jsonify({"success": True, "organizations": orgs})


@org_bp.route("/current", methods=["GET"])
@require_auth
def get_current_organization():
    """Get the user's first/primary organization."""
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.*
                FROM organizations o
                LEFT JOIN organization_members om ON om.org_id = o.id
                WHERE o.owner_user_id = %s OR om.user_id = %s
                ORDER BY o.created_at ASC
                LIMIT 1
                """,
                (g.user_id, g.user_id)
            )
            row = cur.fetchone()
            if not row:
                return api_error("NOT_FOUND", "No organization found. Create one first.", 404)
            org = serialize_org(dict(row))
            org["is_owner"] = row["owner_user_id"] == g.user_id
    return jsonify({"success": True, "organization": org})


@org_bp.route("", methods=["POST"])
@require_auth
def create_organization():
    """Create a new organization and add creator as owner."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return api_error("MISSING_NAME", "Organization name is required.", 400)
    if len(name) < 2:
        return api_error("NAME_TOO_SHORT", "Organization name must be at least 2 characters.", 400)

    slug = slugify(name)

    with db_connect() as conn:
        with conn.cursor() as cur:
            # Create org
            cur.execute(
                """
                INSERT INTO organizations (name, slug, owner_user_id)
                VALUES (%s, %s, %s)
                """,
                (name, slug, g.user_id)
            )
            org_id = int(cur.lastrowid)

            # Add owner as member with 'owner' role
            cur.execute(
                """
                INSERT INTO organization_members (org_id, user_id, role)
                VALUES (%s, %s, 'owner')
                """,
                (org_id, g.user_id)
            )
        conn.commit()

        # Fetch created org
        cur.execute("SELECT * FROM organizations WHERE id = %s", (org_id,))
        org = dict(cur.fetchone())

    return jsonify({"success": True, "organization": serialize_org(org)}), 201


@org_bp.route("/<org_id>", methods=["GET"])
@require_auth
def get_organization(org_id_str: str):
    """Get organization details (must be a member)."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    if not _is_org_member(org_id, g.user_id):
        return api_error("FORBIDDEN", "You are not a member of this organization.", 403)

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM organizations WHERE id = %s", (org_id,))
            row = cur.fetchone()
            if not row:
                return api_error("NOT_FOUND", "Organization not found.", 404)
            org = serialize_org(dict(row))
            org["is_owner"] = row["owner_user_id"] == g.user_id
    return jsonify({"success": True, "organization": org})


@org_bp.route("/<org_id>/members", methods=["GET"])
@require_auth
def list_members(org_id_str: str):
    """List all members of an organization."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    if not _is_org_member(org_id, g.user_id):
        return api_error("FORBIDDEN", "You are not a member of this organization.", 403)

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.id AS user_id, u.full_name, u.email, u.avatar_url,
                       om.role, om.joined_at
                FROM organization_members om
                JOIN users u ON u.id = om.user_id
                WHERE om.org_id = %s
                ORDER BY om.role = 'owner' DESC, om.joined_at ASC
                """,
                (org_id,)
            )
            members = [serialize_member(dict(row)) for row in cur.fetchall()]
    return jsonify({"success": True, "members": members})


@org_bp.route("/<org_id>/invite", methods=["POST"])
@require_auth
def invite_member(org_id_str: str):
    """Invite someone to the organization by email."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    if not _is_org_member(org_id, g.user_id):
        return api_error("FORBIDDEN", "You are not a member of this organization.", 403)

    # Check role: only owner or admin can invite
    role = _get_member_role(org_id, g.user_id)
    if role not in ("owner", "admin"):
        return api_error("FORBIDDEN", "Only owners and admins can invite members.", 403)

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    role_to_assign = data.get("role", "member")

    if not email:
        return api_error("MISSING_EMAIL", "Email address is required.")
    if role_to_assign not in ("admin", "member", "viewer"):
        return api_error("INVALID_ROLE", "Role must be admin, member, or viewer.")

    invite_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    with db_connect() as conn:
        with conn.cursor() as cur:
            # Check if user already a member
            cur.execute(
                """
                SELECT 1 FROM organization_members om
                JOIN users u ON u.id = om.user_id
                WHERE om.org_id = %s AND u.email = %s
                """,
                (org_id, email)
            )
            if cur.fetchone():
                return api_error("ALREADY_MEMBER", "This user is already a member of the organization.", 409)

            # Create invite
            cur.execute(
                """
                INSERT INTO organization_invites
                (org_id, email, role, invite_token, invited_by_user_id, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (org_id, email, role_to_assign, invite_token, g.user_id, expires_at)
            )
            invite_id = int(cur.lastrowid)
        conn.commit()

    invite_link = f"expenses://join?token={invite_token}"
    return jsonify({
        "success": True,
        "invite": {
            "id": invite_id,
            "email": email,
            "role": role_to_assign,
            "expires_at": expires_at.isoformat(),
            "invite_link": invite_link,
        }
    }), 201


@org_bp.route("/join", methods=["POST"])
def join_organization():
    """Accept an organization invite using a token."""
    data = request.get_json(silent=True) or {}
    invite_token = data.get("invite_token") or ""

    if not invite_token:
        return api_error("MISSING_TOKEN", "Invite token is required.")

    with db_connect() as conn:
        with conn.cursor() as cur:
            # Find valid invite
            cur.execute(
                """
                SELECT * FROM organization_invites
                WHERE invite_token = %s AND accepted_at IS NULL AND expires_at > NOW()
                """,
                (invite_token,)
            )
            invite = cur.fetchone()
            if not invite:
                return api_error("INVALID_TOKEN", "Invalid or expired invite link.", 404)

            invite = dict(invite)

            # Get user by email
            cur.execute("SELECT * FROM users WHERE email = %s AND is_active = 1", (invite["email"],))
            user = cur.fetchone()
            if not user:
                return api_error("ACCOUNT_NOT_FOUND",
                    "No account found for this invite email. Please register first.", 404)

            user_id = user["id"]

            # Check if already a member
            cur.execute(
                "SELECT 1 FROM organization_members WHERE org_id = %s AND user_id = %s",
                (invite["org_id"], user_id)
            )
            if cur.fetchone():
                return api_error("ALREADY_MEMBER", "You are already a member of this organization.", 409)

            # Add as member
            cur.execute(
                """
                INSERT INTO organization_members (org_id, user_id, role, invited_by_user_id)
                VALUES (%s, %s, %s, %s)
                """,
                (invite["org_id"], user_id, invite["role"], invite["invited_by_user_id"])
            )

            # Mark invite as accepted
            cur.execute(
                "UPDATE organization_invites SET accepted_at = NOW() WHERE id = %s",
                (invite["id"],)
            )

            # Get org details
            cur.execute("SELECT * FROM organizations WHERE id = %s", (invite["org_id"],))
            org = dict(cur.fetchone())

        conn.commit()

    return jsonify({
        "success": True,
        "message": "You have joined the organization.",
        "organization": serialize_org(org),
    })


@org_bp.route("/<org_id>/members/<target_user_id>", methods=["DELETE"])
@require_auth
def remove_member(org_id_str: str, target_user_id_str: str):
    """Remove a member from the organization."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    try:
        target_user_id = int(target_user_id_str)
        if target_user_id <= 0:
            raise ValueError()
    except (ValueError, TypeError):
        return api_error("INVALID_USER_ID", "Invalid user ID", 400)
    if not _is_org_member(org_id, g.user_id):
        return api_error("FORBIDDEN", "You are not a member of this organization.", 403)

    role = _get_member_role(org_id, g.user_id)
    target_role = _get_member_role(org_id, target_user_id)

    # Can't remove yourself if you're the owner
    if target_user_id == g.user_id and role == "owner":
        return api_error("CANNOT_REMOVE_SELF", "Owners cannot remove themselves.", 400)

    # Only owner can remove other owners; admins can remove members/viewers
    if target_role == "owner":
        return api_error("FORBIDDEN", "Only the owner can remove other owners.", 403)
    if role == "admin" and target_role not in ("member", "viewer"):
        return api_error("FORBIDDEN", "Admins can only remove members and viewers.", 403)
    if role == "member":
        return api_error("FORBIDDEN", "Members cannot remove other members.", 403)

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM organization_members WHERE org_id = %s AND user_id = %s",
                (org_id, target_user_id)
            )
        conn.commit()

    return jsonify({"success": True, "message": "Member removed."})


@org_bp.route("/<org_id>/members/<target_user_id>/role", methods=["PUT"])
@require_auth
def change_member_role(org_id_str: str, target_user_id_str: str):
    """Change a member's role (owner/admin only)."""
    org_id = parse_org_id(org_id_str)
    if org_id is None:
        return api_error("INVALID_ORG_ID", "Invalid organization ID", 400)
    try:
        target_user_id = int(target_user_id_str)
        if target_user_id <= 0:
            raise ValueError()
    except (ValueError, TypeError):
        return api_error("INVALID_USER_ID", "Invalid user ID", 400)
    if not _is_org_member(org_id, g.user_id):
        return api_error("FORBIDDEN", "Not a member.", 403)

    role = _get_member_role(org_id, g.user_id)
    if role not in ("owner", "admin"):
        return api_error("FORBIDDEN", "Only owners and admins can change roles.", 403)

    data = request.get_json(silent=True) or {}
    new_role = data.get("role")
    if new_role not in ("admin", "member", "viewer"):
        return api_error("INVALID_ROLE", "Role must be admin, member, or viewer.")

    target_role = _get_member_role(org_id, target_user_id)
    if target_role == "owner":
        return api_error("FORBIDDEN", "Cannot change the role of the owner.", 403)

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE organization_members SET role = %s WHERE org_id = %s AND user_id = %s",
                (new_role, org_id, target_user_id)
            )
        conn.commit()

    return jsonify({"success": True, "message": f"Role changed to {new_role}."})


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _is_org_member(org_id: int, user_id: int) -> bool:
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1 FROM organizations WHERE id = %s AND owner_user_id = %s
                    """,
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


def _get_member_role(org_id: int, user_id: int) -> Optional[str]:
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                # Owner has owner role even if not in members table
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
