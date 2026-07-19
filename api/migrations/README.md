# OCR V1.00 Database Migrations

MySQL-compatible migrations for the `ocr_v1_00` database.

## Prerequisites

- Python 3.8+
- `pymysql` installed (`pip install -r requirements.txt`)
- MySQL 5.7+ running on the host/port configured in your environment (or defaults: `127.0.0.1:3306`, user `root`, no password)

## Running Migrations

### Step 1 — Python migration (columns)

Run the Python script **before** deploying the enhanced API. It checks column existence before adding, so it is safe to re-run on an already-migrated database.

```bash
cd api
python migrations/001_add_enhanced_columns.py
```

Expected output:
```
============================================================
Migration 001: Adding enhanced columns to OCR tables
============================================================
Connecting to MySQL at 127.0.0.1:3306 ...
Connected.

Using database: ocr_v1_00

[ ocr_documents ]
  Added column user_id to ocr_documents... OK
  Added column expense_category to ocr_documents... OK
  ...
============================================================
Migration 001 complete.
============================================================
```

### Step 2 — SQL migration (indexes)

After the Python migration (or on a fresh DB that already has the columns), apply the indexes:

```bash
cd api
mysql -u root -p ocr_v1_00 < migrations/002_add_parsed_json_indexes.sql
```

Or from within MySQL:

```sql
SOURCE path/to/migrations/002_add_parsed_json_indexes.sql;
```

## What Each Migration Does

### 001_add_enhanced_columns.py

Adds nullable columns with defaults to existing tables. **Does not drop or modify existing columns or data.**

**`ocr_documents`新增列：**
| Column | Type | Description |
|---|---|---|
| `user_id` | INT NULL | Authenticated user who uploaded |
| `expense_category` | VARCHAR(100) NULL | Category (food, travel, etc.) |
| `review_status` | ENUM('unreviewed','needs_review','reviewed') | Review state |
| `corrected_by_user` | BOOLEAN DEFAULT FALSE | User corrected flag |
| `reviewed_at` | DATETIME NULL | Last review timestamp |
| `image_hash` | VARCHAR(128) NULL | SHA-256 of original image |
| `digital_copy_path` | VARCHAR(500) NULL | Path to generated PNG |
| `pdf_path` | VARCHAR(500) NULL | Path to generated PDF |
| `invoice_date` | DATE NULL | Parsed from date_text |
| `invoice_time` | TIME NULL | Parsed from date_text |

**`ocr_line_items`新增列：**
| Column | Type | Description |
|---|---|---|
| `description` | TEXT NULL | Item description |
| `hsn_code` | VARCHAR(50) NULL | HSN code |
| `unit` | VARCHAR(50) DEFAULT 'item' | Unit of measure |
| `unit_price` | DECIMAL(12,2) NULL | Price per unit |
| `gross_amount` | DECIMAL(12,2) NULL | Gross before discount |
| `discount_amount` | DECIMAL(12,2) DEFAULT 0.00 | Discount applied |
| `tax_rate` | DECIMAL(7,3) NULL | Tax rate decimal |
| `tax_amount` | DECIMAL(12,2) NULL | Tax amount |
| `expected_total` | VARCHAR(30) NULL | Computed expected total |
| `totals_match` | VARCHAR(30) NULL | EXACT/APPROXIMATE/MISSING |
| `discrepancy` | VARCHAR(20) NULL | |actual - expected| |
| `item_order` | INT UNSIGNED DEFAULT 0 | Sort order |
| `manually_corrected` | BOOLEAN DEFAULT FALSE | Manual correction flag |

**`ocr_item_aliases`新增列：**
| Column | Type | Description |
|---|---|---|
| `use_count` | INT UNSIGNED DEFAULT 1 | Alias usage count |

### 002_add_parsed_json_indexes.sql

Adds performance indexes. Safe to re-run; MySQL will error if an index already exists (use `CREATE INDEX IF NOT EXISTS` is not supported in MySQL — for idempotent behavior, use the Python script instead).

**Indexes added：**
| Table | Index | Columns |
|---|---|---|
| `ocr_documents` | `idx_documents_user_date` | `(user_id, invoice_date)` |
| `ocr_documents` | `idx_documents_user_vendor` | `(user_id, vendor)` |
| `ocr_documents` | `idx_documents_image_hash` | `(image_hash)` |
| `ocr_documents` | `idx_documents_invoice_number` | `(invoice_number)` |
| `ocr_line_items` | `idx_line_items_document_order` | `(document_id, item_order)` |
| `ocr_learning_examples` | `idx_learning_vendor` | `(vendor_after)` |

## Verifying

```sql
-- Check columns were added
DESCRIBE ocr_documents;
DESCRIBE ocr_line_items;
DESCRIBE ocr_item_aliases;

-- Check indexes were created
SHOW INDEX FROM ocr_documents;
SHOW INDEX FROM ocr_line_items;
```

## Rollback

These migrations are additive only — no data is modified or deleted. To rollback, drop the added columns/indexes manually:

```sql
-- Drop columns (will lose data)
ALTER TABLE ocr_documents DROP COLUMN user_id;
ALTER TABLE ocr_documents DROP COLUMN expense_category;
-- ... (repeat for each added column)

-- Drop indexes
DROP INDEX idx_documents_user_date ON ocr_documents;
DROP INDEX idx_documents_user_vendor ON ocr_documents;
-- ... (repeat for each added index)
```
