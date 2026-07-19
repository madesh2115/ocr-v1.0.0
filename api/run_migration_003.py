"""Run auth migration 003 using MyISAM engine (MariaDB limitation)."""
import pymysql

conn = pymysql.connect(
    host="127.0.0.1", port=3306, user="root", password="",
    database="ocr_v1_00", charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor
)
cur = conn.cursor()

tables = [
    ("users", """
        CREATE TABLE users (
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
            INDEX idx_users_google_id (google_id),
            INDEX idx_users_subscription (subscription_tier, subscription_status)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("user_sessions", """
        CREATE TABLE user_sessions (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            refresh_token VARCHAR(500) NOT NULL,
            device_name VARCHAR(100) NULL,
            device_id VARCHAR(100) NULL,
            ip_address VARCHAR(45) NULL,
            user_agent VARCHAR(500) NULL,
            expires_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            revoked_at TIMESTAMP NULL,
            INDEX idx_sessions_user_id (user_id),
            INDEX idx_sessions_refresh_token (refresh_token(255)),
            INDEX idx_sessions_expires_at (expires_at)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("revoked_tokens", """
        CREATE TABLE revoked_tokens (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            token_jti VARCHAR(50) NOT NULL,
            revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            UNIQUE KEY uk_revoked_jti (token_jti),
            INDEX idx_revoked_expires (expires_at)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("organizations", """
        CREATE TABLE organizations (
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
            INDEX idx_orgs_slug (slug),
            INDEX idx_orgs_owner (owner_user_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("organization_members", """
        CREATE TABLE organization_members (
            org_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            role ENUM('owner', 'admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
            invited_by_user_id INT UNSIGNED NULL,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (org_id, user_id),
            UNIQUE KEY uk_org_member_user (org_id, user_id),
            INDEX idx_org_members_user (user_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("organization_invites", """
        CREATE TABLE organization_invites (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            org_id INT UNSIGNED NOT NULL,
            email VARCHAR(255) NOT NULL,
            role ENUM('admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
            invite_token VARCHAR(100) NOT NULL UNIQUE,
            invited_by_user_id INT UNSIGNED NOT NULL,
            expires_at DATETIME NOT NULL,
            accepted_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_org_invite_token (invite_token),
            INDEX idx_org_invites_email (email),
            INDEX idx_org_invites_org_id (org_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
    ("expense_categories", """
        CREATE TABLE expense_categories (
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
            UNIQUE KEY uk_category_user_org_name (user_id, org_id, name)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
]

for name, sql in tables:
    try:
        cur.execute(sql)
        print(f"Created {name}")
    except Exception as e:
        print(f"{name}: {e}")

conn.commit()

# Verify
cur.execute("SHOW TABLES")
all_tables = [list(r.values())[0] for r in cur.fetchall()]
print("\nAll tables:", all_tables)

cur.close()
conn.close()
print("\nMigration 003 complete!")