"""
Cashfree Subscription Routes
Handles subscription plans, payment initiation, webhook callbacks, and status verification.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timedelta

import pymysql
import requests
from flask import Blueprint, jsonify, request

# Cashfree Configuration
CASHFREE_ENV = os.getenv("CASHFREE_ENV", "production")  # production or sandbox
CASHFREE_CLIENT_ID = os.getenv("CASHFREE_CLIENT_ID", "YOUR_CLIENT_ID")
CASHFREE_CLIENT_SECRET = os.getenv("CASHFREE_CLIENT_SECRET", "YOUR_CLIENT_SECRET")

if CASHFREE_ENV == "production":
    CASHFREE_BASE_URL = "https://sdk.cashfree.com/js/v3/cashfree.js"
    CASHFREE_API_URL = "https://api.cashfree.com/api/v2"
else:
    CASHFREE_BASE_URL = "https://sdk.cashfree.com/js/v3/cashfree.js"
    CASHFREE_API_URL = "https://api.cashfree.com/api/v2"

sub_bp = Blueprint("cashfree_subscriptions", __name__, url_prefix="/api/subscriptions/cashfree")

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


def get_cashfree_token():
    """Get Cashfree API token"""
    try:
        response = requests.post(
            f"{CASHFREE_API_URL}/oauth/token",
            headers={"Content-Type": "application/json"},
            json={
                "client_id": CASHFREE_CLIENT_ID,
                "client_secret": CASHFREE_CLIENT_SECRET,
                "grant_type": "client_credentials"
            }
        )
        if response.ok:
            return response.json().get("access_token")
    except:
        pass
    return None


# ============== CREATE ORDER ==============

@sub_bp.route("/create-order", methods=["POST"])
def create_order():
    """Create a Cashfree order for subscription"""
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        plan_id = data.get("plan_id")
        customer_email = data.get("email")
        customer_phone = data.get("phone")

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

        if plan["price"] == 0:
            # Free plan
            return api_success({
                "order_id": None,
                "payment_url": None,
                "is_free": True
            })

        # Generate order ID
        order_id = f"SUB_{user_id}_{plan_id}_{int(time.time())}"

        # Get Cashfree token
        cf_token = get_cashfree_token()

        if cf_token and CASHFREE_CLIENT_ID != "YOUR_CLIENT_ID":
            # Create Cashfree order
            response = requests.post(
                f"{CASHFREE_API_URL}/orders",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {cf_token}",
                    "x-client-id": CASHFREE_CLIENT_ID,
                    "x-client-secret": CASHFREE_CLIENT_SECRET
                },
                json={
                    "order_id": order_id,
                    "order_amount": plan["price"],
                    "order_currency": "INR",
                    "customer_details": {
                        "customer_id": f"cust_{user_id}",
                        "customer_email": customer_email or "customer@example.com",
                        "customer_phone": customer_phone or "9999999999"
                    },
                    "order_meta": {
                        "return_url": f"{request.host_url}api/subscriptions/cashfree/webhook"
                    }
                }
            )

            if response.ok:
                cf_response = response.json()
                cf_order_id = cf_response.get("cf_order", {}).get("order_id")
                payment_url = cf_response.get("cf_order", {}).get("payments")
            else:
                cf_order_id = f"cf_mock_{order_id}"
                payment_url = None
        else:
            # Mock for testing
            cf_order_id = f"cf_mock_{order_id}"
            payment_url = None

        # Save order to database
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO subscription_orders
                (order_id, user_id, plan_id, amount, status, gateway, payment_id, created_at)
                VALUES (%s, %s, %s, %s, 'pending', 'cashfree', %s, NOW())
            """, (order_id, user_id, plan_id, plan["price"], cf_order_id))
            conn.commit()
        conn.close()

        return api_success({
            "order_id": order_id,
            "cashfree_order_id": cf_order_id,
            "payment_url": payment_url,
            "cf_token": cf_token if cf_token and CASHFREE_CLIENT_ID != "YOUR_CLIENT_ID" else None,
            "client_id": CASHFREE_CLIENT_ID if CASHFREE_CLIENT_ID != "YOUR_CLIENT_ID" else None
        })

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== VERIFY PAYMENT ==============

@sub_bp.route("/verify-payment", methods=["POST"])
def verify_payment():
    """Verify Cashfree payment and activate subscription"""
    try:
        data = request.get_json()
        order_id = data.get("order_id")
        cf_order_id = data.get("cashfree_order_id")

        if not order_id:
            return api_error("INVALID_REQUEST", "order_id required")

        # Get Cashfree token and verify
        cf_token = get_cashfree_token()

        if cf_token and CASHFREE_CLIENT_ID != "YOUR_CLIENT_ID":
            response = requests.get(
                f"{CASHFREE_API_URL}/orders/{cf_order_id}",
                headers={
                    "Authorization": f"Bearer {cf_token}",
                    "x-client-id": CASHFREE_CLIENT_ID,
                    "x-client-secret": CASHFREE_CLIENT_SECRET
                }
            )

            if response.ok:
                order_status = response.json().get("order_status")
                if order_status != "PAID":
                    return api_error("PAYMENT_NOT_COMPLETE", "Payment not completed")
        else:
            # Mock verification for testing
            pass

        # Get order details
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT user_id, plan_id, status
                FROM subscription_orders
                WHERE order_id = %s
            """, (order_id,))
            order = cursor.fetchone()

            if not order:
                conn.close()
                return api_error("NOT_FOUND", "Order not found", 404)

            if order["status"] != "pending":
                conn.close()
                return api_error("ALREADY_PROCESSED", "Order already processed")

            # Get plan duration
            cursor.execute("SELECT duration_days FROM subscription_plans WHERE id = %s", (order["plan_id"],))
            plan = cursor.fetchone()

            if not plan:
                conn.close()
                return api_error("NOT_FOUND", "Plan not found", 404)

            start_date = datetime.now()
            end_date = start_date + timedelta(days=plan["duration_days"])

            # Create subscription
            cursor.execute("""
                INSERT INTO user_subscriptions
                (user_id, plan_id, status, start_date, end_date,
                 payment_id, gateway, created_at)
                VALUES (%s, %s, 'active', %s, %s, %s, 'cashfree', NOW())
            """, (
                order["user_id"], order["plan_id"],
                start_date, end_date,
                cf_order_id
            ))

            # Update order status
            cursor.execute("""
                UPDATE subscription_orders
                SET status = 'completed', completed_at = NOW()
                WHERE order_id = %s
            """, (order_id,))

            conn.commit()
            conn.close()

        return api_success({"message": "Subscription activated successfully"})

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== WEBHOOK ==============

@sub_bp.route("/webhook", methods=["POST"])
def cashfree_webhook():
    """Handle Cashfree webhook events"""
    try:
        # Verify webhook signature
        webhook_signature = request.headers.get("x-cashfree-signature")
        webhook_secret = os.getenv("CASHFREE_WEBHOOK_SECRET")

        if webhook_secret and webhook_signature:
            payload = json.dumps(request.json, separators=(",", ":"))
            expected_signature = hashlib.pbkdf2_hmac(
                "sha256",
                payload.encode(),
                webhook_secret.encode(),
                100000
            ).hexdigest()

            if webhook_signature != expected_signature:
                return api_error("INVALID_SIGNATURE", "Webhook verification failed", 400)

        event = request.json.get("type")
        data = request.json.get("data", {})
        order_id = data.get("order", {}).get("order_id")

        if event == "PAYMENT_SUCCESS":
            cf_payment_id = data.get("payment", {}).get("cf_payment_id")

            conn = get_db_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT user_id, plan_id, status
                    FROM subscription_orders
                    WHERE payment_id = %s AND status = 'pending'
                """, (data.get("order", {}).get("cf_order_id"),))
                order = cursor.fetchone()

                if order:
                    cursor.execute("SELECT duration_days FROM subscription_plans WHERE id = %s", (order["plan_id"],))
                    plan = cursor.fetchone()

                    if plan:
                        start_date = datetime.now()
                        end_date = start_date + timedelta(days=plan["duration_days"])

                        cursor.execute("""
                            INSERT INTO user_subscriptions
                            (user_id, plan_id, status, start_date, end_date,
                             payment_id, gateway, created_at)
                            VALUES (%s, %s, 'active', %s, %s, %s, 'cashfree', NOW())
                        """, (
                            order["user_id"], order["plan_id"],
                            start_date, end_date,
                            cf_payment_id
                        ))

                        cursor.execute("""
                            UPDATE subscription_orders
                            SET status = 'completed', completed_at = NOW()
                            WHERE payment_id = %s
                        """, (data.get("order", {}).get("cf_order_id"),))

                        conn.commit()
            conn.close()

        elif event == "PAYMENT_FAILED":
            conn = get_db_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE subscription_orders
                    SET status = 'failed',
                        failure_reason = %s,
                        completed_at = NOW()
                    WHERE payment_id = %s
                """, (
                    data.get("bank_transfer", {}).get("reason", "Payment failed"),
                    data.get("order", {}).get("cf_order_id")
                ))
                conn.commit()
            conn.close()

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)
