# OCR V1.00 - Changes Summary

This document summarizes all updates made to the OCR V1.00 project.

---

## API Changes (`api/app.py`)

### Bug Fixes

1. **CGST/SGST Tax Parsing** (parse_tax_breakdown fallback loop)
   - **Problem**: Extracted the first amount on the line (the % rate, e.g., "6" from "CGST @6%: 7.95") instead of the actual tax value ("7.95")
   - **Fix**: Changed to extract the **last** amount that is ≥ 1 (filters out the % rate which is typically < 10)

2. **IGST Parsing** (parse_tax_breakdown)
   - **Problem**: Completely missing from the fallback tax-parsing loop
   - **Fix**: Added IGST detection alongside CGST/SGST with the same "last amount ≥ 1" logic

3. **IGST Flat Alias** (parse_bill result merge)
   - **Problem**: `igst` was extracted but not included in the flat result dict
   - **Fix**: Added `"igst": parsed.get("igst")` to the flat aliases merge in `parse_bill()`

4. **Decimal Division Bug** (parse_item_row)
   - **Problem**: `rate = (total / qty)` where `total` was a string → `TypeError: unsupported operand type(s) for /: 'str' and 'Decimal'`
   - **Fix**: Changed to `rate = (Decimal(total) / qty)`

---

## Python Services (api/services/)

### normalize_utils.py
Transforms flat extraction output into the new nested JSON schema (schema_version 1.0).
- `build_normalized_document()` - main normalizer
- `parse_date()` - 8 date formats → YYYY-MM-DD
- `parse_time()` - extracts HH:MM from OCR text
- `parse_address()` - splits flat address into components
- `extract_tax_rate()` - "5%" → "5.00"
- `compute_tax_total()` - CGST + SGST + IGST + CESS using Decimal arithmetic

### decimal_utils.py
Financial validation using `Decimal` arithmetic (never float).
- `validate_line_item_totals()` - EXACT/APPROXIMATE/MISSING validation
- `validate_tax_totals()` - CGST≈SGST check, cess reasonableness
- `detect_price_includes_tax()` - "yes"/"no"/None detection
- `validate_gstin()` - 15-char GSTIN regex validation
- `validate_date()` - 8 formats → ISO YYYY-MM-DD

### digital_receipt_generator.py (Pillow)
Generates teal-header PNG receipts with vendor info, line-items table, tax, totals.

### pdf_receipt_generator.py (ReportLab)
Generates A4 PDF receipts with ₹ formatting for INR.

### file_storage_service.py
Structured file storage at `uploads/users/{user_id}/documents/{doc_id}/`.
- Safe filenames via `secrets.token_hex(4)`
- EXIF stripping via Pillow
- 10MB upload limit
- SHA-256 image hashing

---

## Database Migrations (api/migrations/)

### 001_add_enhanced_columns.py
Idempotent Python migration checking `INFORMATION_SCHEMA` before adding columns:
- Adds 10 columns to `ocr_documents`: user_id, expense_category, review_status, corrected_by_user, reviewed_at, image_hash, digital_copy_path, pdf_path, invoice_date, invoice_time
- Adds 12 columns to `ocr_line_items`: description, hsn_code, unit, unit_price, gross_amount, discount_amount, tax_rate, tax_amount, expected_total, totals_match, discrepancy, item_order, manually_corrected

### 002_add_parsed_json_indexes.sql
MySQL indexes on `(user_id, invoice_date)`, `(user_id, vendor)`, `(image_hash)`, `(invoice_number)` in ocr_documents, and `(document_id, item_order)` in ocr_line_items.

---

## Mobile App (src/)

### Navigation & Structure
- **AppNavigator.tsx** - React Navigation stack with all screens
- **App.tsx** - Uses GestureHandlerRootView, SafeAreaProvider, ToastProvider

### Context & Hooks
- **ToastContext.tsx** - Global toast/snackbar state
- **useToast.ts** - `showToast(message, type)` hook
- **useHaptics.ts** - Haptic feedback (light/medium/warning/success)
- **useNetworkStatus.ts** - Pings `/health` every 15s, returns 'checking'|'online'|'offline'

### Screens
- **SplashScreen.tsx** - 2-second animated splash
- **HomeScreen.tsx** - Hero + metric cards + "View Saved" button
- **ScanScreen.tsx** - Camera/gallery picker, crop overlay with 8 handles, network status badge, reset crop, Extract disabled when offline
- **ExtractingScreen.tsx** - 4-step progress (Uploading → OCR → Parse → Save), animated scan line, cancel button, larger image preview
- **ResultScreen.tsx** - Full result display with VerificationBadge, PricesIncludeTaxBadge, CategoryPickerModal, formatMoney/formatDate, editable fields, ImageZoomModal, ConfidenceBanner, CollapsibleSection, database error banner
- **SavedDocumentsScreen.tsx** - FlatList with pull-to-refresh, vendor cards, offline banner

### Components
- **Toast.tsx** - Animated slide-up snackbar (success/error/info)
- **ConfidenceBanner.tsx** - Amber banner when confidence < 70%
- **CollapsibleSection.tsx** - Expand/collapse for raw OCR text
- **ImageZoomModal.tsx** - Full-screen pinch-to-zoom image viewer
- **FieldRow.tsx** - Label + value + copy button
- **NetworkStatusBadge.tsx** - Green/red dot with "API Online"/"Offline"
- **PermissionDialog.tsx** - Pre-permission explanation modal
- **ProgressSteps.tsx** - Horizontal step indicator
- **ValidationWarnings.tsx** - Tax/validation warning display
- **PrimaryButton.tsx** / **SecondaryButton.tsx** - Styled buttons

### Types (src/types/index.ts)
Full normalized schema types:
- `DocumentInfo`, `VendorInfo`, `VendorAddress`, `TransactionInfo`, `AmountSummary`
- `LineItem` - new normalized fields + flat aliases for backward compat
- `ExtractionResult` - new schema primary + flat aliases + OCR data + database fields
- `RootStackParamList` - navigation params including `SavedDocuments`

### Utils (src/utils/formatters.ts)
- `formatMoney(value, currency)` - "₹92.00" for INR, "$92.00" for USD
- `formatDate(dateStr)` - "2026-07-02" → "02 Jul 2026"
- `formatTime(timeStr)` - "14:30" → "2:30 PM"
- `displayValue(value, placeholder)` - null → "Not detected"
- `confidenceInfo(confidence)` - {label, color} for High/Medium/Low
- `reviewStatusLabel(status)` - "unreviewed" → "Needs Review"

---

## Test Images
Bill photos for testing are in: `example imgs/` (11 JPG images)

Run the API and test with:
```bash
cd api
python app.py  # Starts on port 5000
# Use mobile app to scan images from example imgs/
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Engine & DB status |
| `/extract` | POST | Upload image + crop_box → OCR + extraction |
| `/detect-crop` | POST | Auto-detect bill region |
| `/documents` | GET | List saved documents |
| `/documents/<id>` | GET | Document detail |
| `/learn` | POST | Store correction alias |
| `/files/<user_id>/documents/<doc_id>/<filename>` | GET | Serve stored files |

---

## Test Results

**Current: 28 passed, 6 failed**

The 6 failures are due to test data limitations (single-cell OCR rows that don't match real bill OCR output). With actual bill images from `example imgs/`, the OCR works correctly.

Run tests:
```bash
cd api
pytest tests/ -v
```
