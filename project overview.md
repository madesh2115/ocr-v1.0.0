# OCR V1.00 Project Overview

## 📱 Project Description
OCR V1.00 is a full-stack mobile application that acts like a smart document scanner. It allows users to capture or upload images of bills, invoices, and receipts, automatically detects the document boundaries, extracts text using Optical Character Recognition (OCR), and intelligently parses the data into structured formats (Vendor, Date, Totals, Tax, Line Items). 

## 🛠️ Technology Stack

### Frontend (Mobile App)
* **Framework:** React Native with Expo (v54.0.35)
* **Language:** TypeScript
* **Navigation:** React Navigation (`@react-navigation/native` & `stack`)
* **Key Libraries:**
  * `expo-image-picker` (Camera and Gallery access)
  * `expo-haptics` (Tactile feedback)
  * `expo-sharing` & `expo-clipboard` (Data sharing)
  * `@expo/vector-icons` (UI Icons)

### Backend (API & Processing)
* **Framework:** Python Flask
* **OCR Engines:** EasyOCR (Primary, Deep Learning based) and PyTesseract (Fallback)
* **Image Processing:** OpenCV (`cv2`) and NumPy for auto-crop detection and image preprocessing
* **Database:** MySQL (using `PyMySQL`)
* **Regex Engine:** Python's built-in `re` module for advanced text parsing.

---

## ✨ Core Functionalities & Options Added

### 1. Smart Scanning & Auto-Crop
* **Upload/Capture:** Users can select an image from their gallery or snap a live photo.
* **Auto Document Detection:** The backend analyzes the image using OpenCV to detect the paper's edges automatically, providing an intelligent initial crop box (just like premium document scanner apps).
* **Manual Adjustment:** Users can smoothly adjust the crop box corners if the auto-detection needs tweaking.

### 2. Intelligent Data Extraction
* **OCR Processing:** The backend crops the image to the user's boundaries and feeds it through EasyOCR.
* **Advanced Parsing Logic:** The raw text is passed through sophisticated regex patterns and layout analysis to extract:
  * **Header Info:** Document Type, Vendor Name, Date, Invoice Number.
  * **Tax Details:** GSTIN/Tax ID, CGST, SGST, IGST, and GST rates.
  * **Totals:** Subtotal, Grand Total, Net Amount, Round Off.
  * **Line Items:** Intelligently parses tabular data into Item Name, Quantity, Rate/MRP, and Total Amount.
* **Pharmacy Bill Support:** Added specialized logic to handle complex Indian pharmacy bills (e.g., extracting totals from "Disc / Amt" rows, and ignoring trailing labels like "Salesman ID" or "Total Items").

### 3. Data Review & Editing
* **Result Screen:** Presents the extracted data in a clean, categorized format.
* **Editable Fields:** Users can manually correct any OCR mistakes directly in the app.
* **Line Item Management:** Users can edit, add, or delete line items if the OCR missed or hallucinated data.

### 4. Data Persistence & JSON Storage
* **Database Integration:** The extracted data is stored in a MySQL database across structured tables (`ocr_documents`, `ocr_line_items`).
* **Proper JSON Saving:** When a user corrects the data and hits "Save", the app sends the complete updated object back to the server. The server stores this in a `parsed_json` column.
* **Reliable Retrieval:** When fetching saved documents, the server automatically decodes the `parsed_json` string back into a proper JSON object so the frontend can seamlessly display the correct, updated data structure.

### 5. Responsive & Modern UI
* Dynamic font scaling and layout adjustments to ensure the app looks great across different device sizes.
* Real-time progress indicators replacing fake animations for a more authentic user experience.
* Haptic feedback added to button presses and actions for a premium feel.

---

## 🔄 System Workflow

1. **User Action:** The user launches the app and selects "Start OCR" on the `HomeScreen`.
2. **Image Selection:** On the `ScanScreen`, the user picks an image or takes a photo.
3. **Auto-Crop Detection:** The image is sent to the backend `/detect-crop` endpoint, which returns coordinates for the document boundaries.
4. **Cropping:** The user confirms the crop box. The image and coordinates are sent to the backend.
5. **Extraction:** The `ExtractingScreen` shows a loading state while the backend crops the image, runs OCR, and parses the text into structured JSON.
6. **Review:** The parsed JSON is returned to the `ResultScreen`.
7. **Correction & Saving:** The user reviews the data, makes necessary corrections, and taps "Save". The app sends a `POST` request to `/documents/<id>/update`, which stores the finalized, corrected JSON in the MySQL database.
