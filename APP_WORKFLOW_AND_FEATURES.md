# OCR V1.00 - App Workflow & Features

## 📱 What is it?
OCR V1.00 is a smart document scanner mobile application built with React Native (Expo) and a Python Flask backend. It allows users to capture or upload images of bills, invoices, and receipts, detects document boundaries, extracts text using Optical Character Recognition (OCR - EasyOCR/PyTesseract), and intelligently parses the data into structured formats (Vendor, Date, Totals, Tax, Line Items).

---

## ✨ What Things Were Added (Recent Features)

The app has recently been upgraded with robust new functionalities, focusing on better parsing, financial accuracy, and data persistence:

### 1. Smart Scanning & Auto-Crop
- **Auto Document Detection:** The backend analyzes the image using OpenCV to detect the paper's edges automatically, providing an intelligent initial crop box.
- **Manual Adjustment:** Smooth 8-handle crop box adjustment on the UI.
- **Network Status:** Offline detection preventing extraction when the API is unreachable.

### 2. Enhanced Data Extraction & Parsing
- **Complex Tax Parsing:** Upgraded to accurately extract CGST, SGST, and IGST by filtering out percentage rates and grabbing the actual tax values.
- **Decimal-based Financials:** Upgraded all financial calculations to use `Decimal` instead of floats to prevent rounding errors.
- **Pharmacy Bill Support:** Specialized logic to handle complex Indian pharmacy bills.
- **Validation:** Added strict validation for Line Item totals and Tax totals.

### 3. Comprehensive Database & Storage
- **Enhanced DB Schema:** Added numerous new columns like `expense_category`, `image_hash`, `digital_copy_path`, and detailed line-item fields (`hsn_code`, `discount_amount`, `tax_rate`, etc.).
- **Proper JSON Saving:** The app sends the complete updated object back to the server. The server stores this in a `parsed_json` column.
- **File Storage:** Secure storage of cropped images with EXIF stripping and SHA-256 hashing.

### 4. Modern UI Components
- **Progress Tracking:** 4-step progress indicator on the `ExtractingScreen` replacing generic loaders.
- **Confidence Banners:** Warns the user when OCR confidence is below 70%.
- **Interactive UI:** Added `ImageZoomModal` for checking the original bill, `CollapsibleSection` for raw text, and haptic feedback across actions.

---

## 🔄 App Workflow (How It Works)

Here is the step-by-step user journey and the system actions that occur behind the scenes:

### Step 1: Launch & Selection
1. **User Action:** The user launches the app and sees the `HomeScreen` with metrics. They tap "Start OCR" to navigate to the `ScanScreen`.
2. **Image Selection:** The user either takes a live photo or selects an existing image from their gallery.

### Step 2: Auto-Crop Detection
1. **System Action:** The image is sent to the backend `/detect-crop` endpoint.
2. **Backend:** OpenCV processes the image to find the document contours and returns the coordinates for the document boundaries.
3. **User Action:** The user sees the crop box overlay, adjusts the corners if necessary, and confirms.

### Step 3: Extraction (OCR & Parsing)
1. **User Action:** The app transitions to the `ExtractingScreen`.
2. **System Action:** The cropped image and coordinates are sent to the `/extract` endpoint.
3. **Backend Processing:**
   - **OCR:** EasyOCR (or PyTesseract) reads the text from the image.
   - **Parsing Logic:** The raw text is passed through regex patterns and layout analysis to extract Header Info, Tax Details, Totals, and Line Items.
   - **Normalization:** The extracted data is normalized into a strict nested JSON schema.

### Step 4: Review & Correction
1. **System Action:** The parsed JSON is returned to the frontend and displayed on the `ResultScreen`.
2. **User Action:** The user reviews the categorized data. They can see validation warnings (e.g., if tax totals mismatch).
3. **Correction:** The user can manually edit fields or manage line items if the OCR missed or hallucinated data.

### Step 5: Finalization & Persistence
1. **User Action:** The user taps "Save" on the corrected data.
2. **System Action:** A `POST` request is sent to `/documents/<id>/update`.
3. **Backend Action:** The finalized, corrected JSON is stored in the MySQL database, making it available for future retrieval on the `SavedDocumentsScreen`.
