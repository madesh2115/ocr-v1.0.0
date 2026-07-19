# OCR V1.00

Expo SDK 54 mobile app plus a Python OCR API for scanning or uploading bills, receipts, invoices, and ticket-like documents.

## Screens

1. Splash
2. Home
3. Scan or Upload
4. Extracting
5. Result

## Mobile App

```powershell
npm install
npm run start
```

The app is pinned to Expo SDK 54 through `expo: ~54.0.35`.

Update the API IP in `app.json` under `expo.extra.apiBaseUrl`. On a real phone, use your computer LAN IP, not `localhost`.

## Python OCR API

```powershell
cd api
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

API endpoint:

```text
POST http://localhost:5000/extract
multipart/form-data field: image
```

EasyOCR is used first. If EasyOCR is not installed, the API tries Tesseract through `pytesseract`.
