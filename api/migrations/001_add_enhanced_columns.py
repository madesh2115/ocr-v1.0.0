#!/usr/bin/env python3
"""
Migration 001: Add enhanced columns to existing OCR tables.

MySQL-compatible — checks column existence before adding.
Safe for existing data — all new columns are nullable or have defaults.

Run from the api directory:
    python migrations/001_add_enhanced_columns.py

Uses DB_CONFIG and DB_NAME from the app module (app.py).
"""

import sys
import os

# Ensure the api directory is on the path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql


def get_db_config():
    """Return DB config dict compatible with pymysql."""
    return {
        "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("OCR_DB_PORT", "3306")),
        "user": os.getenv("OCR_DB_USER", "root"),
        "password": os.getenv("OCR_DB_PASSWORD", ""),
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
    }


def get_db_name():
    """Return the database name, matching app.py logic."""
    return os.getenv("OCR_DB_NAME", "ocr_v1_00")


def column_exists(cursor, table_name: str, column_name: str) -> bool:
    """Check if a column exists in the given table using INFORMATION_SCHEMA."""
    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (get_db_name(), table_name, column_name),
    )
    return bool(cursor.fetchone()["cnt"])


def index_exists(cursor, table_name: str, index_name: str) -> bool:
    """Check if an index exists on the given table using INFORMATION_SCHEMA."""
    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = %s
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        """,
        (get_db_name(), table_name, index_name),
    )
    return bool(cursor.fetchone()["cnt"])


def add_column(cursor, connection, table: str, column_def: str, after: str = None):
    """
    Add a column to a table if it does not already exist.
    column_def includes the column name and full type/constraint definition.
    If 'after' is provided, use AFTER clause; otherwise append to end.
    """
    col_name = column_def.split()[0]
    if column_exists(cursor, table, col_name):
        print(f"  Column {col_name} already exists in {table} — skipping.")
        return

    sql = f"ALTER TABLE {table} ADD COLUMN {column_def}"
    if after:
        sql += f" AFTER {after}"
    try:
        cursor.execute(sql)
        connection.commit()
        print(f"  Added column {col_name} to {table}... OK")
    except Exception as exc:
        connection.rollback()
        print(f"  ERROR adding column {col_name} to {table}: {exc}")


def add_index(cursor, connection, table: str, index_name: str, columns: str):
    """Add an index if it does not already exist."""
    if index_exists(cursor, table, index_name):
        print(f"  Index {index_name} already exists on {table} — skipping.")
        return

    sql = f"CREATE INDEX {index_name} ON {table}({columns})"
    try:
        cursor.execute(sql)
        connection.commit()
        print(f"  Added index {index_name} on {table}({columns})... OK")
    except Exception as exc:
        connection.rollback()
        print(f"  ERROR adding index {index_name} on {table}: {exc}")


def run_migration():
    print("=" * 60)
    print("Migration 001: Adding enhanced columns to OCR tables")
    print("=" * 60)

    db_name = get_db_name()
    config = get_db_config()
    print(f"Connecting to MySQL at {config['host']}:{config['port']} ...")

    try:
        connection = pymysql.connect(**config)
        print("Connected.\n")
    except Exception as exc:
        print(f"ERROR: Could not connect to MySQL: {exc}")
        sys.exit(1)

    try:
        # Ensure we're connected to the target database
        with connection.cursor() as cursor:
            cursor.execute(f"USE `{db_name}`")
        connection.commit()

        with connection.cursor() as cursor:
            print(f"Using database: {db_name}")
            print()

            # ── ocr_documents columns ──────────────────────────────────────────
            print("[ ocr_documents ]")

            add_column(cursor, connection, "ocr_documents",
                       "user_id INT NULL COMMENT 'Authenticated user who uploaded this document'",
                       after="ocr_engine")

            add_column(cursor, connection, "ocr_documents",
                       "expense_category VARCHAR(100) NULL COMMENT 'Expense category (e.g. food, travel, supplies)'",
                       after="user_id")

            add_column(cursor, connection, "ocr_documents",
                       "review_status ENUM('unreviewed','needs_review','reviewed') DEFAULT 'unreviewed' "
                       "COMMENT 'Human review state of this extraction'",
                       after="expense_category")

            add_column(cursor, connection, "ocr_documents",
                       "corrected_by_user BOOLEAN DEFAULT FALSE COMMENT 'Whether user has corrected this document'",
                       after="review_status")

            add_column(cursor, connection, "ocr_documents",
                       "reviewed_at DATETIME NULL COMMENT 'When the document was last reviewed'",
                       after="corrected_by_user")

            add_column(cursor, connection, "ocr_documents",
                       "image_hash VARCHAR(128) NULL COMMENT 'SHA-256 hex digest of the original image bytes'",
                       after="address")

            add_column(cursor, connection, "ocr_documents",
                       "digital_copy_path VARCHAR(500) NULL COMMENT 'Absolute path to generated Pillow PNG receipt'",
                       after="parsed_json")

            add_column(cursor, connection, "ocr_documents",
                       "pdf_path VARCHAR(500) NULL COMMENT 'Absolute path to generated PDF'",
                       after="digital_copy_path")

            add_column(cursor, connection, "ocr_documents",
                       "invoice_date DATE NULL COMMENT 'Extracted invoice date parsed from date_text'",
                       after="date_text")

            add_column(cursor, connection, "ocr_documents",
                       "invoice_time TIME NULL COMMENT 'Extracted time from date_text if present'",
                       after="invoice_date")

            print()

            # ── ocr_line_items columns ────────────────────────────────────────
            print("[ ocr_line_items ]")

            add_column(cursor, connection, "ocr_line_items",
                       "description TEXT NULL COMMENT 'Item description or notes'",
                       after="gst")

            add_column(cursor, connection, "ocr_line_items",
                       "hsn_code VARCHAR(50) NULL COMMENT 'HSN code for this item'",
                       after="description")

            add_column(cursor, connection, "ocr_line_items",
                       "unit VARCHAR(50) DEFAULT 'item' COMMENT 'Unit of measure (e.g. item, kg, litre)'",
                       after="hsn_code")

            add_column(cursor, connection, "ocr_line_items",
                       "unit_price DECIMAL(12,2) NULL COMMENT 'Price per unit'",
                       after="unit")

            add_column(cursor, connection, "ocr_line_items",
                       "gross_amount DECIMAL(12,2) NULL COMMENT 'Gross amount before discount'",
                       after="unit_price")

            add_column(cursor, connection, "ocr_line_items",
                       "discount_amount DECIMAL(12,2) DEFAULT 0.00 COMMENT 'Discount applied to this item'",
                       after="gross_amount")

            add_column(cursor, connection, "ocr_line_items",
                       "tax_rate DECIMAL(7,3) NULL COMMENT 'Tax rate as decimal (e.g. 0.18 for 18%)'",
                       after="discount_amount")

            add_column(cursor, connection, "ocr_line_items",
                       "tax_amount DECIMAL(12,2) NULL COMMENT 'Tax amount for this line item'",
                       after="tax_rate")

            add_column(cursor, connection, "ocr_line_items",
                       "expected_total VARCHAR(30) NULL COMMENT 'Computed expected total = rate x qty'",
                       after="tax_amount")

            add_column(cursor, connection, "ocr_line_items",
                       "totals_match VARCHAR(30) NULL COMMENT 'EXACT | APPROXIMATE | MISSING | VALIDATION_ERROR'",
                       after="expected_total")

            add_column(cursor, connection, "ocr_line_items",
                       "discrepancy VARCHAR(20) NULL COMMENT '|actual - expected| as a Decimal string'",
                       after="totals_match")

            add_column(cursor, connection, "ocr_line_items",
                       "item_order INT UNSIGNED DEFAULT 0 COMMENT 'Sort order for line items'",
                       after="discrepancy")

            add_column(cursor, connection, "ocr_line_items",
                       "manually_corrected BOOLEAN DEFAULT FALSE COMMENT 'Whether this item was manually corrected'",
                       after="item_order")

            print()

            # ── ocr_item_aliases columns ───────────────────────────────────────
            print("[ ocr_item_aliases ]")

            # Only add use_count if it doesn't exist (some schemas may already have it)
            if not column_exists(cursor, "ocr_item_aliases", "use_count"):
                add_column(cursor, connection, "ocr_item_aliases",
                           "use_count INT UNSIGNED DEFAULT 1 COMMENT 'How many times this alias has been applied'",
                           after="corrected_name")
            else:
                print("  Column use_count already exists in ocr_item_aliases — skipping.")

            print()

            # ── Indexes on ocr_documents ───────────────────────────────────────
            print("[ ocr_documents indexes ]")

            add_index(cursor, connection, "ocr_documents",
                      "idx_documents_user_date",
                      "user_id, invoice_date")

            add_index(cursor, connection, "ocr_documents",
                      "idx_documents_user_vendor",
                      "user_id, vendor")

            add_index(cursor, connection, "ocr_documents",
                      "idx_documents_image_hash",
                      "image_hash")

            add_index(cursor, connection, "ocr_documents",
                      "idx_documents_invoice_number",
                      "invoice_number")

            print()

            # ── Indexes on ocr_line_items ───────────────────────────────────────
            print("[ ocr_line_items indexes ]")

            add_index(cursor, connection, "ocr_line_items",
                      "idx_line_items_document_order",
                      "document_id, item_order")

            print()
            print("=" * 60)
            print("Migration 001 complete.")
            print("Verify with: DESCRIBE ocr_documents; DESCRIBE ocr_line_items;")
            print("=" * 60)

    finally:
        connection.close()


if __name__ == "__main__":
    run_migration()
