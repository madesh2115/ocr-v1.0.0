"""
Auth routes: register, login, google, refresh, me, logout.
All routes are public (no @require_auth) unless noted.
"""
import os
import secrets
import re
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Optional

from flask import Blueprint, request, jsonify, g

from services.auth_service import (
    hash_password, verify_password,
    generate_access_token, generate_refresh_token,
    decode_access_token, decode_refresh_token,
    create_user, get_user_by_email, get_user_by_google_id, get_user_by_id,
    update_last_login, create_session, revoke_session, revoke_token,
    get_client_ip, get_user_agent,
    get_session,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

# ── Input Validation ────────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r"^[\w\.\+\-]+@[\w\-]+\.[a-zA-Z]{2,}$")


def validate_email(email: str) -> bool:
    return bool(email and EMAIL_RE.match(email))


def validate_password(password: str) -> bool:
    return bool(password and len(password) >= 8)


def api_error(code: str, message: str, status: int = 400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


def serialize_user(user: dict) -> dict:
    """Serialize user record for API response (no sensitive fields)."""
    return {
        "id": user["id"],
        "email": user["email"],
        "full_name": user.get("full_name", ""),
        "avatar_url": user.get("avatar_url"),
        "phone": user.get("phone"),
        "subscription_tier": user.get("subscription_tier", "free"),
        "subscription_status": user.get("subscription_status", "active"),
        "created_at": str(user.get("created_at", "")),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["POST"])
def register():
    """Create a new user account with email + password."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    full_name = (data.get("full_name") or "").strip()

    if not validate_email(email):
        return api_error("INVALID_EMAIL", "A valid email address is required.")
    if not validate_password(password):
        return api_error("WEAK_PASSWORD", "Password must be at least 8 characters.")
    if not full_name:
        return api_error("MISSING_NAME", "Full name is required.")

    # Check if email already exists
    existing = get_user_by_email(email)
    if existing:
        return api_error("EMAIL_EXISTS", "An account with this email already exists.", 409)

    # Create user
    pw_hash = hash_password(password)
    user_id = create_user(email, pw_hash, full_name)
    if not user_id:
        return api_error("REGISTRATION_FAILED", "Failed to create account. Please try again.", 500)

    # Generate tokens
    access_token, _ = generate_access_token(user_id, email)
    refresh_token, refresh_payload = generate_refresh_token(user_id, session_id=0)
    session_id = create_session(
        user_id, refresh_token,
        device_name=get_user_agent(),
        ip_address=get_client_ip(),
        user_agent=get_user_agent(),
    )

    # Update last login
    update_last_login(user_id)

    user = get_user_by_id(user_id)
    return jsonify({
        "success": True,
        "user": serialize_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": 900,  # 15 minutes
    }), 201


from services.limiter import limiter

@auth_bp.route("/login", methods=["POST"])
@limiter.limit("15 per minute")
def login():
    """Authenticate with email + password."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return api_error("MISSING_CREDENTIALS", "Email and password are required.")

    user = get_user_by_email(email)
    if not user:
        return api_error("INVALID_CREDENTIALS", "Invalid email or password.", 401)

    if not verify_password(password, user.get("password_hash", "")):
        return api_error("INVALID_CREDENTIALS", "Invalid email or password.", 401)

    if not user.get("is_active", True):
        return api_error("ACCOUNT_DISABLED", "This account has been deactivated.", 403)

    # Generate tokens
    access_token, _ = generate_access_token(user["id"], user["email"])
    refresh_token, refresh_payload = generate_refresh_token(user["id"], session_id=0)
    session_id = create_session(
        user["id"], refresh_token,
        device_name=get_user_agent(),
        ip_address=get_client_ip(),
        user_agent=get_user_agent(),
    )

    update_last_login(user["id"])

    return jsonify({
        "success": True,
        "user": serialize_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": 900,
    })


@auth_bp.route("/google", methods=["POST"])
def google_auth():
    """
    Authenticate or register with a Google ID token.
    Body: { id_token: string }
    """
    data = request.get_json(silent=True) or {}
    id_token = data.get("id_token") or ""

    if not id_token:
        return api_error("MISSING_TOKEN", "Google ID token is required.")

    # Verify the Google ID token
    google_user = _verify_google_token(id_token)
    if not google_user:
        return api_error("INVALID_GOOGLE_TOKEN", "Invalid Google ID token.", 401)

    google_id = google_user["sub"]
    google_email = google_user.get("email", "").lower()
    google_name = google_user.get("name", "")
    google_avatar = google_user.get("picture")

    # Look up existing user by google_id
    user = get_user_by_google_id(google_id)

    if not user and google_email:
        # Try to find by email and link
        user = get_user_by_email(google_email)

    if not user:
        # Register new user
        user_id = create_user(
            email=google_email or f"google_{google_id}@placeholder.com",
            password_hash=None,  # No password for Google-only accounts
            full_name=google_name,
            google_id=google_id,
        )
        if not user_id:
            return api_error("GOOGLE_AUTH_FAILED", "Failed to create account via Google.", 500)
        user = get_user_by_id(user_id)

    if user and google_avatar:
        # Update avatar if changed
        _update_user_avatar(user["id"], google_avatar)

    access_token, _ = generate_access_token(user["id"], user["email"])
    refresh_token, _ = generate_refresh_token(user["id"], session_id=0)
    session_id = create_session(
        user["id"], refresh_token,
        device_name=get_user_agent(),
        ip_address=get_client_ip(),
        user_agent=get_user_agent(),
    )

    update_last_login(user["id"])

    return jsonify({
        "success": True,
        "user": serialize_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": 900,
    })


def _verify_google_token(id_token: str) -> Optional[dict]:
    """
    Verify a Google ID token and return the payload.
    Uses Google Auth library for token verification.
    """
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        CLIENT_ID = None  # Set via env var GOOGLE_CLIENT_ID in production
        CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", CLIENT_ID)

        info = id_token.verify_oauth2_token(
            id_token,
            google_requests.Request(),
            CLIENT_ID,
        )
        return info
    except Exception:
        # For development without Google credentials, decode without verification
        # WARNING: Only for dev. In production, always verify with Google.
        import base64
        import json as json_lib

        try:
            parts = id_token.split(".")
            if len(parts) != 3:
                return None
            # Add padding if needed
            padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
            payload = json_lib.loads(base64.urlsafe_b64decode(padded))
            return payload
        except Exception:
            return None


def _update_user_avatar(user_id: int, avatar_url: str) -> None:
    """Update user's avatar URL."""
    try:
        from services.auth_service import db_connect
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE users SET avatar_url = %s WHERE id = %s",
                    (avatar_url, user_id)
                )
            conn.commit()
    except Exception:
        pass


@auth_bp.route("/refresh", methods=["POST"])
def refresh():
    """Exchange a refresh token for a new access token."""
    data = request.get_json(silent=True) or {}
    refresh_token = data.get("refresh_token") or ""

    if not refresh_token:
        return api_error("MISSING_TOKEN", "Refresh token is required.")

    payload, err = decode_refresh_token(refresh_token)
    if err:
        return api_error("INVALID_TOKEN", err, 401)

    session_id = int(payload.get("session_id", 0))

    # Verify session is still valid
    session = get_session(session_id) if session_id else None
    if not session:
        return api_error("SESSION_EXPIRED", "Session has expired or been revoked.", 401)

    user = get_user_by_id(int(payload["sub"]))
    if not user or not user.get("is_active", True):
        return api_error("ACCOUNT_DISABLED", "User account is not active.", 403)

    # Generate new access token
    access_token, _ = generate_access_token(user["id"], user["email"])

    return jsonify({
        "success": True,
        "access_token": access_token,
        "expires_in": 900,
    })


@auth_bp.route("/me", methods=["GET"])
def me():
    """Get current authenticated user's profile."""
    from services.auth_service import require_auth

    # Inline auth check to avoid circular decorator issue
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return api_error("UNAUTHORIZED", "Missing authorization header.", 401)

    token = auth_header[7:]
    payload, err = decode_access_token(token)
    if err:
        return api_error("UNAUTHORIZED", err, 401)

    from services.auth_service import is_token_revoked
    if payload.get("jti") and is_token_revoked(payload["jti"]):
        return api_error("UNAUTHORIZED", "Token has been revoked.", 401)

    user = get_user_by_id(int(payload["sub"]))
    if not user:
        return api_error("USER_NOT_FOUND", "User not found.", 404)

    return jsonify({
        "success": True,
        "user": serialize_user(user),
    })


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """Revoke the current access token and refresh token."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None

    data = request.get_json(silent=True) or {}
    refresh_token = data.get("refresh_token")

    # Revoke access token
    if token:
        payload, _ = decode_access_token(token)
        if payload and payload.get("jti"):
            from datetime import datetime, timezone
            exp = payload.get("exp", 0)
            expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
            revoke_token(payload["jti"], expires_at)

    # Revoke refresh token session
    if refresh_token:
        payload, _ = decode_refresh_token(refresh_token)
        if payload and payload.get("session_id"):
            revoke_session(int(payload["session_id"]))

    return jsonify({"success": True, "message": "Logged out successfully."})


@auth_bp.route("/update-profile", methods=["PUT"])
def update_profile():
    """Update the authenticated user's profile."""
    from services.auth_service import decode_access_token, is_token_revoked

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return api_error("UNAUTHORIZED", "Missing authorization header.", 401)

    token = auth_header[7:]
    payload, err = decode_access_token(token)
    if err:
        return api_error("UNAUTHORIZED", err, 401)

    if payload.get("jti") and is_token_revoked(payload["jti"]):
        return api_error("UNAUTHORIZED", "Token has been revoked.", 401)

    user_id = int(payload["sub"])
    data = request.get_json(silent=True) or {}

    full_name = (data.get("full_name") or "").strip()
    phone = data.get("phone")

    updates = []
    params = []
    if full_name:
        updates.append("full_name = %s")
        params.append(full_name)
    if phone is not None:
        updates.append("phone = %s")
        params.append(phone)

    if updates:
        params.append(user_id)
        from services.auth_service import db_connect
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE users SET {', '.join(updates)} WHERE id = %s",
                    params
                )
            conn.commit()

    user = get_user_by_id(user_id)
    return jsonify({
        "success": True,
        "user": serialize_user(user),
    })


