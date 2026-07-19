"""
JWT Authentication Service for Flask API.
Handles token generation, validation, refresh, and bcrypt password hashing.
"""
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable, Dict, Optional, Tuple

import bcrypt
import jwt
from flask import g, request

# ── Configuration ────────────────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", secrets.token_hex(32)))
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ── Database Helpers ──────────────────────────────────────────────────────────────

def db_connect():
    """Create a database connection using app.py's configuration."""
    import pymysql
    from app import DB_CONFIG, DB_NAME
    config = DB_CONFIG.copy()
    config["database"] = DB_NAME
    return pymysql.connect(**config)


# ── Password Hashing ────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its bcrypt hash."""
    if not password_hash:
        return False
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ── Token Generation ────────────────────────────────────────────────────────────

def generate_access_token(user_id: int, email: str) -> Tuple[str, Dict[str, Any]]:
    """Generate a short-lived JWT access token. Returns (token, payload)."""
    now = datetime.now(timezone.utc)
    jti = secrets.token_hex(8)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
        "jti": jti,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, payload


def generate_refresh_token(user_id: int, session_id: int) -> Tuple[str, Dict[str, Any]]:
    """Generate a long-lived JWT refresh token. Returns (token, payload)."""
    now = datetime.now(timezone.utc)
    jti = secrets.token_hex(16)
    payload = {
        "sub": str(user_id),
        "session_id": str(session_id),
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).timestamp()),
        "jti": jti,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, payload


def decode_token(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Decode and validate a JWT token.
    Returns (payload, None) on success or (None, error_message) on failure.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, "Token has expired"
    except jwt.InvalidTokenError as e:
        return None, f"Invalid token: {e}"


def decode_access_token(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Decode and validate an access token.
    Returns (payload, None) on success or (None, error_message) on failure.
    """
    payload, err = decode_token(token)
    if err:
        return None, err
    if payload.get("type") != "access":
        return None, "Invalid token type"
    return payload, None


def decode_refresh_token(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Decode and validate a refresh token.
    Returns (payload, None) on success or (None, error_message) on failure.
    """
    payload, err = decode_token(token)
    if err:
        return None, err
    if payload.get("type") != "refresh":
        return None, "Invalid token type"
    return payload, None


def is_token_revoked(jti: str) -> bool:
    """Check if a token JTI is in the revocation list."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM revoked_tokens WHERE token_jti = %s LIMIT 1",
                    (jti,)
                )
                return cur.fetchone() is not None
    except Exception:
        return False


def revoke_token(jti: str, expires_at: datetime) -> None:
    """Add a token JTI to the revocation list."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO revoked_tokens (token_jti, expires_at) VALUES (%s, %s)",
                    (jti, expires_at)
                )
            conn.commit()
    except Exception:
        pass


def cleanup_expired_tokens() -> int:
    """Remove expired tokens from revoked_tokens table. Returns count deleted."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM revoked_tokens WHERE expires_at < NOW()")
                deleted = cur.rowcount
            conn.commit()
            return deleted
    except Exception:
        return 0


# ── Session Management ──────────────────────────────────────────────────────────

def create_session(
    user_id: int,
    refresh_token: str,
    device_name: Optional[str] = None,
    device_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> int:
    """Create a new user session. Returns session_id."""
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_sessions
                (user_id, refresh_token, device_name, device_id, ip_address, user_agent, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (user_id, refresh_token, device_name, device_id, ip_address, user_agent, expires_at)
            )
            session_id = int(cur.lastrowid)
        conn.commit()
        return session_id


def revoke_session(session_id: int) -> bool:
    """Revoke a user session by setting revoked_at."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE user_sessions SET revoked_at = NOW() WHERE id = %s AND revoked_at IS NULL",
                    (session_id,)
                )
                affected = cur.rowcount
            conn.commit()
            return affected > 0
    except Exception:
        return False


def get_session(session_id: int) -> Optional[Dict[str, Any]]:
    """Get session details if valid (not revoked, not expired)."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, user_id, refresh_token, device_name, expires_at, revoked_at
                    FROM user_sessions
                    WHERE id = %s AND revoked_at IS NULL AND expires_at > NOW()
                    """,
                    (session_id,)
                )
                row = cur.fetchone()
                return dict(row) if row else None
    except Exception:
        return None


# ── User Helpers ────────────────────────────────────────────────────────────────

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get user by email address."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE email = %s AND is_active = 1", (email,))
                row = cur.fetchone()
                return dict(row) if row else None
    except Exception:
        return None


def get_user_by_google_id(google_id: str) -> Optional[Dict[str, Any]]:
    """Get user by Google ID."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE google_id = %s AND is_active = 1", (google_id,))
                row = cur.fetchone()
                return dict(row) if row else None
    except Exception:
        return None


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Get user by ID."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE id = %s AND is_active = 1", (user_id,))
                row = cur.fetchone()
                return dict(row) if row else None
    except Exception:
        return None


def create_user(
    email: str,
    password_hash: Optional[str],
    full_name: str,
    google_id: Optional[str] = None,
) -> Optional[int]:
    """Create a new user. Returns user_id or None on failure."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (email, password_hash, full_name, google_id)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (email, password_hash, full_name, google_id)
                )
                user_id = int(cur.lastrowid)
            conn.commit()
            return user_id
    except Exception:
        return None


def update_last_login(user_id: int) -> None:
    """Update the last_login_at timestamp."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE users SET last_login_at = NOW() WHERE id = %s",
                    (user_id,)
                )
            conn.commit()
    except Exception:
        pass


# ── Flask Decorator for Protected Routes ────────────────────────────────────────

def require_auth(f: Callable) -> Callable:
    """
    Decorator to protect Flask routes with JWT authentication.

    Usage:
        @app.post("/documents")
        @require_auth
        def create_document():
            user_id = g.user_id   # Access authenticated user ID
            ...

    Sets g.user_id, g.user_email on success.
    Returns 401 on auth failure.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return {"success": False, "error": {"code": "UNAUTHORIZED", "message": "Missing or invalid Authorization header"}}, 401

        token = auth_header[7:]
        payload, err = decode_access_token(token)
        if err:
            return {"success": False, "error": {"code": "UNAUTHORIZED", "message": err}}, 401

        # Check revocation
        jti = payload.get("jti")
        if jti and is_token_revoked(jti):
            return {"success": False, "error": {"code": "UNAUTHORIZED", "message": "Token has been revoked"}}, 401

        # Attach user info to Flask's g object
        g.user_id = int(payload["sub"])
        g.user_email = payload.get("email")
        g.token_jti = jti
        g.access_token_exp = payload.get("exp")

        return f(*args, **kwargs)
    return decorated


def get_client_ip() -> str:
    """Get client IP address from request, handling proxies."""
    x_forwarded_for = request.headers.get("X-Forwarded-For", "")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.remote_addr or "unknown"


def get_user_agent() -> str:
    """Get User-Agent header."""
    return request.headers.get("User-Agent", "unknown")[:500]
