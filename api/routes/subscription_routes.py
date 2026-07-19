"""
PhonePe Subscription Routes
Handles subscription plans, payment initiation, webhook callbacks, and status verification.
"""

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timedelta

import pymysql
from pymysql.err import OperationalError, InternalError
from flask import Blueprint, jsonify, request

# PhonePe Configuration
PHONEPE_ENV = os.getenv("PHONEPE_ENV", "production")  # production or sandbox
PHONEPE_MERCHANT_ID = os.getenv("PHONEPE_MERCHANT_ID", "YOUR_MERCHANT_ID")
PHONEPE_SALT_KEY = os.getenv("PHONEPE_SALT_KEY", "YOUR_SALT_KEY")
PHONEPE_SALT_INDEX = os.getenv("PHONEPE_SALT_INDEX", "1")

if PHONEPE_ENV == "production":
    PHONEPE_BASE_URL = "https://api.phonepe.com/apis/hermes"
else:
    PHONEPE_BASE_URL = "https://api-preprod.phonepe.com/apis/pg-sandbox"

sub_bp = Blueprint("subscriptions", __name__, url_prefix="/api/subscriptions")

# Database config
DB_CONFIG = {
    "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("OCR_DB_PORT", "3306")),
    "user": os.getenv("OCR_DB_USER", "root"),
    "password": os.getenv("OCR_DB_PASSWORD", ""),
    "database": os.getenv("OCR_DB_NAME", "ocr_v1_00"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}


def get_db_connection():
    return pymysql.connect(**DB_CONFIG)


def api_error(code: str, message: str, status_code: int = 400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status_code


def api_success(data, status_code: int = 200):
    return jsonify({"success": True, "data": data}), status_code


# Default hardcoded plans used when subscription_plans table is unavailable
DEFAULT_PLANS = [
    {"id": 1, "name": "Free", "description": "Basic OCR scanning with limited features", "price": 0.00, "duration_days": 0, "features": '{"scans_per_month": 10, "export_formats": ["pdf"], "cloud_sync": false}', "is_active": True},
    {"id": 2, "name": "Premium", "description": "Unlimited OCR scanning with all features", "price": 99.00, "duration_days": 30, "features": '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel"], "cloud_sync": true, "priority_support": true, "api_access": false}', "is_active": True},
    {"id": 3, "name": "Professional", "description": "For power users with API access", "price": 299.00, "duration_days": 30, "features": '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel", "json"], "cloud_sync": true, "priority_support": true, "api_access": true}', "is_active": True},
]


def get_default_plans():
    """Return default plans with parsed features."""
    plans = []
    for plan in DEFAULT_PLANS:
        p = dict(plan)
        try:
            p["features"] = json.loads(p["features"])
        except Exception:
            p["features"] = {}
        plans.append(p)
    return plans


# ============== SUBSCRIPTION PLANS ==============

@sub_bp.route("/plans", methods=["GET"])
def get_plans():
    """Get all active subscription plans"""
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, name, description, price, duration_days, features, is_active
                FROM subscription_plans
                WHERE is_active = 1
                ORDER BY price ASC
            """)
            plans = cursor.fetchall()
        conn.close()

        # Parse JSON fields
        for plan in plans:
            if plan.get("features"):
                plan["features"] = json.loads(plan["features"])

        return api_success(plans)
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:  # ER_NO_SUCH_TABLE
            return api_success(get_default_plans())
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


@sub_bp.route("/plans/<int:plan_id>", methods=["GET"])
def get_plan(plan_id):
    """Get a specific subscription plan"""
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, name, description, price, duration_days, features, is_active
                FROM subscription_plans
                WHERE id = %s AND is_active = 1
            """, (plan_id,))
            plan = cursor.fetchone()
        conn.close()

        if not plan:
            return api_error("NOT_FOUND", "Plan not found", 404)

        if plan.get("features"):
            plan["features"] = json.loads(plan["features"])

        return api_success(plan)
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:  # ER_NO_SUCH_TABLE
            # Check default plans
            for p in DEFAULT_PLANS:
                if p["id"] == plan_id:
                    plan = dict(p)
                    try:
                        plan["features"] = json.loads(plan["features"])
                    except Exception:
                        plan["features"] = {}
                    return api_success(plan)
            return api_error("NOT_FOUND", "Plan not found", 404)
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== USER SUBSCRIPTIONS ==============

@sub_bp.route("/status", methods=["GET"])
def get_subscription_status():
    """Get current user's subscription status"""
    try:
        user_id = request.headers.get("X-User-Id")
        if not user_id:
            return api_error("UNAUTHORIZED", "User ID required", 401)

        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT s.id, s.status, s.start_date, s.end_date, s.plan_id,
                       p.name as plan_name, p.features
                FROM user_subscriptions s
                JOIN subscription_plans p ON s.plan_id = p.id
                WHERE s.user_id = %s AND s.status = 'active'
                AND s.end_date > NOW()
                ORDER BY s.end_date DESC
                LIMIT 1
            """, (user_id,))
            subscription = cursor.fetchone()
        conn.close()

        if subscription and subscription.get("features"):
            subscription["features"] = json.loads(subscription["features"])

        return api_success({
            "has_active_subscription": subscription is not None,
            "subscription": subscription
        })
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:  # ER_NO_SUCH_TABLE
            return api_success({"has_active_subscription": False, "subscription": None})
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


@sub_bp.route("/my", methods=["GET"])
def get_my_subscriptions():
    """Get all subscriptions for current user"""
    try:
        user_id = request.headers.get("X-User-Id")
        if not user_id:
            return api_error("UNAUTHORIZED", "User ID required", 401)

        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT s.id, s.status, s.start_date, s.end_date, s.plan_id,
                       s.payment_id, s.gateway, p.name as plan_name, p.price
                FROM user_subscriptions s
                JOIN subscription_plans p ON s.plan_id = p.id
                WHERE s.user_id = %s
                ORDER BY s.created_at DESC
            """, (user_id,))
            subscriptions = cursor.fetchall()
        conn.close()

        return api_success(subscriptions)
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:  # ER_NO_SUCH_TABLE
            return api_success([])
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== PAYMENT INITIATION ==============

@sub_bp.route("/create-order", methods=["POST"])
def create_subscription_order():
    """Initiate PhonePe payment for subscription"""
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        plan_id = data.get("plan_id")

        if not user_id or not plan_id:
            return api_error("INVALID_REQUEST", "user_id and plan_id required")

        # Get plan details
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, name, price, duration_days
                FROM subscription_plans
                WHERE id = %s AND is_active = 1
            """, (plan_id,))
            plan = cursor.fetchone()
        conn.close()

        if not plan:
            return api_error("NOT_FOUND", "Plan not found", 404)

        # Generate order ID
        order_id = f"SUB_{user_id}_{plan_id}_{int(time.time())}"

        # Prepare PhonePe payload
        payload = {
            "merchantId": PHONEPE_MERCHANT_ID,
            "merchantTransactionId": order_id,
            "merchantUserId": f"MU{user_id}",
            "amount": int(plan["price"] * 100),  # Convert to paisa
            "redirectUrl": data.get("redirect_url", "https://yourapp.com/subscription/callback"),
            "redirectMode": "POST",
            "callbackUrl": f"{request.host_url}api/subscriptions/webhook/phonepe",
            "mobileNumber": data.get("mobile", ""),
            "paymentInstrument": {
                "type": "PAY_PAGE"
            }
        }

        # Create payment order in database
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO subscription_orders
                (order_id, user_id, plan_id, amount, status, gateway, created_at)
                VALUES (%s, %s, %s, %s, 'pending', 'phonepe', NOW())
            """, (order_id, user_id, plan_id, plan["price"]))
            conn.commit()
        conn.close()

        # Create X-VERIFY header
        payload_str = json.dumps(payload, separators=(",", ":"))
        base64_payload = __import__("base64").b64encode(payload_str.encode()).decode()

        verify_string = f"{base64_payload}/pg/v1/pay{PHONEPE_SALT_KEY}"
        x_verify = hashlib.sha256(verify_string.encode()).hexdigest() + f":{PHONEPE_SALT_INDEX}"

        # Call PhonePe API
        import requests
        headers = {
            "Content-Type": "application/json",
            "X-Verify": x_verify,
            "X-Merchant-Id": PHONEPE_MERCHANT_ID
        }

        response = requests.post(
            f"{PHONEPE_BASE_URL}/v1/pay",
            headers=headers,
            json={"request": base64_payload}
        )

        response_data = response.json()

        if response_data.get("success"):
            return api_success({
                "order_id": order_id,
                "payment_url": response_data.get("data", {}).get("instrumentResponse", {}).get("redirectInfo", {}).get("url"),
                "merchant_transaction_id": order_id
            })
        else:
            return api_error("PAYMENT_FAILED", response_data.get("message", "Payment initiation failed"), 400)

    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:
            return api_error("SERVICE_UNAVAILABLE", "Subscription service is temporarily unavailable", 503)
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== WEBHOOK HANDLERS ==============

@sub_bp.route("/webhook/phonepe", methods=["POST"])
def phonepe_webhook():
    """Handle PhonePe payment webhook/callback"""
    try:
        data = request.get_json()

        # Verify signature
        x_verify = request.headers.get("X-Verify", "")
        response_data = data.get("response", "{}")
        decoded_response = json.loads(__import__("base64").b64decode(response_data).decode())

        # Verify the payment
        verify_string = f"{response_data}{PHONEPE_SALT_KEY}"
        expected_verify = hashlib.sha256(verify_string.encode()).hexdigest()

        if not x_verify.startswith(expected_verify):
            return api_error("INVALID_SIGNATURE", "Webhook verification failed", 400)

        merchant_transaction_id = decoded_response.get("merchantTransactionId")
        transaction_state = decoded_response.get("state")
        code = decoded_response.get("code")

        # Update order status
        conn = get_db_connection()
        with conn.cursor() as cursor:
            if transaction_state == "COMPLETED" and code == "PAYMENT_SUCCESS":
                # Payment successful - create subscription
                cursor.execute("""
                    SELECT user_id, plan_id, amount
                    FROM subscription_orders
                    WHERE order_id = %s AND status = 'pending'
                """, (merchant_transaction_id,))
                order = cursor.fetchone()

                if order:
                    # Get plan duration
                    cursor.execute("SELECT duration_days FROM subscription_plans WHERE id = %s", (order["plan_id"],))
                    plan = cursor.fetchone()

                    if plan:
                        start_date = datetime.now()
                        end_date = start_date + timedelta(days=plan["duration_days"])

                        # Create subscription
                        cursor.execute("""
                            INSERT INTO user_subscriptions
                            (user_id, plan_id, status, start_date, end_date,
                             payment_id, gateway, created_at)
                            VALUES (%s, %s, 'active', %s, %s, %s, 'phonepe', NOW())
                        """, (
                            order["user_id"], order["plan_id"],
                            start_date, end_date,
                            merchant_transaction_id
                        ))

                        # Update order status
                        cursor.execute("""
                            UPDATE subscription_orders
                            SET status = 'completed', completed_at = NOW()
                            WHERE order_id = %s
                        """, (merchant_transaction_id,))

                        conn.commit()

            elif transaction_state == "FAILED":
                cursor.execute("""
                    UPDATE subscription_orders
                    SET status = 'failed', failure_reason = %s, completed_at = NOW()
                    WHERE order_id = %s
                """, (decoded_response.get("errorMessage", "Payment failed"), merchant_transaction_id))
                conn.commit()

        conn.close()

        return jsonify({"success": True}), 200

    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:
            return jsonify({"success": False, "message": "Database unavailable"}), 200
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


@sub_bp.route("/check-payment/<order_id>", methods=["GET"])
def check_payment_status(order_id):
    """Check payment status for an order"""
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT status, plan_id, amount, failure_reason
                FROM subscription_orders
                WHERE order_id = %s
            """, (order_id,))
            order = cursor.fetchone()
        conn.close()

        if not order:
            return api_error("NOT_FOUND", "Order not found", 404)

        return api_success(order)
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:
            return api_error("NOT_FOUND", "Order not found", 404)
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== CANCEL SUBSCRIPTION ==============

@sub_bp.route("/cancel/<int:subscription_id>", methods=["POST"])
def cancel_subscription(subscription_id):
    """Cancel a user's subscription"""
    try:
        user_id = request.headers.get("X-User-Id")
        if not user_id:
            return api_error("UNAUTHORIZED", "User ID required", 401)

        conn = get_db_connection()
        with conn.cursor() as cursor:
            # Verify ownership
            cursor.execute("""
                SELECT id, status
                FROM user_subscriptions
                WHERE id = %s AND user_id = %s
            """, (subscription_id, user_id))
            subscription = cursor.fetchone()

            if not subscription:
                return api_error("NOT_FOUND", "Subscription not found", 404)

            if subscription["status"] != "active":
                return api_error("INVALID_STATE", "Subscription is not active", 400)

            # Cancel - mark as cancelled but keep access until end_date
            cursor.execute("""
                UPDATE user_subscriptions
                SET status = 'cancelled', cancelled_at = NOW()
                WHERE id = %s
            """, (subscription_id,))
            conn.commit()
        conn.close()

        return api_success({"message": "Subscription cancelled successfully"})
    except (OperationalError, InternalError) as e:
        if e.args[0] == 1146:
            return api_error("NOT_FOUND", "Subscription not found", 404)
        return api_error("SERVER_ERROR", str(e), 500)
    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== VERIFY SUBSCRIPTION (for API auth) ==============

def verify_user_subscription(user_id: int) -> dict:
    """Check if user has active subscription - returns dict with status"""
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT s.status, s.end_date, p.name as plan_name
                FROM user_subscriptions s
                JOIN subscription_plans p ON s.plan_id = p.id
                WHERE s.user_id = %s AND s.status IN ('active', 'cancelled')
                AND s.end_date > NOW()
                ORDER BY s.end_date DESC
                LIMIT 1
            """, (user_id,))
            result = cursor.fetchone()
        conn.close()

        if result and result["status"] == "active":
            return {"has_subscription": True, "plan": result["plan_name"], "expires": result["end_date"]}
        return {"has_subscription": False}
    except (OperationalError, InternalError):
        return {"has_subscription": False}
    except Exception:
        return {"has_subscription": False}
