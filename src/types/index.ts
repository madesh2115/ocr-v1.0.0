// ── Shared TypeScript types for the OCR mobile app ───────────────────────────
export type Confidence = number; // 0.0–1.0

// ── Crop screen types ────────────────────────────────────────────────────
export type NormalizedPoint = { x: number; y: number };
export type ImageRect = { left: number; top: number; width: number; height: number };

export type FourCorners = {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
};


// ── Nested sub-types (new normalized schema) ──────────────────────────────────

export type VendorAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string; // always "India"
};

export type DocumentInfo = {
  type: string;              // e.g. "invoice", "receipt", "bill"
  invoice_number: string | null;
  date: string | null;      // ISO 8601 YYYY-MM-DD
  time: string | null;       // ISO 24-hour HH:MM
  currency: string;         // INR, USD, EUR …
  language: string;          // "en"
  prices_include_tax: 'yes' | 'no' | null;
};

export type VendorInfo = {
  name: string | null;
  branch: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  fssai_number: string | null;
  address: VendorAddress;
};

export type TransactionInfo = {
  payment_method: string | null;
  expense_category: string | null;
  notes: string | null;
};

export type AmountSummary = {
  subtotal: string | null;
  discount: string;          // always "0.00" or a decimal string
  cgst: string;             // "0.00" or decimal string
  sgst: string;
  igst: string;
  cess: string;
  tax_total: string;         // cgst + sgst + igst + cess
  round_off: string;
  grand_total: string | null;
};

export type LineItem = {
  // ── New normalized field names ───────────────────────────────────────────
  id: number | null;
  name: string | null;
  description: string | null;
  hsn_code: string | null;
  quantity: string;          // always 3dp e.g. "1.000"
  unit: string;             // "item"
  unit_price: string | null;
  gross_amount: string | null;
  discount: string;         // "0.00"
  tax_rate: string | null;  // e.g. "5.00"
  tax_amount: string | null;
  total: string | null;
  confidence: Confidence | null;
  manually_corrected: boolean;
  // ── Legacy / flat aliases (backward compat) ───────────────────────────────
  item_name?: string | null;  // alias for name
  text?: string | null;       // raw OCR text
  rate?: string | null;       // alias for unit_price
  amount?: string | null;     // alias for total
  gst?: string | null;        // original GST string e.g. "5%"
  raw_text?: string | null;
  learned?: boolean;
  // ── Validation fields ───────────────────────────────────────────────────
  totals_match?: 'exact' | 'approximate' | 'missing' | 'validation_error' | string;
  expected_total?: string | null;
  discrepancy?: string | null;
};

export type DocumentFiles = {
  original_image_url: string | null;
  cropped_image_url: string | null;
  digital_copy_url: string | null;
  pdf_url: string | null;
};

export type VerificationInfo = {
  status: 'unreviewed' | 'reviewed' | 'corrected' | 'approved';
  corrected_by_user: boolean;
  reviewed_at: string | null;      // ISO datetime
  total_matches_items: boolean | null;
  tax_calculation_valid: boolean | null;
  duplicate_suspected: boolean;
  warnings: string[];              // human-readable warning messages
};

export type OcrMetadata = {
  engine: string | null;          // "easyocr" | "pytesseract"
  overall_confidence: Confidence | null;
  processing_time_ms: number | null;
};

// ── Validation sub-types ────────────────────────────────────────────────────────

export type TaxValidationWarning = {
  message: string;
  severity: 'error' | 'warning';
  diff?: string | null;
};

export type GstinValidation = {
  valid: boolean;
  formatted: string | null;
  error: string | null;
};

export type DateValidation = {
  valid: boolean;
  parsed: string | null;   // ISO 8601 YYYY-MM-DD
  error: string | null;
};

export type BillValidation = {
  line_items: LineItem[];
  tax_warnings: Record<string, TaxValidationWarning>;
  price_includes_tax: 'yes' | 'no' | null;
  gstin: GstinValidation;
  date: DateValidation;
};

// ── The complete extraction result ──────────────────────────────────────────────
// Matches api/app.py parse_bill() merged output (new schema + flat aliases).

export type ExtractionResult = {

  // ── New normalized schema (primary) ───────────────────────────────────────
  schema_version: string;           // "1.0"
  document_id: number | null;
  document: DocumentInfo;
  vendor: VendorInfo;
  transaction: TransactionInfo;
  amounts: AmountSummary;
  line_items: LineItem[];
  files: DocumentFiles;
  verification: VerificationInfo;
  ocr_metadata: OcrMetadata;

  // ── Raw OCR data (always included for mobile app) ─────────────────────────
  raw_text: string;
  lines: string[];
  ocr_rows?: OcrRow[];

  // ── Flat aliases (backward compat — mobile app reads these directly) ──────
  // These duplicate data already present in the nested schema above.
  document_type?: string;
  date?: string | null;           // alias for document.date (raw format)
  invoice_number?: string | null;
  tax_id?: string | null;          // alias for vendor.gstin
  subtotal?: string | null;
  grand_total?: string | null;
  round_off?: string | null;
  tax?: string | null;
  gst_rate?: string | null;
  cgst?: string | null;
  sgst?: string | null;
  cess?: string | null;
  total?: string | null;           // alias for amounts.grand_total
  currency?: string;
  payment_method?: string | null;  // alias for transaction.payment_method
  phone?: string | null;            // alias for vendor.phone
  email?: string | null;            // alias for vendor.email
  address?: string | null;          // raw flat address string

  // ── Confidence & fields ─────────────────────────────────────────────────
  confidence?: Confidence;          // overall document confidence
  fields?: ExtractedField[];       // per-field display list

  // ── Database ─────────────────────────────────────────────────────────────
  database_saved?: boolean;
  database_status?: string;
  database_error?: string | null;
  ocr_engine?: string;

  // ── Image URLs ──────────────────────────────────────────────────────────
  original_image_url?: string | null;
  cropped_image_url?: string | null;
  image_url?: string | null;      // cropped image URL
  digital_receipt_url?: string | null;

  // ── Financial validation ────────────────────────────────────────────────
  validation?: BillValidation;
};

// ── A single extracted bill header field ─────────────────────────────────────

export type ExtractedField = {
  label: string;
  value: string | number | null;
  confidence?: Confidence | null;
};

// ── OCR row (from EasyOCR / Tesseract) ───────────────────────────────────────

export type OcrRow = {
  cells: string[];
  cell_xs: number[];
  x: number;
  y: number;
  text: string;
  confidence: Confidence | null;
};

// ── API request / response shapes ──────────────────────────────────────────────

export type CropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractRequest = {
  image?: Blob;
  crop_box?: string;
};

export type HealthResponse = {
  status: 'ok';
  ocr_engine: string;
  database: string;
  database_status: string;
  version: string;
};

// ── Navigation ─────────────────────────────────────────────────────────────────

// ── Saved document summary (from GET /documents) ──────────────────────────────

export type SavedDocumentSummary = {
  id: number;
  invoice_number: string | null;
  date: string | null;          // ISO 8601 YYYY-MM-DD
  vendor_name: string | null;
  grand_total: string | null;
  currency: string;
  expense_category: string | null;
  verification_status: 'unreviewed' | 'reviewed' | 'corrected' | 'approved';
  overall_confidence: number | null;
  created_at: string;           // ISO datetime
  updated_at: string;           // ISO datetime
};

// ── Navigation ─────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  OnboardingFlow: undefined;
  AuthFlow: undefined;
  MainFlow: undefined;
  Splash: undefined;
  Home: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  Onboarding: undefined;
  Dashboard: undefined;
  Scan: undefined;
  Crop: { imageUri: string; detectedCorners?: FourCorners; originalWidth: number; originalHeight: number };
  Extracting: { imageUri: string; cropBox: any };
  Result: { result: ExtractionResult; imageUri: string };
  SavedDocuments: undefined;
  DocumentsList: undefined;
  DocumentDetail: { documentId: number };
  Analytics: undefined;
  Profile: undefined;
  AddManualExpense: undefined;
  OrganizationSettings: undefined;
  Settings: undefined;
};
