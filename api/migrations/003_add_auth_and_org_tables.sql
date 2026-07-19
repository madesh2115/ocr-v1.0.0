-- Migration 003: Authentication, Organizations, and User-Scoping
-- Run AFTER migrations 001 and 002
-- Usage: mysql -u root -p ocr_v1_00 < migrations/003_add_auth_and_org_tables.sql

-- ── Users ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email               VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(255) NULL COMMENT 'NULL if google-only account',
    full_name           VARCHAR(255) NOT NULL DEFAULT '',
    google_id           VARCHAR(255) NULL UNIQUE COMMENT 'Set when signing in via Google',
    avatar_url          VARCHAR(500) NULL,
    phone               VARCHAR(40) NULL,
    subscription_tier   ENUM('free', 'pro', 'team') NOT NULL DEFAULT 'free',
    subscription_status ENUM('active', 'cancelled', 'past_due', 'trialing') NOT NULL DEFAULT 'active',
    stripe_customer_id  VARCHAR(100) NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at       TIMESTAMP NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_users_email (email),
    INDEX idx_users_google_id (google_id),
    INDEX idx_users_subscription (subscription_tier, subscription_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── User Sessions (Refresh Tokens) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    refresh_token   VARCHAR(500) NOT NULL,
    device_name     VARCHAR(100) NULL COMMENT 'e.g. iPhone 14, Pixel 7',
    device_id       VARCHAR(100) NULL COMMENT 'Unique device identifier from mobile app',
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(500) NULL,
    expires_at      TIMESTAMP NOT NULL COMMENT 'Refresh token expiry (30 days)',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at      TIMESTAMP NULL COMMENT 'Set when user logs out or token is revoked',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_user_id (user_id),
    INDEX idx_sessions_refresh_token (refresh_token(255)),
    INDEX idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Revoked Tokens ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revoked_tokens (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_jti   VARCHAR(50) NOT NULL,
    revoked_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMP NOT NULL COMMENT 'Token original expiry for cleanup',
    UNIQUE KEY uk_revoked_jti (token_jti),
    INDEX idx_revoked_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Organizations (Teams) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                    VARCHAR(255) NOT NULL,
    slug                    VARCHAR(100) NOT NULL UNIQUE COMMENT 'URL-safe identifier',
    owner_user_id           INT UNSIGNED NOT NULL,
    logo_url                VARCHAR(500) NULL,
    subscription_tier       ENUM('free', 'pro', 'enterprise') NOT NULL DEFAULT 'free',
    subscription_status     ENUM('active', 'cancelled', 'past_due') NOT NULL DEFAULT 'active',
    stripe_subscription_id VARCHAR(100) NULL,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX idx_orgs_slug (slug),
    INDEX idx_orgs_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Organization Members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_members (
    org_id              INT UNSIGNED NOT NULL,
    user_id             INT UNSIGNED NOT NULL,
    role                ENUM('owner', 'admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
    invited_by_user_id  INT UNSIGNED NULL,
    joined_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (org_id, user_id),
    UNIQUE KEY uk_org_member_user (org_id, user_id),
    INDEX idx_org_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Organization Invites ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_invites (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    org_id              INT UNSIGNED NOT NULL,
    email               VARCHAR(255) NOT NULL,
    role                ENUM('admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
    invite_token        VARCHAR(100) NOT NULL UNIQUE COMMENT 'Token sent in invite link',
    invited_by_user_id  INT UNSIGNED NOT NULL,
    expires_at          TIMESTAMP NOT NULL COMMENT 'Invite link expiry (7 days)',
    accepted_at         TIMESTAMP NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_org_invite_token (invite_token),
    INDEX idx_org_invites_email (email),
    INDEX idx_org_invites_org_id (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Expense Categories ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NULL COMMENT 'NULL = global/system category',
    org_id          INT UNSIGNED NULL COMMENT 'NULL = personal category',
    name            VARCHAR(100) NOT NULL,
    icon            VARCHAR(50) NOT NULL DEFAULT 'receipt',
    color           VARCHAR(7) NOT NULL DEFAULT '#64748B',
    is_system       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = system-created, not deletable',
    sort_order      INT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    UNIQUE KEY uk_category_user_org_name (user_id, org_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Backfill existing documents with user_id=1 ──────────────────────────────────
UPDATE ocr_documents SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;

-- Make user_id NOT NULL now that all existing docs belong to user 1
ALTER TABLE ocr_documents
    MODIFY COLUMN user_id INT UNSIGNED NOT NULL COMMENT 'Owner user ID';

-- Add organization_id column
ALTER TABLE ocr_documents
    ADD COLUMN organization_id INT UNSIGNED NULL
    AFTER user_id;

ALTER TABLE ocr_documents
    ADD INDEX idx_documents_org_id (organization_id);

-- ── Trigger: Auto-create default categories for new users ──────────────────────
DELIMITER ;;

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
END;;

DELIMITER ;
