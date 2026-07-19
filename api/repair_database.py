#!/usr/bin/env python3
"""
Database Repair Script - Fixes missing columns and structural issues.
Run this after database initialization to ensure all columns exist.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pymysql
from pymysql.cursors import DictCursor

DB_NAME = os.getenv("OCR_DB_NAME", "ocr_v1_00")
DB_CONFIG = {
    "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("OCR_DB_PORT", "3306")),
    "user": os.getenv("OCR_DB_USER", "root"),
    "password": os.getenv("OCR_DB_PASSWORD", ""),
    "charset": "utf8mb4",
}


def column_exists(cursor, table_name: str, column_name: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
        """,
        (DB_NAME, table_name, column_name),
    )
    return bool(cursor.fetchone()["cnt"])


def table_engine(cursor, table_name: str) -> str:
    cursor.execute(
        """
        SELECT ENGINE
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
        """,
        (DB_NAME, table_name),
    )
    result = cursor.fetchone()
    return result["ENGINE"] if result else None


def add_column_safe(cursor, table: str, column_def: str, after: str = None):
    """Add column with multiple fallback strategies."""
    col_name = column_def.split()[0]
    if column_exists(cursor, table, col_name):
        print(f"  [OK] {table}.{col_name} already exists")
        return True

    # Try with AFTER first
    sql = f"ALTER TABLE {table} ADD COLUMN {column_def}"
    if after:
        sql += f" AFTER {after}"

    for attempt in range(3):
        try:
            cursor.execute(sql)
            print(f"  [ADDED] {table}.{col_name} via {sql[:50]}...")
            return True
        except Exception as e:
            err_str = str(e).lower()
            if "after" in err_str and attempt == 0:
                # Try without AFTER
                sql = f"ALTER TABLE {table} ADD COLUMN {column_def}"
                print(f"  [RETRY] Trying without AFTER clause...")
                continue
            elif "duplicate" in err_str and attempt == 1:
                # Column might have been added by another process
                if column_exists(cursor, table, col_name):
                    print(f"  [OK] {table}.{col_name} exists (race condition)")
                    return True
            print(f"  [ERROR] Failed to add {table}.{col_name}: {e}")
            return False
    return False


def fix_ocr_documents_columns(cursor):
    """Add all missing columns to ocr_documents table."""
    print("\n[Fixing ocr_documents columns]")

    # Tax columns (the main issue causing cgst error)
    add_column_safe(cursor, "ocr_documents", "cgst DECIMAL(12,2) NULL", after="tax")
    add_column_safe(cursor, "ocr_documents", "sgst DECIMAL(12,2) NULL", after="cgst")
    add_column_safe(cursor, "ocr_documents", "igst DECIMAL(12,2) NULL", after="sgst")
    add_column_safe(cursor, "ocr_documents", "cess DECIMAL(12,2) NULL", after="igst")

    # User/org columns
    add_column_safe(cursor, "ocr_documents", "user_id INT UNSIGNED NULL COMMENT 'Owner user ID'", after="ocr_engine")
    add_column_safe(cursor, "ocr_documents", "organization_id INT UNSIGNED NULL COMMENT 'Organization ID'", after="user_id")
    add_column_safe(cursor, "ocr_documents", "expense_category VARCHAR(100) NULL COMMENT 'Category'", after="organization_id")
    add_column_safe(cursor, "ocr_documents", "review_status ENUM('pending','reviewed','corrected','approved') NOT NULL DEFAULT 'pending'", after="expense_category")
    add_column_safe(cursor, "ocr_documents", "corrected_by_user VARCHAR(255) NULL", after="review_status")
    add_column_safe(cursor, "ocr_documents", "reviewed_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP", after="corrected_by_user")
    add_column_safe(cursor, "ocr_documents", "image_hash VARCHAR(64) NULL", after="address")
    add_column_safe(cursor, "ocr_documents", "digital_copy_path VARCHAR(500) NULL", after="parsed_json")
    add_column_safe(cursor, "ocr_documents", "pdf_path VARCHAR(500) NULL", after="digital_copy_path")
    add_column_safe(cursor, "ocr_documents", "invoice_date DATE NULL", after="date_text")
    add_column_safe(cursor, "ocr_documents", "invoice_time TIME NULL", after="invoice_date")


def fix_ocr_line_items_columns(cursor):
    """Add missing columns to ocr_line_items table."""
    print("\n[Fixing ocr_line_items columns]")

    add_column_safe(cursor, "ocr_line_items", "description TEXT NULL", after="gst")
    add_column_safe(cursor, "ocr_line_items", "hsn_code VARCHAR(50) NULL", after="description")
    add_column_safe(cursor, "ocr_line_items", "unit VARCHAR(50) DEFAULT 'item'", after="hsn_code")
    add_column_safe(cursor, "ocr_line_items", "unit_price DECIMAL(12,2) NULL", after="unit")
    add_column_safe(cursor, "ocr_line_items", "gross_amount DECIMAL(12,2) NULL", after="unit_price")
    add_column_safe(cursor, "ocr_line_items", "discount_amount DECIMAL(12,2) DEFAULT 0.00", after="gross_amount")
    add_column_safe(cursor, "ocr_line_items", "tax_rate DECIMAL(7,3) NULL", after="discount_amount")
    add_column_safe(cursor, "ocr_line_items", "tax_amount DECIMAL(12,2) NULL", after="tax_rate")
    add_column_safe(cursor, "ocr_line_items", "expected_total VARCHAR(30) NULL", after="tax_amount")
    add_column_safe(cursor, "ocr_line_items", "totals_match VARCHAR(30) NULL", after="expected_total")
    add_column_safe(cursor, "ocr_line_items", "discrepancy VARCHAR(20) NULL", after="totals_match")
    add_column_safe(cursor, "ocr_line_items", "item_order INT UNSIGNED DEFAULT 0", after="discrepancy")
    add_column_safe(cursor, "ocr_line_items", "manually_corrected BOOLEAN DEFAULT FALSE", after="item_order")


def fix_subscription_tables(cursor):
    """Fix subscription_plans and user_subscriptions tables."""
    print("\n[Fixing subscription tables]")

    # Check subscription_plans
    engine = table_engine(cursor, "subscription_plans")
    print(f"  subscription_plans engine: {engine}")

    if not column_exists(cursor, "subscription_plans", "id"):
        print("  [ERROR] subscription_plans table is malformed - missing id column")
        return

    # Ensure subscription_plans has seed data
    cursor.execute("SELECT COUNT(*) as cnt FROM subscription_plans")
    count = cursor.fetchone()["cnt"]
    if count == 0:
        print("  [SEEDING] Adding default subscription plans...")
        try:
            cursor.execute("""
                INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active) VALUES
                ('Free', 'Basic OCR scanning with limited features', 0.00, 0, '{"scans_per_month": 10, "export_formats": ["pdf"], "cloud_sync": false}', 1),
                ('Premium', 'Unlimited OCR scanning with all features', 99.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel"], "cloud_sync": true, "priority_support": true, "api_access": false}', 1),
                ('Professional', 'For power users with API access', 299.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel", "json"], "cloud_sync": true, "priority_support": true, "api_access": true}', 1)
            """)
            print("  [OK] Seed data inserted")
        except Exception as e:
            print(f"  [ERROR] Could not seed subscription plans: {e}")

    # Check if user_subscriptions has foreign key to users
    # The user_subscriptions table should have user_id that references users(id)


def add_indexes(cursor):
    """Add missing indexes."""
    print("\n[Adding indexes]")

    indexes_to_add = [
        ("ocr_documents", "idx_documents_image_hash", "image_hash"),
        ("ocr_documents", "idx_documents_invoice_number", "invoice_number"),
        ("ocr_documents", "idx_documents_user_vendor", "user_id, vendor"),
        ("ocr_documents", "idx_documents_user_date", "user_id, invoice_date"),
        ("ocr_line_items", "idx_line_items_document_order", "document_id, item_order"),
    ]

    for table, index_name, columns in indexes_to_add:
        try:
            cursor.execute(f"CREATE INDEX {index_name} ON {table}({columns})")
            print(f"  [ADDED] index {index_name} on {table}")
        except Exception as e:
            if "Duplicate" in str(e) or "already exists" in str(e).lower():
                print(f"  [OK] index {index_name} already exists")
            else:
                print(f"  [WARN] index {index_name}: {e}")


def verify_column(cursor, table: str, column: str):
    """Verify a column exists and print its info."""
    if column_exists(cursor, table, column):
        print(f"  [OK] {table}.{column}")
        return True
    print(f"  [MISSING] {table}.{column}")
    return False


def main():
    print("=" * 60)
    print("Database Repair Script")
    print("=" * 60)

    try:
        conn = pymysql.connect(**DB_CONFIG, cursorclass=DictCursor)
        print(f"Connected to MySQL at {DB_CONFIG['host']}:{DB_CONFIG['port']}")
    except Exception as e:
        print(f"ERROR: Could not connect to MySQL: {e}")
        sys.exit(1)

    try:
        # Ensure we're using the database
        conn.cursor().execute(f"USE `{DB_NAME}`")
        conn.commit()

        with conn.cursor() as cursor:
            # Check and fix ocr_documents
            print("\n[Checking ocr_documents]")
            for col in ["cgst", "sgst", "igst", "cess", "user_id", "organization_id",
                        "expense_category", "review_status", "invoice_date"]:
                verify_column(cursor, "ocr_documents", col)

            fix_ocr_documents_columns(cursor)

            # Check and fix ocr_line_items
            print("\n[Checking ocr_line_items]")
            for col in ["description", "hsn_code", "unit_price", "tax_rate", "item_order"]:
                verify_column(cursor, "ocr_line_items", col)

            fix_ocr_line_items_columns(cursor)

            # Fix subscription tables
            fix_subscription_tables(cursor)

            # Add indexes
            add_indexes(cursor)

            # Verify key columns after fixes
            print("\n[Final Verification]")
            all_good = True
            for col in ["cgst", "sgst", "igst", "cess"]:
                if not verify_column(cursor, "ocr_documents", col):
                    all_good = False

            if all_good:
                print("\n[SUCCESS] All critical columns verified!")
            else:
                print("\n[WARNING] Some columns are still missing!")

        conn.commit()
        conn.close()
        print("\n[Done] Database repair complete.")
        print("Restart the API server to apply changes.")

    except Exception as e:
        print(f"\n[ERROR] {e}")
        conn.close()
        sys.exit(1)


if __name__ == "__main__":
    main()