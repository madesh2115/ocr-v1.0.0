# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OCR V1.00 is an Expo SDK 54 (React Native) mobile app paired with a Python Flask OCR API. The app lets users scan or upload bill/receipt images, sends them to the Python API for OCR processing, and displays extracted data including vendor, date, totals, tax, and line items.

## Commands

### Mobile App
```powershell
npm install
npm run start       # Start Expo dev server
npm run android     # Start for Android
npm run ios         # Start for iOS
npm run web         # Start for web
npx expo-doctor     # Check Expo configuration
```

### Python OCR API
```powershell
cd api
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The API runs on port 5000. On first startup it auto-creates the `ocr_v1_00` MySQL database and tables.

## Architecture

### Mobile App (`src/App.tsx`)
Single-file React Native component using Expo. Screen state machine (`splash` → `home` → `scan` → `extracting` → `result`) manages navigation without a router.

Key features:
- **Image capture**: Camera or gallery via `expo-image-picker`
- **Crop detection**: Calls `POST /detect-crop` on the Python API; falls back to a hardcoded receipt crop if the API is unreachable
- **Interactive crop box**: User can drag corners to adjust the crop region before extraction
- **Extraction**: Sends image + crop box to `POST /extract`; shows animated scan line during processing

API base URL resolution (in order):
1. `Constants.expoConfig.extra.apiBaseUrl` from `app.json`
2. Expo host URI (for LAN development)
3. Default `http://127.0.0.1:5000`

### Python API (`api/app.py`)
Flask app with two OCR engines (tried in order):
1. **EasyOCR** — primary, uses `torch`/`torchvision`
2. **Tesseract** (via `pytesseract` + `Pillow`) — fallback if EasyOCR is unavailable

Key endpoints:
- `POST /detect-crop` — returns a `crop_box` (x, y, width, height as normalized 0-1 floats) for the bill region
- `POST /extract` — crops the image, runs OCR, parses bill data, saves to MySQL, returns structured JSON
- `GET /documents` / `GET /documents/<id>` — retrieve stored documents
- `POST /learn` — store corrected vendor/item name aliases to improve future parsing
- `GET /health` — engine and database status

### Database (MySQL)
Tables auto-created on API startup:
- `ocr_documents` — main document records
- `ocr_line_items` — per-document line items
- `ocr_learning_examples` — correction history
- `ocr_item_aliases` — vendor-specific item name corrections

Environment variables for DB connection (`api/app.py`):
- `OCR_DB_NAME`, `OCR_DB_HOST`, `OCR_DB_PORT`, `OCR_DB_USER`, `OCR_DB_PASSWORD`
- Defaults connect to MySQL on `127.0.0.1:3306` with `root`/empty password

## Configuration

**`app.json`** — Expo config. Update `extra.apiBaseUrl` to the computer's LAN IP when running on a physical phone (not `localhost`).

**`eas.json`** — EAS Build configuration for building the APK/IPA.

**`api/requirements.txt`** — Python dependencies. `torch` and `torchvision` are large; EasyOCR works without GPU so `gpu=False` is hardcoded.
