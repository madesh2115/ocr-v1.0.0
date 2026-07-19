"""
Database initialization and auto-migration system.
Supports both MySQL and PostgreSQL databases based on OCR_DB_TYPE environment variable.
"""
import os
import sys
import json
import pymysql
from typing import Tuple

from services.database import db_connect, DB_NAME, DB_TYPE

def column_exists(cursor, table_name: str, column_name: str) -> bool:
    if DB_TYPE == "postgresql":
        cursor.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND column_name = %s
            """,
            (table_name, column_name),
        )
    else:
        cursor.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND COLUMN_NAME = %s
            """,
            (DB_NAME, table_name, column_name),
        )
    res = cursor.fetchone()
    return bool(res.get("cnt") if isinstance(res, dict) else res[0])

def index_exists(cursor, table_name: str, index_name: str) -> bool:
    if DB_TYPE == "postgresql":
        cursor.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = %s
              AND indexname = %s
            """,
            (table_name, index_name),
        )
    else:
        cursor.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND INDEX_NAME = %s
            """,
            (DB_NAME, table_name, index_name),
        )
    res = cursor.fetchone()
    return bool(res.get("cnt") if isinstance(res, dict) else res[0])

def add_column(cursor, table: str, column_def: str, after: str = None):
    col_name = column_def.split()[0]
    if column_exists(cursor, table, col_name):
        return
    sql = f"ALTER TABLE {table} ADD COLUMN {column_def}"
    if after and DB_TYPE != "postgresql":
        sql += f" AFTER {after}"
    try:
        cursor.execute(sql)
        print(f"  [Auto-Migration] Added column {col_name} to table {table}")
    except Exception as e:
        print(f"  [Auto-Migration] Warning: Could not add column {col_name} to {table}: {e}")

def run_postgres_init(cursor) -> None:
    """Create PostgreSQL tables and schema objects."""
    # Create Users
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NULL,
            full_name VARCHAR(255) NOT NULL DEFAULT '',
            google_id VARCHAR(255) NULL UNIQUE,
            avatar_url VARCHAR(500) NULL,
            phone VARCHAR(40) NULL,
            subscription_tier VARCHAR(50) NOT NULL DEFAULT 'free',
            subscription_status VARCHAR(50) NOT NULL DEFAULT 'active',
            stripe_customer_id VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP NULL,
            is_active SMALLINT NOT NULL DEFAULT 1
        )
    """)

    # User Sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL,
            refresh_token VARCHAR(500) NOT NULL,
            device_name VARCHAR(100) NULL,
            device_id VARCHAR(100) NULL,
            ip_address VARCHAR(45) NULL,
            user_agent VARCHAR(500) NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            revoked_at TIMESTAMP NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # Revoked Tokens
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            id SERIAL PRIMARY KEY,
            token_jti VARCHAR(50) NOT NULL UNIQUE,
            revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL
        )
    """)

    # Organizations
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS organizations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            owner_user_id INT NOT NULL,
            logo_url VARCHAR(500) NULL,
            subscription_tier VARCHAR(50) NOT NULL DEFAULT 'free',
            subscription_status VARCHAR(50) NOT NULL DEFAULT 'active',
            stripe_subscription_id VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
        )
    """)

    # Organization Members
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS organization_members (
            org_id INT NOT NULL,
            user_id INT NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            invited_by_user_id INT NULL,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (org_id, user_id)
        )
    """)

    # Organization Invites
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS organization_invites (
            id SERIAL PRIMARY KEY,
            org_id INT NOT NULL,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            invite_token VARCHAR(100) NOT NULL UNIQUE,
            invited_by_user_id INT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            accepted_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # Expense Categories
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS expense_categories (
            id SERIAL PRIMARY KEY,
            user_id INT NULL,
            org_id INT NULL,
            name VARCHAR(100) NOT NULL,
            icon VARCHAR(50) NOT NULL DEFAULT 'receipt',
            color VARCHAR(7) NOT NULL DEFAULT '#64748B',
            is_system SMALLINT NOT NULL DEFAULT 0,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
            UNIQUE (user_id, org_id, name)
        )
    """)

    # Subscription Plans
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            price DECIMAL(10, 2) NOT NULL,
            duration_days INT NOT NULL DEFAULT 30,
            features JSONB,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Subscription Orders
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subscription_orders (
            id SERIAL PRIMARY KEY,
            order_id VARCHAR(100) UNIQUE NOT NULL,
            user_id INT NOT NULL,
            plan_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            gateway VARCHAR(50) DEFAULT 'phonepe',
            payment_id VARCHAR(100),
            failure_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
        )
    """)

    # User Subscriptions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL,
            plan_id INT NOT NULL,
            status VARCHAR(50) DEFAULT 'active',
            start_date TIMESTAMP NOT NULL,
            end_date TIMESTAMP NOT NULL,
            payment_id VARCHAR(100),
            gateway VARCHAR(50) DEFAULT 'phonepe',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            cancelled_at TIMESTAMP NULL,
            FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
        )
    """)

    # OCR Documents (Simplified Dynamic Format)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ocr_documents (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL,
            organization_id INT NULL,
            expense_category VARCHAR(100) NULL,
            image_path VARCHAR(500) NULL,
            digital_copy_path VARCHAR(500) NULL,
            pdf_path VARCHAR(500) NULL,
            raw_text TEXT NULL,
            parsed_json TEXT NULL,
            ocr_engine VARCHAR(60) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # OCR Learning Examples
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ocr_learning_examples (
            id SERIAL PRIMARY KEY,
            document_id INT NULL,
            vendor_before VARCHAR(255),
            vendor_after VARCHAR(255),
            corrected_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # OCR Item Aliases
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ocr_item_aliases (
            id SERIAL PRIMARY KEY,
            vendor_key VARCHAR(100),
            raw_name VARCHAR(100),
            corrected_name VARCHAR(255),
            use_count INT DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (vendor_key, raw_name)
        )
    """)

    # PostgreSQL Triggers for Default User Categories
    cursor.execute("DROP TRIGGER IF EXISTS trg_users_after_insert ON users")
    cursor.execute("""
        CREATE OR REPLACE FUNCTION make_default_categories()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO expense_categories (user_id, name, icon, color, is_system, sort_order) VALUES
            (NEW.id, 'Food & Dining', 'restaurant', '#EF4444', 1, 1),
            (NEW.id, 'Travel', 'airplane', '#3B82F6', 1, 2),
            (NEW.id, 'Shopping', 'cart', '#8B5CF6', 1, 3),
            (NEW.id, 'Utilities', 'flash', '#F59E0B', 1, 4),
            (NEW.id, 'Healthcare', 'medkit', '#10B981', 1, 5),
            (NEW.id, 'Entertainment', 'game-controller', '#EC4899', 1, 6),
            (NEW.id, 'Groceries', 'basket', '#6366F1', 1, 7),
            (NEW.id, 'Other', 'ellipsis-horizontal', '#64748B', 1, 99);
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    cursor.execute("""
        CREATE TRIGGER trg_users_after_insert
        AFTER INSERT ON users
        FOR EACH ROW
        EXECUTE FUNCTION make_default_categories();
    """)


def run_auto_init() -> Tuple[bool, str]:
    try:
        if DB_TYPE == "postgresql":
            # 1. Connect to postgres default DB to check / create our database
            conn = db_connect(database=None)
            conn.conn.autocommit = True
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT 1 FROM pg_database WHERE datname = '{DB_NAME}'")
                if not cursor.fetchone():
                    cursor.execute(f"CREATE DATABASE {DB_NAME}")
            conn.close()

            # Reconnect with the custom database
            conn = db_connect(database=DB_NAME)
            with conn.cursor() as cursor:
                run_postgres_init(cursor)

                # Seed Plans
                cursor.execute("SELECT COUNT(*) AS cnt FROM subscription_plans")
                res = cursor.fetchone()
                if (res.get("cnt") if isinstance(res, dict) else res[0]) == 0:
                    print("  [Auto-Migration] Seeding subscription plans (PostgreSQL)...")
                    cursor.execute("""
                        INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active) VALUES
                        ('Free', 'Basic OCR scanning with limited features', 0.00, 0, '{"scans_per_month": 10, "export_formats": ["pdf"], "cloud_sync": false}', true),
                        ('Premium', 'Unlimited OCR scanning with all features', 99.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel"], "cloud_sync": true, "priority_support": true, "api_access": false}', true),
                        ('Professional', 'For power users with API access', 299.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel", "json"], "cloud_sync": true, "priority_support": true, "api_access": true}', true);
                    """)
            conn.commit()
            conn.close()
            return True, "connected"

        else:
            # Default MySQL initialization
            # 1. Create database if not exists
            # Connect to MySQL server without database first
            conn_config = {
                "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
                "port": int(os.getenv("OCR_DB_PORT", "3306")),
                "user": os.getenv("OCR_DB_USER", "root"),
                "password": os.getenv("OCR_DB_PASSWORD", ""),
            }
            conn = pymysql.connect(**conn_config)
            with conn.cursor() as cursor:
                cursor.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            conn.commit()
            conn.close()

            # Reconnect using the database
            conn = db_connect(database=DB_NAME)
            with conn.cursor() as cursor:
                # 2. Create Core Tables if not exists
                # Users
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        email VARCHAR(255) NOT NULL,
                        password_hash VARCHAR(255) NULL,
                        full_name VARCHAR(255) NOT NULL DEFAULT '',
                        google_id VARCHAR(255) NULL UNIQUE,
                        avatar_url VARCHAR(500) NULL,
                        phone VARCHAR(40) NULL,
                        subscription_tier ENUM('free', 'pro', 'team') NOT NULL DEFAULT 'free',
                        subscription_status ENUM('active', 'cancelled', 'past_due', 'trialing') NOT NULL DEFAULT 'active',
                        stripe_customer_id VARCHAR(100) NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        last_login_at TIMESTAMP NULL,
                        is_active TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uk_users_email (email),
                        INDEX idx_users_google_id (google_id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # User Sessions
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS user_sessions (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        user_id INT UNSIGNED NOT NULL,
                        refresh_token VARCHAR(500) NOT NULL,
                        device_name VARCHAR(100) NULL,
                        device_id VARCHAR(100) NULL,
                        ip_address VARCHAR(45) NULL,
                        user_agent VARCHAR(500) NULL,
                        expires_at TIMESTAMP NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        revoked_at TIMESTAMP NULL,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        INDEX idx_sessions_user_id (user_id),
                        INDEX idx_sessions_expires_at (expires_at)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Revoked Tokens
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS revoked_tokens (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        token_jti VARCHAR(50) NOT NULL,
                        revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        expires_at TIMESTAMP NOT NULL,
                        UNIQUE KEY uk_revoked_jti (token_jti),
                        INDEX idx_revoked_expires (expires_at)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Organizations
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS organizations (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        slug VARCHAR(100) NOT NULL UNIQUE,
                        owner_user_id INT UNSIGNED NOT NULL,
                        logo_url VARCHAR(500) NULL,
                        subscription_tier ENUM('free', 'pro', 'enterprise') NOT NULL DEFAULT 'free',
                        subscription_status ENUM('active', 'cancelled', 'past_due') NOT NULL DEFAULT 'active',
                        stripe_subscription_id VARCHAR(100) NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
                        INDEX idx_orgs_slug (slug),
                        INDEX idx_orgs_owner (owner_user_id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Organization Members
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS organization_members (
                        org_id INT UNSIGNED NOT NULL,
                        user_id INT UNSIGNED NOT NULL,
                        role ENUM('owner', 'admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
                        invited_by_user_id INT UNSIGNED NULL,
                        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        PRIMARY KEY (org_id, user_id),
                        INDEX idx_org_members_user (user_id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Organization Invites
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS organization_invites (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        org_id INT UNSIGNED NOT NULL,
                        email VARCHAR(255) NOT NULL,
                        role ENUM('admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
                        invite_token VARCHAR(100) NOT NULL UNIQUE,
                        invited_by_user_id INT UNSIGNED NOT NULL,
                        expires_at TIMESTAMP NOT NULL,
                        accepted_at TIMESTAMP NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
                        FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
                        INDEX idx_org_invites_email (email),
                        INDEX idx_org_invites_org_id (org_id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Expense Categories
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS expense_categories (
                        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        user_id INT UNSIGNED NULL,
                        org_id INT UNSIGNED NULL,
                        name VARCHAR(100) NOT NULL,
                        icon VARCHAR(50) NOT NULL DEFAULT 'receipt',
                        color VARCHAR(7) NOT NULL DEFAULT '#64748B',
                        is_system TINYINT(1) NOT NULL DEFAULT 0,
                        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
                        UNIQUE KEY uk_category_user_org_name (user_id, org_id, name)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Subscription Plans
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS subscription_plans (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(100) NOT NULL,
                        description TEXT,
                        price DECIMAL(10, 2) NOT NULL,
                        duration_days INT NOT NULL DEFAULT 30,
                        features JSON,
                        is_active BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Subscription Orders
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS subscription_orders (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        order_id VARCHAR(100) UNIQUE NOT NULL,
                        user_id INT NOT NULL,
                        plan_id INT NOT NULL,
                        amount DECIMAL(10, 2) NOT NULL,
                        status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
                        gateway VARCHAR(50) DEFAULT 'phonepe',
                        payment_id VARCHAR(100),
                        failure_reason TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        completed_at TIMESTAMP NULL,
                        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # User Subscriptions
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS user_subscriptions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        plan_id INT NOT NULL,
                        status ENUM('active', 'cancelled', 'expired') DEFAULT 'active',
                        start_date TIMESTAMP NOT NULL,
                        end_date TIMESTAMP NOT NULL,
                        payment_id VARCHAR(100),
                        gateway VARCHAR(50) DEFAULT 'phonepe',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        cancelled_at TIMESTAMP NULL,
                        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # Drop old tables and views to migrate to the new dynamic format
                cursor.execute("DROP VIEW IF EXISTS v_document_review_list")
                cursor.execute("DROP TABLE IF EXISTS ocr_line_items")
                cursor.execute("DROP TABLE IF EXISTS ocr_documents")

                # OCR Documents (Simplified Dynamic Format)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS ocr_documents (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT UNSIGNED NOT NULL,
                        organization_id INT UNSIGNED NULL,
                        expense_category VARCHAR(100) NULL,
                        image_path VARCHAR(500) NULL,
                        digital_copy_path VARCHAR(500) NULL,
                        pdf_path VARCHAR(500) NULL,
                        raw_text LONGTEXT NULL,
                        parsed_json LONGTEXT NULL,
                        ocr_engine VARCHAR(60) NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # OCR Learning Examples
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS ocr_learning_examples (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        document_id INT NULL,
                        vendor_before VARCHAR(255),
                        vendor_after VARCHAR(255),
                        corrected_json LONGTEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # OCR Item Aliases
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS ocr_item_aliases (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        vendor_key VARCHAR(100),
                        raw_name VARCHAR(100),
                        corrected_name VARCHAR(255),
                        use_count INT DEFAULT 1,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY vendor_raw_unique (vendor_key, raw_name)
                    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                """)

                # 3. Dynamic Column / Column Migrations Check
                # ocr_item_aliases column check/add
                add_column(cursor, "ocr_item_aliases", "use_count INT UNSIGNED DEFAULT 1", after="corrected_name")

                # 5. Populate Seed Data / Default Plans
                cursor.execute("SELECT COUNT(*) AS cnt FROM subscription_plans")
                res = cursor.fetchone()
                if (res.get("cnt") if isinstance(res, dict) else res[0]) == 0:
                    print("  [Auto-Migration] Seeding subscription plans...")
                    cursor.execute("""
                        INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active) VALUES
                        ('Free', 'Basic OCR scanning with limited features', 0.00, 0, '{"scans_per_month": 10, "export_formats": ["pdf"], "cloud_sync": false}', 1),
                        ('Premium', 'Unlimited OCR scanning with all features', 99.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel"], "cloud_sync": true, "priority_support": true, "api_access": false}', 1),
                        ('Professional', 'For power users with API access', 299.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel", "json"], "cloud_sync": true, "priority_support": true, "api_access": true}', 1);
                    """)

                # 6. Ensure default categories trigger exists
                try:
                    # We check if trigger exists by querying information_schema
                    cursor.execute("""
                        SELECT COUNT(*) AS cnt 
                        FROM information_schema.triggers 
                        WHERE trigger_schema = %s AND trigger_name = 'trg_users_after_insert'
                    """, (DB_NAME,))
                    res = cursor.fetchone()
                    if (res.get("cnt") if isinstance(res, dict) else res[0]) == 0:
                        cursor.execute("""
                            CREATE TRIGGER trg_users_after_insert
                            AFTER INSERT ON users
                            FOR EACH ROW
                            BEGIN
                                INSERT INTO expense_categories (user_id, name, icon, color, is_system, sort_order) VALUES
                                (NEW.id, 'Food & Dining', 'restaurant', '#EF4444', 1, 1),
                                (NEW.id, 'Travel', 'airplane', '#3B82F6', 1, 2),
                                (NEW.id, 'Shopping', 'cart', '#8B5CF6', 1, 3),
                                (NEW.id, 'Utilities', 'flash', '#F59E0B', 1, 4),
                                (NEW.id, 'Healthcare', 'medkit', '#10B981', 1, 5),
                                (NEW.id, 'Entertainment', 'game-controller', '#EC4899', 1, 6),
                                (NEW.id, 'Groceries', 'basket', '#6366F1', 1, 7),
                                (NEW.id, 'Other', 'ellipsis-horizontal', '#64748B', 1, 99);
                            END;
                        """)
                        print("  [Auto-Migration] Created user signup default category trigger")
                except Exception as trig_err:
                    print(f"  [Auto-Migration] Warning setting up trigger: {trig_err}")

            conn.commit()
            conn.close()
            return True, "connected"
    except Exception as exc:
        return False, str(exc)
