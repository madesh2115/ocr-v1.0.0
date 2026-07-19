-- Migration 001: Add enhanced columns to existing OCR tables
-- Safe for existing data — all new columns are nullable with defaults.
-- Run against the existing MySQL database before deploying the enhanced API.
--
-- Usage:
--   mysql -u root -p ocr_db < migrations/001_add_enhanced_columns.sql
--
-- Verify:
--   DESCRIBE ocr_documents;

-- ── ocr_documents enhancements ─────────────────────────────────────────────────

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS user_id           INT          NULL  COMMENT 'Authenticated user who uploaded this document'
  AFTER ocr_engine;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS expense_category   VARCHAR(100) NULL  COMMENT 'Expense category (e.g. food, travel, supplies)'
  AFTER user_id;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS review_status     ENUM('pending','reviewed','corrected','approved') DEFAULT 'pending'
  COMMENT 'Human review state of this extraction'
  AFTER expense_category;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS corrected_by_user VARCHAR(255) NULL  COMMENT 'Display name/email of reviewer who last corrected'
  AFTER review_status;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMP    NULL  ON UPDATE CURRENT_TIMESTAMP
  COMMENT 'When the document was last reviewed'
  AFTER corrected_by_user;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS image_hash        VARCHAR(64)  NULL  COMMENT 'SHA-256 hex digest of the original image bytes'
  COMMENT 'Deduplication — prevents storing the same bill image twice'
  AFTER address;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS digital_copy_path VARCHAR(500) NULL  COMMENT 'Absolute path to the generated Pillow PNG receipt'
  COMMENT 'Set automatically by the API after store_document()'
  AFTER parsed_json;

ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS pdf_path          VARCHAR(500) NULL  COMMENT 'Absolute path to generated PDF (future)'
  AFTER digital_copy_path;

-- ── ocr_documents index for deduplication ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_documents_image_hash
  ON ocr_documents(image_hash)
  COMMENT 'Fast lookup by image hash for deduplication checks';

-- ── ocr_documents index for user queries ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_documents_user_id
  ON ocr_documents(user_id)
  COMMENT 'Fast lookup by user for their document list';

CREATE INDEX IF NOT EXISTS idx_documents_review_status
  ON ocr_documents(review_status)
  COMMENT 'Fast filter by review state';

-- ── ocr_line_items enhancements ───────────────────────────────────────────────

ALTER TABLE ocr_line_items
  ADD COLUMN IF NOT EXISTS expected_total    VARCHAR(30)  NULL  COMMENT 'Computed expected total = rate × qty (from decimal_utils)'
  AFTER gst;

ALTER TABLE ocr_line_items
  ADD COLUMN IF NOT EXISTS totals_match     VARCHAR(30)  NULL  COMMENT 'EXACT | APPROXIMATE | MISSING | VALIDATION_ERROR'
  COMMENT 'Result of validate_line_item_totals() check'
  AFTER expected_total;

ALTER TABLE ocr_line_items
  ADD COLUMN IF NOT EXISTS discrepancy      VARCHAR(20)  NULL  COMMENT '|actual − expected| as a Decimal string'
  AFTER totals_match;

-- ── ocr_item_aliases enhancement (optional) ───────────────────────────────────

ALTER TABLE ocr_item_aliases
  ADD COLUMN IF NOT EXISTS use_count        INT UNSIGNED DEFAULT 1
  COMMENT 'How many times this alias has been applied'
  AFTER corrected_name;

-- ── View: document summary with review flags ─────────────────────────────────
-- Useful for admin dashboards.

CREATE OR REPLACE VIEW v_document_review_list AS
SELECT
  d.id,
  d.vendor,
  d.date_text,
  d.invoice_number,
  d.total,
  d.currency,
  d.confidence,
  d.expense_category,
  d.review_status,
  d.reviewed_at,
  d.corrected_by_user,
  COUNT(i.id)          AS line_item_count,
  SUM(i.totals_match = 'validation_error') AS error_line_count
FROM ocr_documents d
LEFT JOIN ocr_line_items i ON i.document_id = d.id
GROUP BY d.id;
