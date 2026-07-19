"""
Razorpay Subscription Routes
Handles subscription plans, payment initiation, webhook callbacks, and status verification.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timedelta

import pymysql
import razorpay
from flask import Blueprint, jsonify, request

# Razorpay Configuration
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "YOUR_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "YOUR_KEY_SECRET")

if RAZORPAY_KEY_ID and RAZORPAY_KEY_ID != "YOUR_KEY_ID":
    razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
else:
    razorpay_client = None

sub_bp = Blueprint("razorpay_subscriptions", __name__, url_prefix="/api/subscriptions/razorpay")

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


# ============== CREATE ORDER ==============

@sub_bp.route("/create-order", methods=["POST"])
def create_order():
    """Create a Razorpay order for subscription"""
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

        if plan["price"] == 0:
            # Free plan - just activate
            return api_success({
                "order_id": None,
                "payment_url": None,
                "is_free": True
            })

        # Generate order ID
        order_id = f"SUB_{user_id}_{plan_id}_{int(time.time())}"

        if razorpay_client:
            # Create Razorpay order
            razorpay_order = razorpay_client.order.create({
                "amount": int(plan["price"] * 100),  # Convert to paisa
                "currency": "INR",
                "receipt": order_id,
                "notes": {
                    "user_id": str(user_id),
                    "plan_id": str(plan_id)
                }
            })
            razorpay_order_id = razorpay_order["id"]
        else:
            # Mock order for testing without Razorpay
            razorpay_order_id = f"order_mock_{order_id}"

        # Save order to database
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO subscription_orders
                (order_id, user_id, plan_id, amount, status, gateway, razorpay_order_id, created_at)
                VALUES (%s, %s, %s, %s, 'pending', 'razorpay', %s, NOW())
            """, (order_id, user_id, plan_id, plan["price"], razorpay_order_id))
            conn.commit()
        conn.close()

        # Return payment URL
        if razorpay_client:
            payment_url = f"https://razorpay.com/payment/{razorpay_order_id}"
        else:
            payment_url = None

        return api_success({
            "order_id": order_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_key_id": RAZORPAY_KEY_ID if RAZORPAY_KEY_ID != "YOUR_KEY_ID" else None,
            "amount": plan["price"],
            "currency": "INR",
            "payment_url": payment_url
        })

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== VERIFY PAYMENT ==============

@sub_bp.route("/verify-payment", methods=["POST"])
def verify_payment():
    """Verify Razorpay payment signature and activate subscription"""
    try:
        data = request.get_json()
        razorpay_order_id = data.get("razorpay_order_id")
        razorpay_payment_id = data.get("razorpay_payment_id")
        razorpay_signature = data.get("razorpay_signature")

        if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
            return api_error("INVALID_REQUEST", "Missing payment details")

        # Verify signature
        if razorpay_client:
            try:
                razorpay_client.utility.verify_payment_signature({
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature
                })
            except Exception:
                return api_error("INVALID_SIGNATURE", "Payment verification failed", 400)

        # Get order details
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT user_id, plan_id, amount, status
                FROM subscription_orders
                WHERE razorpay_order_id = %s
            """, (razorpay_order_id,))
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
                VALUES (%s, %s, 'active', %s, %s, %s, 'razorpay', NOW())
            """, (
                order["user_id"], order["plan_id"],
                start_date, end_date,
                razorpay_payment_id
            ))

            # Update order status
            cursor.execute("""
                UPDATE subscription_orders
                SET status = 'completed', completed_at = NOW()
                WHERE razorpay_order_id = %s
            """, (razorpay_order_id,))

            conn.commit()
            conn.close()

        return api_success({"message": "Subscription activated successfully"})

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)


# ============== WEBHOOK ==============

@sub_bp.route("/webhook", methods=["POST"])
def razorpay_webhook():
    """Handle Razorpay webhook events"""
    try:
        webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")

        # Verify webhook signature
        if webhook_secret:
            received_signature = request.headers.get("X-Razorpay-Signature")
            if not received_signature:
                return api_error("INVALID_SIGNATURE", "Missing webhook signature", 400)

            payload = request.get_data()
            expected_signature = hashlib.hmac.new(
                webhook_secret.encode(),
                payload,
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(received_signature, expected_signature):
                return api_error("INVALID_SIGNATURE", "Webhook verification failed", 400)

        event = request.json.get("event")
        payload = request.json.get("payload", {})
        order_id = payload.get("order", {}).get("receipt")

        if event == "payment.captured":
            # Update order and create subscription
            conn = get_db_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT user_id, plan_id, status
                    FROM subscription_orders
                    WHERE razorpay_order_id = %s
                """, (payload.get("order", {}).get("entity", {}).get("id"),))
                order = cursor.fetchone()

                if order and order["status"] == "pending":
                    # Get plan
                    cursor.execute("SELECT duration_days FROM subscription_plans WHERE id = %s", (order["plan_id"],))
                    plan = cursor.fetchone()

                    if plan:
                        start_date = datetime.now()
                        end_date = start_date + timedelta(days=plan["duration_days"])

                        cursor.execute("""
                            INSERT INTO user_subscriptions
                            (user_id, plan_id, status, start_date, end_date,
                             payment_id, gateway, created_at)
                            VALUES (%s, %s, 'active', %s, %s, %s, 'razorpay', NOW())
                        """, (
                            order["user_id"], order["plan_id"],
                            start_date, end_date,
                            payload.get("payment", {}).get("entity", {}).get("id")
                        ))

                        cursor.execute("""
                            UPDATE subscription_orders
                            SET status = 'completed', completed_at = NOW()
                            WHERE razorpay_order_id = %s
                        """, (payload.get("order", {}).get("entity", {}).get("id"),))

                        conn.commit()
            conn.close()

        elif event == "payment.failed":
            conn = get_db_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE subscription_orders
                    SET status = 'failed',
                        failure_reason = %s,
                        completed_at = NOW()
                    WHERE razorpay_order_id = %s
                """, (
                    payload.get("error", {}).get("description", "Payment failed"),
                    payload.get("order", {}).get("entity", {}).get("id")
                ))
                conn.commit()
            conn.close()

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        return api_error("SERVER_ERROR", str(e), 500)
