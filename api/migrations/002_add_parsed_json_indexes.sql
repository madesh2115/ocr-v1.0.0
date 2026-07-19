-- Migration 002: Add performance indexes for parsed_json and common queries
-- MySQL-compatible (no IF NOT EXISTS on indexes — run only on fresh schema
-- or after dropping stale indexes; safe to re-run on an already-migrated DB).
--
-- Usage:
--   mysql -u root -p ocr_v1_00 < migrations/002_add_parsed_json_indexes.sql
--
-- Drop stale indexes first (optional, run only if needed):
--   DROP INDEX idx_documents_image_hash ON ocr_documents;
--   DROP INDEX idx_documents_user_id ON ocr_documents;
--   DROP INDEX idx_documents_review_status ON ocr_documents;

-- ── ocr_documents indexes ───────────────────────────────────────────────────────

-- Composite index for user dashboard queries: documents by user + date range
CREATE INDEX idx_documents_user_date ON ocr_documents(user_id, invoice_date);

-- Composite index for user vendor search / reporting
CREATE INDEX idx_documents_user_vendor ON ocr_documents(user_id, vendor);

-- Fast image deduplication lookup
CREATE INDEX idx_documents_image_hash ON ocr_documents(image_hash);

-- Fast lookup by invoice number (common for search / duplicate detection)
CREATE INDEX idx_documents_invoice_number ON ocr_documents(invoice_number);

-- ── ocr_line_items indexes ──────────────────────────────────────────────────────

-- Efficient join + ordering for line item retrieval
CREATE INDEX idx_line_items_document_order ON ocr_line_items(document_id, item_order);

-- ── ocr_learning_examples indexes ───────────────────────────────────────────────

-- Fast lookup of correction history by vendor key
CREATE INDEX idx_learning_vendor ON ocr_learning_examples(vendor_after(100));

-- ── Verify ─────────────────────────────────────────────────────────────────────
-- SHOW INDEX FROM ocr_documents;
-- SHOW INDEX FROM ocr_line_items;
-- SHOW INDEX FROM ocr_learning_examples;
