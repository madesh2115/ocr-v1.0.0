import io
import json
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    import pymysql
except Exception:
    pymysql = None

try:
    import numpy as np
except Exception:
    np = None

try:
    import cv2
except Exception:
    cv2 = None

try:
    import easyocr

    OCR_ENGINE = "easyocr"
    READER = easyocr.Reader(["en"], gpu=False)
except Exception:
    OCR_ENGINE = "pytesseract"
    READER = None

try:
    import pytesseract
    from PIL import Image
except Exception:
    pytesseract = None
    Image = None

app = Flask(__name__)
CORS(app)

# Initialize Rate Limiter
from services.limiter import limiter
limiter.init_app(app)

# Register blueprints
from routes.auth import auth_bp
from routes.organizations import org_bp
from routes.categories import cat_bp
from routes.analytics import analytics_bp
from routes.document_routes import doc_bp
from routes.subscription_routes import sub_bp
from routes.razorpay_routes import sub_bp as razorpay_sub_bp
from routes.cashfree_routes import sub_bp as cashfree_sub_bp

app.register_blueprint(auth_bp)
app.register_blueprint(org_bp)
app.register_blueprint(cat_bp)
app.register_blueprint(analytics_bp)
app.register_blueprint(doc_bp)
app.register_blueprint(sub_bp)
app.register_blueprint(razorpay_sub_bp)
app.register_blueprint(cashfree_sub_bp)


def api_error(code: str, message: str, fields: dict = None, status_code: int = 400):
    """Consistent API error format."""
    body = {"success": False, "error": {"code": code, "message": message}}
    if fields:
        body["error"]["fields"] = fields
    return jsonify(body), status_code

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "users")
FULL_CROP_BOX = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
SUGGESTED_RECEIPT_CROP = {"x": 0.1, "y": 0.04, "width": 0.8, "height": 0.92}
DB_NAME = os.getenv("OCR_DB_NAME", "ocr_v1_00")
DB_CONFIG = {
    "host": os.getenv("OCR_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("OCR_DB_PORT", "3306")),
    "user": os.getenv("OCR_DB_USER", "root"),
    "password": os.getenv("OCR_DB_PASSWORD", ""),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor if pymysql else None,
}

AMOUNT_PATTERN = re.compile(r"(?:rs\.?|inr|usd|eur|gbp|aed|\$|\u20b9|\u20ac|\u00a3)?\s?[-+]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?", re.IGNORECASE)
DATE_PATTERNS = [
    re.compile(r"\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b"),
    re.compile(r"\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}\b", re.IGNORECASE),
]
SKIP_ITEM_WORDS = (
    "hsn", "code", "gross", "grs", "cgst", "sgst", "cess", "grand", "total items",
    "totalitems", "total item", "round", "amount", "net", "gstin", "time", "date",
    "cash sales", "item(s)", "fssai", "bill no", "thank", "visit", "e, &", "e &",
    "s man", "s.man", "sman", "salesman", "disc",
)


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip(" -:\t|")


def normalize_key(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def normalize_label(value: str) -> str:
    normalized = normalize_key(value)
    normalized = normalized.replace("rouind", "round").replace("roun", "round")
    normalized = normalized.replace("offf", "off").replace("of ", "off ")
    return normalized


def decimal_string(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return f"{Decimal(cleaned):.2f}"
    except InvalidOperation:
        return None


def extract_amounts(text: str) -> List[str]:
    values = []
    for match in AMOUNT_PATTERN.findall(text):
        amount = decimal_string(match)
        if amount is not None:
            values.append(amount)
    return values


def first_match(patterns: List[re.Pattern], text: str) -> Optional[str]:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            return match.group(1) if match.lastindex else match.group(0)
    return None


def find_date(lines: List[str], text: str) -> Optional[str]:
    month_date = re.compile(
        r"\b\d{1,2}\s*[-\/\s]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*[-\/,\s]\s*\d{2,4}\b",
        re.IGNORECASE,
    )
    numeric_date = re.compile(r"\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b")

    for line in lines:
        lower = line.lower()
        if "date" in lower and "time" not in lower:
            match = month_date.search(line) or numeric_date.search(line)
            if match:
                return clean_line(match.group(0))

    match = month_date.search(text)
    if match:
        return clean_line(match.group(0))

    for line in lines:
        lower = line.lower()
        if "time" in lower or "am" in lower or "pm" in lower:
            continue
        match = numeric_date.search(line)
        if match:
            return clean_line(match.group(0))
    return None


def db_connect(database: Optional[str] = DB_NAME):
    if not pymysql:
        return None
    config = dict(DB_CONFIG)
    if database:
        config["database"] = database
    return pymysql.connect(**config)


from services.database_init import run_auto_init
DB_READY, DB_STATUS = run_auto_init()


def check_ocr_db_ready():
    """Check if core OCR tables are accessible. Returns True if accessible, False otherwise."""
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM ocr_documents LIMIT 1")
                return True
    except Exception:
        return False


def group_easyocr_rows(results: List[Any]) -> List[Dict[str, Any]]:
    cells = []
    for entry in results:
        if len(entry) < 2:
            continue
        bbox, text = entry[0], clean_line(str(entry[1]))
        confidence = float(entry[2]) if len(entry) > 2 else None
        if not text:
            continue
        xs = [point[0] for point in bbox]
        ys = [point[1] for point in bbox]
        height = max(ys) - min(ys)
        cells.append({
            "text": text,
            "x": sum(xs) / len(xs),
            "y": sum(ys) / len(ys),
            "height": height,
            "confidence": confidence,
        })

    if not cells:
        return []

    cells.sort(key=lambda cell: (cell["y"], cell["x"]))
    avg_height = sum(max(cell["height"], 8) for cell in cells) / len(cells)
    row_gap = max(12, avg_height * 0.72)
    rows: List[List[Dict[str, Any]]] = []

    for cell in cells:
        if not rows or abs(cell["y"] - (sum(item["y"] for item in rows[-1]) / len(rows[-1]))) > row_gap:
            rows.append([cell])
        else:
            rows[-1].append(cell)

    grouped = []
    for row in rows:
        row.sort(key=lambda cell: cell["x"])
        texts = [cell["text"] for cell in row]
        xs = [cell["x"] for cell in row]
        # Y centre of this row
        y_centre = sum(cell["y"] for cell in row) / len(row)
        grouped.append({
            "cells": texts,
            "cell_xs": xs,
            "x": sum(xs) / len(xs) if xs else 0,
            "y": y_centre,
            "text": clean_line(" ".join(texts)),
            "confidence": sum((cell["confidence"] or 0) for cell in row) / len(row),
        })
    return grouped


def read_ocr(image_bytes: bytes) -> Dict[str, Any]:
    if OCR_ENGINE == "easyocr" and READER:
        if Image:
            try:
                img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                # Downscale to max 960px for faster processing
                max_dim = 960
                if max(img.width, img.height) > max_dim:
                    scale = max_dim / max(img.width, img.height)
                    new_w = max(1, int(img.width * scale))
                    new_h = max(1, int(img.height * scale))
                    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                # Boost contrast for better OCR on receipts
                if cv2 is not None and np is not None:
                    arr = np.array(img)
                    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
                    l_ch, a_ch, b_ch = cv2.split(lab)
                    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                    l_ch = clahe.apply(l_ch)
                    lab = cv2.merge((l_ch, a_ch, b_ch))
                    arr = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
                    img = Image.fromarray(arr)
                out = io.BytesIO()
                img.save(out, format="JPEG", quality=88)
                image_bytes = out.getvalue()
            except Exception as e:
                print(f"EasyOCR preprocessing error: {e}")
        results = READER.readtext(
            image_bytes,
            detail=1,
            paragraph=False,
            batch_size=8,
            width_ths=0.5,
            height_ths=0.5,
            decoder="greedy",
        )
        rows = group_easyocr_rows(results)
        lines = [row["text"] for row in rows if row["text"]]
        confidences = [row["confidence"] for row in rows if row.get("confidence") is not None]
        return {
            "lines": lines,
            "rows": rows,
            "avg_confidence": sum(confidences) / len(confidences) if confidences else 0.65,
        }

    if pytesseract and Image:
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        # Upscale small images for better tesseract accuracy
        if img.width < 800:
            scale = 800 / img.width
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        raw = pytesseract.image_to_string(img, config="--psm 4 --oem 3")
        lines = [clean_line(line) for line in raw.splitlines() if clean_line(line)]
        return {
            "lines": lines,
            "rows": [{"cells": [line], "cell_xs": [0.5], "x": 0.5, "y": float(i) * 20.0, "text": line, "confidence": None} for i, line in enumerate(lines)],
            "avg_confidence": 0.55,
        }

    raise RuntimeError("No OCR engine available. Install easyocr or pytesseract.")



def clamp_crop_box(crop_box: Dict[str, Any]) -> Dict[str, float]:
    x = max(0.0, min(1.0, float(crop_box.get("x", 0))))
    y = max(0.0, min(1.0, float(crop_box.get("y", 0))))
    width = max(0.05, min(1.0 - x, float(crop_box.get("width", 1))))
    height = max(0.05, min(1.0 - y, float(crop_box.get("height", 1))))
    return {"x": x, "y": y, "width": width, "height": height}


def largest_mask_bounds(mask: Any, width: int, height: int) -> Optional[Tuple[int, int, int, int, int]]:
    if np is not None and hasattr(mask, "shape"):
        visited = np.zeros(mask.shape, dtype=bool)

        def is_marked(px: int, py: int) -> bool:
            return bool(mask[py, px])

        def is_visited(px: int, py: int) -> bool:
            return bool(visited[py, px])

        def mark_visited(px: int, py: int) -> None:
            visited[py, px] = True
    else:
        visited = [[False] * width for _ in range(height)]

        def is_marked(px: int, py: int) -> bool:
            return bool(mask[py][px])

        def is_visited(px: int, py: int) -> bool:
            return visited[py][px]

        def mark_visited(px: int, py: int) -> None:
            visited[py][px] = True

    best: Optional[Tuple[int, int, int, int, int]] = None
    for y in range(height):
        for x in range(width):
            if not is_marked(x, y) or is_visited(x, y):
                continue

            stack = [(x, y)]
            mark_visited(x, y)
            min_x = max_x = x
            min_y = max_y = y
            count = 0

            while stack:
                current_x, current_y = stack.pop()
                count += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)

                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if next_x < 0 or next_x >= width or next_y < 0 or next_y >= height:
                        continue
                    if is_visited(next_x, next_y) or not is_marked(next_x, next_y):
                        continue
                    mark_visited(next_x, next_y)
                    stack.append((next_x, next_y))

            if best is None or count > best[4]:
                best = (min_x, min_y, max_x, max_y, count)

    if not best or best[4] < max(80, int(width * height * 0.015)):
        return None
    return best


def build_crop_response(
    left: int,
    top: int,
    right: int,
    bottom: int,
    width: int,
    height: int,
    confidence: float,
    method: str,
) -> Dict[str, Any]:
    left = max(0, min(width - 1, left))
    right = max(left + 1, min(width - 1, right))
    top = max(0, min(height - 1, top))
    bottom = max(top + 1, min(height - 1, bottom))
    return {
        "crop_box": {
            "x": round(left / width, 4),
            "y": round(top / height, 4),
            "width": round((right - left + 1) / width, 4),
            "height": round((bottom - top + 1) / height, 4),
        },
        "confidence": round(confidence, 2),
        "method": method,
    }


def detect_crop_box_cv2(small: Any) -> Optional[Dict[str, Any]]:
    if cv2 is None or np is None:
        return None

    rgb = np.asarray(small)
    if rgb.size == 0:
        return None

    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    paper_mask = (
        ((saturation < 115) & (value > 105))
        | ((saturation < 155) & (value > 155))
        | (gray > 182)
    ).astype("uint8") * 255
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8), iterations=2)
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8), iterations=1)

    text_search_area = cv2.dilate(paper_mask, np.ones((15, 15), np.uint8), iterations=1)
    dark_text = (((gray < 145) & (text_search_area > 0)).astype("uint8")) * 255
    dark_text = cv2.morphologyEx(dark_text, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)

    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(dark_text, 8)
    text_boxes = []
    for label_index in range(1, component_count):
        x, y, box_width, box_height, area = stats[label_index]
        if area < 4 or area > width * height * 0.04:
            continue
        if box_width > width * 0.65 or box_height > height * 0.35:
            continue
        if box_height < 2 or box_width < 2:
            continue
        text_boxes.append((x, y, x + box_width - 1, y + box_height - 1, area))

    if len(text_boxes) >= 8:
        xs1 = np.array([box[0] for box in text_boxes])
        ys1 = np.array([box[1] for box in text_boxes])
        xs2 = np.array([box[2] for box in text_boxes])
        ys2 = np.array([box[3] for box in text_boxes])
        left = int(np.percentile(xs1, 2))
        top = int(np.percentile(ys1, 2))
        right = int(np.percentile(xs2, 98))
        bottom = int(np.percentile(ys2, 98))
        box_width = right - left + 1
        box_height = bottom - top + 1
        area_ratio = (box_width * box_height) / (width * height)
        aspect = box_height / max(1, box_width)

        if 0.08 <= area_ratio <= 0.88 and 0.45 <= aspect <= 5.2:
            pad_x = max(8, int(box_width * 0.12))
            pad_top = max(10, int(box_height * 0.22))
            pad_bottom = max(10, int(box_height * 0.12))
            confidence = min(0.94, 0.42 + min(len(text_boxes), 70) / 120)
            return build_crop_response(
                left - pad_x,
                top - pad_top,
                right + pad_x,
                bottom + pad_bottom,
                width,
                height,
                confidence,
                "paper-text-cluster",
            )

    candidates = []
    masks = [paper_mask]
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 140)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8), iterations=1)
    masks.append(edges)

    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            area_ratio = (box_width * box_height) / (width * height)
            aspect = box_height / max(1, box_width)
            if area_ratio < 0.10 or area_ratio > 0.90 or aspect < 0.45 or aspect > 5.4:
                continue
            contour_area = cv2.contourArea(contour)
            extent = contour_area / max(1, box_width * box_height)
            paper_fill = float(paper_mask[y:y + box_height, x:x + box_width].mean() / 255)
            center_x = (x + box_width / 2) / width
            center_y = (y + box_height / 2) / height
            center_score = 1 - min(0.55, abs(center_x - 0.5)) - min(0.35, abs(center_y - 0.5) * 0.5)
            score = (area_ratio * 0.85) + (paper_fill * 0.65) + (min(extent, 1.0) * 0.2) + (center_score * 0.25)
            candidates.append((score, x, y, x + box_width - 1, y + box_height - 1, area_ratio, paper_fill))

    if not candidates:
        return None

    candidates.sort(reverse=True, key=lambda item: item[0])
    score, left, top, right, bottom, area_ratio, paper_fill = candidates[0]
    if score < 0.72 or paper_fill < 0.30:
        return None

    pad_x = int(width * 0.012)
    pad_y = int(height * 0.012)
    confidence = min(0.92, max(0.38, score / 2))
    return build_crop_response(
        left - pad_x,
        top - pad_y,
        right + pad_x,
        bottom + pad_y,
        width,
        height,
        confidence,
        "paper-contour",
    )


def detect_crop_box(image_bytes: bytes) -> Dict[str, Any]:
    if not Image:
        return {"crop_box": SUGGESTED_RECEIPT_CROP, "confidence": 0.2, "method": "suggested-receipt"}

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    max_edge = 360
    scale = min(1.0, max_edge / max(width, height))
    small = image.resize((int(width * scale), int(height * scale)), Image.Resampling.BILINEAR) if scale < 1 else image
    sw, sh = small.size

    cv2_result = detect_crop_box_cv2(small)
    if cv2_result:
        return cv2_result

    if np is not None:
        data = np.asarray(small, dtype=np.int16)
        brightness = data.mean(axis=2)
        spread = data.max(axis=2) - data.min(axis=2)
        min_channel = data.min(axis=2)
        is_neutral_paper = (brightness >= 165) & (spread <= 45) & (min_channel >= 120)
        is_bright_paper = (brightness >= 205) & (spread <= 75)
        mask = is_neutral_paper | is_bright_paper
        col_counts = mask.sum(axis=0).tolist()
        row_counts = mask.sum(axis=1).tolist()
        paper_mask = mask
    else:
        pixels = small.load()
        col_counts = [0] * sw
        row_counts = [0] * sh
        paper_mask = [[False] * sw for _ in range(sh)]
        for y in range(sh):
            for x in range(sw):
                r, g, b = pixels[x, y]
                brightness = (r + g + b) / 3
                spread = max(r, g, b) - min(r, g, b)
                min_channel = min(r, g, b)
                is_neutral_paper = brightness >= 165 and spread <= 45 and min_channel >= 120
                is_bright_paper = brightness >= 205 and spread <= 75
                is_paper = is_neutral_paper or is_bright_paper
                if is_paper:
                    paper_mask[y][x] = True
                    col_counts[x] += 1
                    row_counts[y] += 1

    component = largest_mask_bounds(paper_mask, sw, sh)
    if component:
        left, top, right, bottom, component_pixels = component
        box_width = right - left + 1
        box_height = bottom - top + 1
        area_ratio = (box_width * box_height) / (sw * sh)
        fill_ratio = component_pixels / max(1, box_width * box_height)
        if 0.10 <= area_ratio <= 0.92 and fill_ratio >= 0.18:
            pad_x = int(sw * 0.02)
            pad_y = int(sh * 0.02)
            left = max(0, left - pad_x)
            right = min(sw - 1, right + pad_x)
            top = max(0, top - pad_y)
            bottom = min(sh - 1, bottom + pad_y)
            box_width = right - left + 1
            box_height = bottom - top + 1
            confidence = min(0.95, max(0.35, fill_ratio + area_ratio))
            return {
                "crop_box": {
                    "x": round(left / sw, 4),
                    "y": round(top / sh, 4),
                    "width": round(box_width / sw, 4),
                    "height": round(box_height / sh, 4),
                },
                "confidence": round(confidence, 2),
                "method": "paper-component",
            }

    min_col_hits = max(8, int(sh * 0.08))
    min_row_hits = max(8, int(sw * 0.08))
    columns = [index for index, count in enumerate(col_counts) if count >= min_col_hits]
    rows = [index for index, count in enumerate(row_counts) if count >= min_row_hits]
    if not columns or not rows:
        return {"crop_box": SUGGESTED_RECEIPT_CROP, "confidence": 0.2, "method": "suggested-receipt"}

    left, right = min(columns), max(columns)
    top, bottom = min(rows), max(rows)
    pad_x = int(sw * 0.015)
    pad_y = int(sh * 0.015)
    left = max(0, left - pad_x)
    right = min(sw - 1, right + pad_x)
    top = max(0, top - pad_y)
    bottom = min(sh - 1, bottom + pad_y)

    box_width = right - left + 1
    box_height = bottom - top + 1
    area_ratio = (box_width * box_height) / (sw * sh)
    confidence = min(0.95, max(0.2, area_ratio * 1.8))

    if area_ratio < 0.12 or area_ratio > 0.94:
        return {"crop_box": SUGGESTED_RECEIPT_CROP, "confidence": 0.2, "method": "suggested-receipt"}

    return {
        "crop_box": {
            "x": round(left / sw, 4),
            "y": round(top / sh, 4),
            "width": round(box_width / sw, 4),
            "height": round(box_height / sh, 4),
        },
        "confidence": round(confidence, 2),
        "method": "paper-threshold-fast",
    }


def crop_image_bytes(image_bytes: bytes, crop_box: Optional[Dict[str, Any]]) -> Tuple[bytes, Dict[str, float]]:
    if not crop_box or not Image:
        return image_bytes, FULL_CROP_BOX

    box = clamp_crop_box(crop_box)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    left = int(box["x"] * width)
    top = int(box["y"] * height)
    right = int((box["x"] + box["width"]) * width)
    bottom = int((box["y"] + box["height"]) * height)
    right = max(left + 10, min(width, right))
    bottom = max(top + 10, min(height, bottom))
    cropped = image.crop((left, top, right, bottom))
    output = io.BytesIO()
    cropped.save(output, format="JPEG", quality=95)
    return output.getvalue(), box


def find_labeled_amount(lines: List[str], labels: List[str]) -> Optional[str]:
    for line in reversed(lines):
        lower = normalize_label(line)
        if any(normalize_label(label) in lower for label in labels):
            amounts = extract_amounts(line)
            if amounts:
                return amounts[-1]
    return None


def find_total_fields(lines: List[str]) -> Dict[str, Optional[str]]:
    net_total = find_labeled_amount(lines, [
        "net amount", "net total", "amount payable", "payable amount", "amount due", "balance due"
    ])
    grand_total = find_labeled_amount(lines, ["grand total", "gross total"])
    round_off  = find_labeled_amount(lines, ["round off", "roundoff", "rounding", "rouind off"])
    subtotal   = find_labeled_amount(lines, ["subtotal", "sub total", "taxable amount", "taxable value"])

    # ── Pharmacy-style grand total detection ─────────────────────────────
    # Pattern: "SGST : 12.13   Disc:   Amt:   509.42"   (all on one line)
    # OR:  line1 = "Disc:  Amt:"  →  line2 = "509.42"  (grand total on next line)
    disc_total = None
    for i, line in enumerate(lines):
        lower = line.lower()
        # Case 1: same-line  "disc ... amt ... <number>"
        if ("disc" in lower or "discount" in lower) and "amt" in lower:
            amounts = extract_amounts(line)
            large = [a for a in amounts if Decimal(a) > Decimal("50")]
            if large:
                disc_total = large[-1]
            else:
                # Case 2: number might be on the VERY NEXT line
                if i + 1 < len(lines):
                    nxt_amounts = extract_amounts(lines[i + 1])
                    nxt_large = [a for a in nxt_amounts if Decimal(a) > Decimal("50")]
                    if nxt_large:
                        disc_total = nxt_large[-1]

        # Case 3: line is just "Amt" label + big number  (e.g. "Amt: 509.42")
        elif lower.strip().startswith("amt") and not re.search(r"\b(item|description|mrp|qty)\b", lower):
            amounts = extract_amounts(line)
            large = [a for a in amounts if Decimal(a) > Decimal("50")]
            if large:
                disc_total = disc_total or large[-1]

    # ── Fallback: last line with "total" but not a summary header ────────
    fallback_total = None
    skip_total_words = (
        "totalitem", "total item", "total items", "s man", "salesman",
        "sman", "description", "disc", "batch",
    )
    for line in reversed(lines):
        lower = line.lower()
        if any(w in lower for w in skip_total_words):
            continue
        if "total" in lower:
            amounts = extract_amounts(line)
            real = [a for a in amounts if Decimal(a) > Decimal("10")]
            if real:
                fallback_total = real[-1]
                break


    total = net_total or disc_total or fallback_total or grand_total
    return {
        "subtotal": subtotal,
        "grand_total": grand_total or disc_total or fallback_total,
        "round_off": round_off,
        "total": total,
    }


def find_vendor(lines: List[str]) -> Optional[str]:
    noise = ("invoice", "bill", "receipt", "tax", "gst", "cash", "date", "phone", "mobile", "time")
    for line in lines[:10]:
        lower = line.lower()
        if len(line) >= 3 and not any(token in lower for token in noise) and not AMOUNT_PATTERN.fullmatch(line):
            return line
    return lines[0] if lines else None


def find_invoice_number(lines: List[str], text: str) -> Optional[str]:
    # First try: labeled patterns like "BillNo C01037216", "Invoice No: ABC-12345"
    label_patterns = [
        re.compile(r"(?:bill\s*no|invoice\s*(?:no|number|#)?|inv\s*(?:no|#)?|receipt\s*(?:no|#)?|order\s*(?:no|#)?)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{3,})", re.IGNORECASE),
    ]
    for line in lines:
        for pattern in label_patterns:
            m = pattern.search(line)
            if m:
                return m.group(1).strip()
    # Second try: standalone alphanumeric code that looks like an invoice number
    standalone = re.compile(r"\b([A-Z]{1,5}[-\/]?\d{4,10})\b")
    for line in lines:
        m = standalone.search(line)
        if m:
            candidate = m.group(1)
            # Avoid GST/PAN numbers (longer than 15 chars) and phone numbers
            if 4 <= len(candidate) <= 16:
                return candidate
    return None


def find_document_type(text: str) -> str:
    lower = text.lower()
    if "tax invoice" in lower or "invoice" in lower:
        return "Invoice"
    if "receipt" in lower:
        return "Receipt"
    if "bill" in lower or "cash sales" in lower:
        return "Bill"
    if "ticket" in lower or "boarding" in lower:
        return "Ticket"
    return "Document"


def find_payment_method(text: str) -> Optional[str]:
    methods = ["cash", "card", "upi", "visa", "mastercard", "bank", "wallet", "paypal", "gpay", "phonepe"]
    lower = text.lower()
    for method in methods:
        if method in lower:
            return method.upper() if method == "upi" else method.title()
    return None


def find_currency(text: str) -> str:
    # If CGST/SGST present it's almost certainly INR (Indian bill)
    if re.search(r"\b(?:cgst|sgst|igst|gstin)\b", text, re.IGNORECASE):
        return "INR"
    if "\u20b9" in text or re.search(r"\binr\b|\brs\.?", text, re.IGNORECASE):
        return "INR"
    if "$" in text or re.search(r"\busd\b", text, re.IGNORECASE):
        return "USD"
    if "\u20ac" in text or re.search(r"\beur\b(?!\s*[:/])", text, re.IGNORECASE):
        return "EUR"
    if "\u00a3" in text or re.search(r"\bgbp\b", text, re.IGNORECASE):
        return "GBP"
    return "INR"


def parse_tax_breakdown(rows: List[Dict[str, Any]], lines: List[str]) -> Dict[str, Optional[str]]:
    for idx, row in enumerate(rows):
        text = normalize_label(row["text"])
        cells = [normalize_label(cell) for cell in row.get("cells", [])]
        has_summary_header = (
            ("gst" in cells and "cgst" in cells and "sgst" in cells)
            or re.search(r"\bgst\b.*\bcgst\b.*\bsgst\b", text)
        )
        if has_summary_header and "gstin" not in text and "hsn" not in text:
            for next_row in rows[idx + 1: idx + 4]:
                amounts = extract_amounts(next_row["text"])
                if len(amounts) >= 2:
                    values = [Decimal(amount) for amount in amounts]
                    tax_values = values[1:] if "%" in next_row["text"] and len(values) > 2 else values
                    total_tax = sum(tax_values)
                    return {
                        "gst_rate": re.search(r"\d+(?:\.\d+)?\s*%", next_row["text"]).group(0).replace(" ", "") if re.search(r"\d+(?:\.\d+)?\s*%", next_row["text"]) else None,
                        "cgst": f"{tax_values[0]:.2f}" if len(tax_values) >= 1 else None,
                        "sgst": f"{tax_values[1]:.2f}" if len(tax_values) >= 2 else None,
                        "cess": f"{tax_values[2]:.2f}" if len(tax_values) >= 3 else None,
                        "tax": f"{total_tax:.2f}",
                    }

    # Find CGST, SGST, and IGST by scanning each line for the label + number on same line.
    # Take the LAST amount (after %) since the first amount(s) are typically the % rate.
    cgst = None
    sgst = None
    igst = None
    for line in lines:
        lower = line.lower()
        if cgst is None and "cgst" in lower:
            after = re.split(r"cgst", line, flags=re.IGNORECASE, maxsplit=1)[-1]
            amounts = extract_amounts(after)
            if amounts:
                # Filter out amounts < 1 (likely just the % number) and take the last valid amount
                candidates = [a for a in amounts if Decimal(a) >= Decimal("1")]
                cgst = candidates[-1] if candidates else amounts[-1]
        if sgst is None and "sgst" in lower:
            after = re.split(r"sgst", line, flags=re.IGNORECASE, maxsplit=1)[-1]
            amounts = extract_amounts(after)
            if amounts:
                candidates = [a for a in amounts if Decimal(a) >= Decimal("1")]
                sgst = candidates[-1] if candidates else amounts[-1]
        if igst is None and "igst" in lower:
            after = re.split(r"igst", line, flags=re.IGNORECASE, maxsplit=1)[-1]
            amounts = extract_amounts(after)
            if amounts:
                candidates = [a for a in amounts if Decimal(a) >= Decimal("1")]
                igst = candidates[-1] if candidates else amounts[-1]
    if cgst or sgst or igst:
        total = Decimal(cgst or "0") + Decimal(sgst or "0") + Decimal(igst or "0")
        return {"gst_rate": None, "cgst": cgst, "sgst": sgst, "igst": igst, "cess": None, "tax": f"{total:.2f}"}
    return {"gst_rate": None, "cgst": None, "sgst": None, "cess": None, "tax": None}


def parse_item_row(
    row: Dict[str, Any],
    col_boundaries: Optional[Dict[str, float]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Parse a single OCR row into a line item.

    Uses column boundaries detected from the table header to disambiguate
    which cells belong to item name vs. numeric fields. Falls back to
    pattern-matching when header info is unavailable.

    Args:
        row: dict with keys `text`, `cells` (list[str]), `confidence` (float),
             and `cell_xs` (list[float], optional) — X centre of each cell.
        col_boundaries: optional dict with keys `name_end`, `rate_start`,
                        `qty_start`, `total_start` as normalised X positions
                        (0.0–1.0 range). When provided, used for column routing.
    """
    text = row["text"]
    lower = text.lower()
    if any(word in lower for word in SKIP_ITEM_WORDS):
        return None
    if re.search(r"\b(batch|exp|expiry|mfg|lot)\b", lower):
        return None

    cells: List[str] = [clean_line(c) for c in row.get("cells", []) if clean_line(c)]
    # Per-cell X centres, if available from grouping
    cell_xs: List[float] = row.get("cell_xs", [])
    row_confidence: float = row.get("confidence") if row.get("confidence") is not None else 0.65

    # ── Column routing via header boundaries ──────────────────────────────────
    def x_to_col(x: float) -> str:
        """Map a cell X centre to a column name using detected boundaries."""
        if col_boundaries:
            if x < col_boundaries.get("rate_start", 0.5):
                return "name"
            if x < col_boundaries.get("qty_start", 0.7):
                return "rate"
            if x < col_boundaries.get("total_start", 0.85):
                return "qty"
            return "total"
        # Fallback: heuristic based on numeric content
        return "name"

    if cells and col_boundaries and cell_xs:
        # Route each cell by X position, then extract
        cols: Dict[str, str] = {"name": "", "rate": "", "qty": "", "total": "", "gst": ""}
        for i, cell in enumerate(cells):
            if "%" in cell:
                cols["gst"] = cell
                continue
            col = x_to_col(cell_xs[i] if i < len(cell_xs) else 0.5)
            if col != "gst":
                cols[col] += " " + cell if cols[col] else cell

        name = clean_line(cols["name"])
        rate_str = clean_line(cols["rate"])
        qty_str = clean_line(cols["qty"])
        total_str = clean_line(cols["total"])
        gst_str = clean_line(cols["gst"])

        # Only accept if we have at least a name + one numeric field with price-like values
        if name and re.search(r"[A-Za-z]", name):
            amounts = extract_amounts(total_str) or []
            total = amounts[-1] if amounts else None
            if total is not None:
                rate_amounts = extract_amounts(rate_str)
                rate = rate_amounts[-1] if rate_amounts else None
                qty_amounts = extract_amounts(qty_str)
                qty_raw = qty_amounts[-1] if qty_amounts else None
                if qty_raw is not None:
                    try:
                        qty = Decimal(qty_str.replace(",", ""))
                    except InvalidOperation:
                        qty = Decimal("1")
                else:
                    qty = Decimal("1")
                if rate is None and qty and qty != Decimal("0"):
                    rate = (Decimal(total) / qty) if qty else total
                return {
                    "item_name": name.upper(),
                    "rate": decimal_string(rate) if rate is not None else None,
                    "quantity": decimal_string(qty),
                    "total": decimal_string(total),
                    "gst": gst_str.replace(" ", "") if gst_str else None,
                    "raw_text": text,
                    "confidence": round(row_confidence, 3),
                }

    # ── Classic pattern-based parsing (used when no header boundaries) ─────────
    gst_match = re.search(r"\b\d+(?:\.\d+)?\s*%", text)

    numeric_cells: List[Tuple[int, Decimal, str]] = []
    text_cells_indices: List[int] = []
    for index, cell in enumerate(cells):
        if "%" in cell:
            continue
        amounts = extract_amounts(cell)
        if amounts and re.match(r"^[\d,.\s]+$", cell):
            numeric_cells.append((index, amounts[-1], cell))
        else:
            text_cells_indices.append(index)

    # 3+ numeric cells: Name [Loc] MRP Qty Total format
    if len(numeric_cells) >= 3:
        first_num_index = numeric_cells[0][0]
        name_parts = [cells[i] for i in range(first_num_index)]
        name = clean_line(" ".join(name_parts))
        if not name:
            name = clean_line(re.split(r"\s+\d", text, maxsplit=1)[0])
        rate = numeric_cells[0][1]
        quantity = decimal_string(numeric_cells[1][1])
        total = numeric_cells[-1][1]
        if len(name) >= 2 and re.search(r"[A-Za-z]", name):
            return {
                "item_name": name.upper(),
                "rate": rate,
                "quantity": quantity,
                "total": total,
                "gst": gst_match.group(0).replace(" ", "") if gst_match else None,
                "raw_text": text,
                "confidence": round(row_confidence, 3),
            }

    # 2 numeric cells: either (rate, total) or (qty, total)
    if len(numeric_cells) == 2:
        first_num_index = numeric_cells[0][0]
        name_parts = [cells[i] for i in range(first_num_index)]
        name = clean_line(" ".join(name_parts))
        first_value = Decimal(numeric_cells[0][1])
        second_value = Decimal(numeric_cells[1][1])
        if name and re.search(r"[A-Za-z]", name):
            if first_value == first_value.to_integral_value() and second_value >= first_value and first_value <= 100:
                quantity = first_value
                total = second_value
                rate = total / quantity if quantity else total
            else:
                rate = first_value
                total = second_value
                quantity = Decimal("1")
            return {
                "item_name": name.upper(),
                "rate": f"{rate:.2f}",
                "quantity": f"{quantity:.2f}",
                "total": f"{total:.2f}",
                "gst": gst_match.group(0).replace(" ", "") if gst_match else None,
                "raw_text": text,
                "confidence": round(row_confidence, 3),
            }

    # Fallback regex: Name  rate  qty  total
    pattern = re.compile(
        r"^(?P<name>[A-Za-z][A-Za-z0-9\s&./'-]+?)\s+"
        r"(?P<rate>\d+(?:\.\d{1,2})?)\s+"
        r"(?P<qty>\d+(?:\.\d{1,3})?)\s+"
        r"(?P<total>\d+(?:\.\d{1,2})?)"
        r"(?:\s+(?P<gst>\d+(?:\.\d+)?\s*%))?"
    )
    match = pattern.search(text)
    if match:
        return {
            "item_name": clean_line(match.group("name")).upper(),
            "rate": decimal_string(match.group("rate")),
            "quantity": decimal_string(match.group("qty")),
            "total": decimal_string(match.group("total")),
            "gst": match.group("gst").replace(" ", "") if match.group("gst") else None,
            "raw_text": text,
            "confidence": round(row_confidence, 3),
        }
    return None



def _detect_column_boundaries(header_row: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """
    From a header row (e.g. 'Description  |  Rate  |  Qty  |  Amount'),
    estimate the normalised X boundaries between columns.

    Returns a dict with keys:
        rate_start  – normalised X where the Rate column begins
        qty_start   – normalised X where the Qty column begins
        total_start – normalised X where the Total/Amt column begins
        name_end    – normalised X where the name column ends
    Returns None if we can't detect meaningful boundaries.
    """
    cells = header_row.get("cells", [])
    cell_xs: List[float] = header_row.get("cell_xs", [])

    if len(cells) < 2 or not cell_xs:
        return None

    # Find numeric-looking cells to infer column positions
    col_positions: List[Tuple[str, float]] = []  # (column_role, x_centre)
    for i, cell in enumerate(cells):
        if i >= len(cell_xs):
            break
        x = cell_xs[i]
        lower = cell.lower().strip()
        if any(w in lower for w in ("mrp", "rate", "price", "unit", "amount", "amt", "total")):
            col_positions.append(("numeric", x))
        elif any(w in lower for w in ("qty", "quantity", "nos", "no")):
            col_positions.append(("qty", x))
        elif any(w in lower for w in ("description", "item", "product", "particulars", "medicine", "name", "particular")):
            col_positions.append(("name", x))

    if not col_positions:
        return None

    # Pick the rightmost numeric column as total_start
    numeric_xs = [x for role, x in col_positions if role == "numeric"]
    qty_xs = [x for role, x in col_positions if role == "qty"]

    total_start = max(numeric_xs) if numeric_xs else 0.75
    qty_start = min(qty_xs) if qty_xs else (total_start * 0.8)
    name_end = min(x for role, x in col_positions if role == "name") if any(r == "name" for r, _ in col_positions) else 0.4
    rate_start = qty_start  # rate and qty are adjacent; we'll differentiate by value

    return {
        "name_end": name_end,
        "rate_start": rate_start,
        "qty_start": qty_start,
        "total_start": total_start,
    }


def find_line_items(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Improved line item parser using Y-row grouping and X-column detection.

    Algorithm
    ---------
    1. Scan for a table-header row to detect column boundaries.
    2. Walk rows top-to-bottom:
         • Skip known non-item rows (GST section, totals, batch info).
         • Attempt parse_item_row with column boundaries (if header found).
         • On failure: check if row looks like a wrapped continuation of the
           previous item name (X overlap / indentation match) and merge.
         • Otherwise accumulate as a pending single-word name.
    3. Return up to 50 items.
    """
    if not rows:
        return []

    items: List[Dict[str, Any]] = []
    col_boundaries: Optional[Dict[str, float]] = None
    in_items_section = False

    # We'll use the average row height from grouping to detect wrapped continuations
    avg_row_height = 0.0
    if rows:
        heights = [abs(rows[i]["y"] - rows[i - 1]["y"]) for i in range(1, len(rows)) if rows[i].get("y") and rows[i - 1].get("y")]
        avg_row_height = sum(heights) / len(heights) if heights else 20.0

    i = 0
    while i < len(rows):
        row = rows[i]
        text = row["text"]
        lower = text.lower()
        label = normalize_label(text)

        # ── 1. Header detection ───────────────────────────────────────────────
        if not in_items_section:
            has_name_col = any(w in label for w in ("description", "item", "product", "particulars", "medicine"))
            has_price_col = any(w in label for w in ("mrp", "rate", "price", "unit"))
            has_qty_col = any(w in label for w in ("qty", "quantity", "no"))
            has_amt_col = any(w in label for w in ("amt", "amount", "total"))
            if (has_name_col or has_price_col) and has_qty_col and has_amt_col:
                in_items_section = True
                col_boundaries = _detect_column_boundaries(row)
                # Advance past the header row itself
                i += 1
                continue
            i += 1
            continue

        # ── 2. Stop-word detection ─────────────────────────────────────────────
        stop_words = (
            "grand total", "net amount", "amount payable", "gst cgst", "cgst sgst",
            "totalitems", "total items", "s man", "salesman", "disc",
            "sgst", "cgst", "igst", "taxable", "tax amount",
        )
        if any(sw in label for sw in stop_words):
            break

        # Skip pure numeric / HSN-only rows that aren't items
        if re.match(r"^\d{4,}\s*$", text):           # HSN codes like "1234 5678"
            i += 1
            continue
        if re.search(r"\bhsn\b", lower) and not extract_amounts(text):
            i += 1
            continue

        # ── 3. Parse item row ──────────────────────────────────────────────────
        parsed = parse_item_row(row, col_boundaries=col_boundaries)

        if parsed:
            # ── 3a. Wrapped-name continuation check ──────────────────────────
            # If the previous item had a short name (<= 2 words) and this row
            # starts at an X position no greater than where the previous name
            # ended, it's probably a continuation line.
            if items:
                prev = items[-1]
                prev_name_words = prev.get("item_name", "").split()
                prev_row = rows[i - 1] if i > 0 else None
                curr_xs = row.get("cell_xs", [])
                curr_first_x = curr_xs[0] if curr_xs else 0.5

                if (len(prev_name_words) <= 2 and prev_row and
                        curr_first_x <= (prev_row.get("cell_xs", [0])[0] if prev_row.get("cell_xs") else 0.5) + 0.05):
                    # Merge as continuation (append text to item name)
                    prev["item_name"] = clean_line(
                        f"{prev['item_name']} {parsed.get('item_name', '')}"
                    ).upper()
                    # Update raw_text
                    prev["raw_text"] = clean_line(f"{prev.get('raw_text', '')} {parsed.get('raw_text', '')}")
                    # Blend confidence (weighted average)
                    prev_c = prev.get("confidence") or 0.65
                    curr_c = parsed.get("confidence") or 0.65
                    prev["confidence"] = round((prev_c + curr_c) / 2, 3)
                    i += 1
                    continue

            items.append(parsed)
            i += 1
            continue

        # ── 4. Not an item row — check for continuation or pending name ─────────
        has_letters = bool(re.search(r"[A-Za-z]", text))
        has_amount = bool(extract_amounts(text))
        row_y = row.get("y", 0)
        row_xs = row.get("cell_xs", [])
        row_first_x = row_xs[0] if row_xs else 0.5

        # Skip batch/expiry/mfg rows
        if re.search(r"\b(batch|exp|expiry|mfg|lot)\b", lower):
            i += 1
            continue

        if has_letters and not has_amount and not any(word in lower for word in SKIP_ITEM_WORDS):
            # This is a text-only row — could be a wrapped item name continuation
            if items and len(text.split()) <= 5:
                prev_item = items[-1]
                prev_row = rows[i - 1] if i > 0 else None
                # Only join if X position is similar or indented left (continuation)
                if prev_row:
                    prev_first_x = prev_row.get("cell_xs", [0])[0] if prev_row.get("cell_xs") else 0.5
                    if row_first_x <= prev_first_x + 0.06:
                        prev_item["item_name"] = clean_line(
                            f"{prev_item['item_name']} {text}"
                        ).upper()
                        prev_item["raw_text"] = clean_line(
                            f"{prev_item.get('raw_text', '')} {text}"
                        )
                        # Slightly lower confidence for merged text
                        prev_c = prev_item.get("confidence") or 0.65
                        curr_c = row.get("confidence") or 0.65
                        prev_item["confidence"] = round((prev_c * 0.6 + curr_c * 0.4), 3)
                        i += 1
                        continue

            # Not a continuation — start a new pending name
            # (we don't create items from single words without price; they'll be
            #  resolved if a numeric row follows on the same or next line)
            i += 1
            continue

        # Skip rows that are purely numeric or HSN/GST related
        if any(word in lower for word in ("hsn", "cgst", "sgst", "cess")):
            i += 1
            continue

        # Unknown row — skip
        i += 1

    return items[:50]


def load_item_aliases(vendor: Optional[str]) -> Dict[str, str]:
    if not check_ocr_db_ready():
        return {}
    vendor_key = normalize_key(vendor)
    try:
        with db_connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT raw_name, corrected_name FROM ocr_item_aliases WHERE vendor_key = %s OR vendor_key = ''",
                    (vendor_key,),
                )
                return {normalize_key(row["raw_name"]): row["corrected_name"] for row in cursor.fetchall()}
    except Exception:
        return {}


def apply_learning(parsed: Dict[str, Any]) -> Dict[str, Any]:
    aliases = load_item_aliases(parsed.get("vendor"))
    if not aliases:
        return parsed
    for item in parsed.get("line_items", []):
        corrected = aliases.get(normalize_key(item.get("item_name")))
        if corrected:
            item["item_name"] = corrected
            item["learned"] = True
    return parsed


def build_fields(parsed: Dict[str, Any], ocr_avg_confidence: float = 0.65) -> List[Dict[str, Any]]:
    ordered = [
        ("Document Type", "document_type"),
        ("Vendor", "vendor"),
        ("Date", "date"),
        ("Invoice Number", "invoice_number"),
        ("GSTIN / Tax ID", "tax_id"),
        ("Subtotal", "subtotal"),
        ("Grand Total", "grand_total"),
        ("Round Off", "round_off"),
        ("Tax", "tax"),
        ("Net Amount", "total"),
        ("Currency", "currency"),
        ("Payment Method", "payment_method"),
        ("Phone", "phone"),
        ("Email", "email"),
        ("Address", "address"),
    ]
    return [
        {
            "label": label,
            "value": parsed.get(key),
            "confidence": round(ocr_avg_confidence, 3) if parsed.get(key) is not None else None,
        }
        for label, key in ordered
    ]


def parse_bill(ocr: Dict[str, Any], start_time: Optional[float] = None) -> Dict[str, Any]:
    lines = ocr["lines"]
    rows = ocr["rows"]
    text = "\n".join(lines)
    compact_text = " ".join(lines)
    totals = find_total_fields(lines)
    tax_breakdown = parse_tax_breakdown(rows, lines)

    parsed: Dict[str, Any] = {
        "document_type": find_document_type(compact_text),
        "vendor": find_vendor(lines),
        "date": find_date(lines, compact_text),
        "invoice_number": find_invoice_number(lines, compact_text),
        "tax_id": first_match([re.compile(r"\b(?:gstin|gst|vat|tin)\s*[:\-]?\s*([A-Z0-9]{8,15})\b", re.IGNORECASE)], compact_text),
        "subtotal": totals["subtotal"],
        "grand_total": totals["grand_total"],
        "round_off": totals["round_off"],
        "tax": tax_breakdown["tax"] or find_labeled_amount(lines, ["tax amount", "total tax", "vat"]),
        "gst_rate": tax_breakdown["gst_rate"],
        "cgst": tax_breakdown["cgst"],
        "sgst": tax_breakdown["sgst"],
        "igst": tax_breakdown.get("igst"),
        "cess": tax_breakdown["cess"],
        "total": totals["total"],
        "currency": find_currency(compact_text),
        "payment_method": find_payment_method(compact_text),
        "phone": first_match([re.compile(r"(?:\+?\d[\d\s\-]{8,}\d)")], compact_text),
        "email": first_match([re.compile(r"[\w.\-+]+@[\w.\-]+\.\w+")], compact_text),
        "address": None,
        "line_items": find_line_items(rows),
        "raw_text": text,
        "lines": lines,
        "ocr_rows": rows,
        "ocr_engine": OCR_ENGINE,
    }

    address_lines = [
        line for line in lines[:12]
        if any(token in line.lower() for token in ["road", "street", "st.", "ave", "nagar", "city", "pin", "zip"])
    ]
    parsed["address"] = ", ".join(address_lines[:2]) if address_lines else None

    filled = sum(1 for key in ["vendor", "date", "invoice_number", "subtotal", "tax", "total", "phone", "email"] if parsed.get(key))
    item_score = min(len(parsed["line_items"]) * 0.04, 0.2)
    parsed["confidence"] = min(0.98, 0.35 + (filled * 0.07) + item_score + (ocr.get("avg_confidence", 0.65) * 0.15))
    parsed = apply_learning(parsed)
    parsed["fields"] = build_fields(parsed, ocr.get("avg_confidence", 0.65))

    # Run financial validation (supports both flat and nested schema)
    from services.decimal_utils import validate_bill
    parsed = validate_bill(parsed)

    # Build new normalized schema and merge on top of flat fields
    from services.normalize_utils import build_normalized_document
    normalized = build_normalized_document(ocr, parsed, start_time=start_time)

    # Merge: normalized schema is the base, flat fields layered on top for
    # backward compatibility with existing callers (mobile app, database save)
    result: Dict[str, Any] = {
        **normalized,             # all new normalized schema fields
        # Flat fields the mobile app and existing code still reads directly:
        "raw_text": text,
        "lines": lines,
        "ocr_rows": rows,
        "validation": parsed.get("validation"),
        # Flat field aliases that some existing code references:
        "vendor": parsed.get("vendor"),
        "total": parsed.get("total"),
        "grand_total": parsed.get("grand_total"),
        "subtotal": parsed.get("subtotal"),
        "tax": parsed.get("tax"),
        "date": parsed.get("date"),
        "document_type": parsed.get("document_type"),
        "invoice_number": parsed.get("invoice_number"),
        "phone": parsed.get("phone"),
        "email": parsed.get("email"),
        "address": parsed.get("address"),
        "currency": parsed.get("currency"),
        "payment_method": parsed.get("payment_method"),
        "confidence": parsed.get("confidence"),
        "fields": parsed.get("fields"),
        "gst_rate": parsed.get("gst_rate"),
        "cgst": parsed.get("cgst"),
        "sgst": parsed.get("sgst"),
        "igst": parsed.get("igst"),
        "cess": parsed.get("cess"),
        "round_off": parsed.get("round_off"),
        "tax_id": parsed.get("tax_id"),
        "ocr_engine": parsed.get("ocr_engine"),
        "database_error": parsed.get("database_error"),
    }

    return result


def save_upload(file_storage, image_bytes: bytes, prefix: str = "scan", user_id: int = 1) -> str:
    from services.file_storage_service import save_upload_file
    abs_path, _ = save_upload_file(file_storage, user_id=user_id, document_id=None, prefix=prefix)
    return abs_path


def _get_user_id_from_request() -> int:
    """
    Attempt to extract user_id from the Authorization header.
    Returns DEFAULT_USER_ID (1) if no valid auth token is present.
    Used for backward compatibility during migration.
    """
    try:
        from services.auth_service import decode_access_token, is_token_revoked
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            payload, err = decode_access_token(token)
            if not err and payload:
                jti = payload.get("jti")
                if jti and is_token_revoked(jti):
                    return 1
                return int(payload["sub"])
    except Exception:
        pass
    return 1  # Default for unauthenticated requests


def store_document(parsed: Dict[str, Any], original_image_path: str, image_path: str, user_id: int = 1) -> Optional[int]:
    """
    Persist a parsed bill record to MySQL and organise its uploaded files
    into the structured per-user, per-document directory.

    Parameters
    ----------
    original_image_path : str
        Absolute path to the original uploaded scan (may be a temp file in the
        user root; will be moved into the document directory).
    image_path : str
        Absolute path to the cropped image used for OCR.  May be identical to
        ``original_image_path`` when no crop box was applied.
    user_id : int
        The authenticated user ID. Defaults to 1 for backward compatibility.
    """
    from services.file_storage_service import (
        get_document_dir,
        get_file_url,
        is_temp_file,
    )

    if not check_ocr_db_ready():
        return None

    try:
        with db_connect() as connection:
            with connection.cursor() as cursor:
                # Insert with a placeholder image_path — updated after file move
                cursor.execute(
                    """
                    INSERT INTO ocr_documents (
                        user_id, image_path, raw_text, parsed_json, ocr_engine, expense_category
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        user_id,
                        image_path,  # temp path for now; updated below
                        parsed.get("raw_text"),
                        json.dumps(parsed, ensure_ascii=False),
                        parsed.get("ocr_engine"),
                        parsed.get("expense_category"),
                    ),
                )
                document_id = cursor.lastrowid

                # ── Move uploaded files from temp root into structured dir ───────
                doc_dir = get_document_dir(user_id, int(document_id))
                os.makedirs(doc_dir, exist_ok=True)

                # Original scan
                orig_ext = os.path.splitext(original_image_path)[1] or ".jpg"
                final_orig = os.path.join(doc_dir, f"original{orig_ext}")
                if is_temp_file(original_image_path):
                    if os.path.exists(final_orig):
                        try:
                            os.remove(final_orig)
                        except Exception:
                            pass
                    os.rename(original_image_path, final_orig)
                else:
                    final_orig = original_image_path

                # Cropped image (may be same as original if no crop was applied)
                crop_ext = os.path.splitext(image_path)[1] or ".jpg"
                final_crop = os.path.join(doc_dir, f"cropped{crop_ext}")
                if is_temp_file(image_path) and image_path != original_image_path:
                    if os.path.exists(final_crop):
                        try:
                            os.remove(final_crop)
                        except Exception:
                            pass
                    os.rename(image_path, final_crop)
                else:
                    final_crop = final_orig

                # ── Generate digital receipt into the document directory ─────────
                digital_path = None
                try:
                    from services.digital_receipt_generator import save_digital_receipt
                    digital_path = save_digital_receipt(
                        parsed,
                        user_id=user_id,
                        document_id=int(document_id),
                    )
                    parsed["digital_receipt_url"] = get_file_url(user_id, int(document_id), "digital-copy.png")
                except Exception as gen_exc:
                    print(f"Digital receipt generation failed: {gen_exc}")

                # Store final file URLs in parsed for the API response
                parsed["original_image_url"] = get_file_url(user_id, int(document_id), os.path.basename(final_orig))
                parsed["image_url"] = get_file_url(user_id, int(document_id), os.path.basename(final_crop))
                parsed["document_id"] = int(document_id)

                # Update DB with final paths and complete parsed_json
                cursor.execute(
                    """
                    UPDATE ocr_documents 
                    SET image_path = %s,
                        digital_copy_path = %s,
                        parsed_json = %s
                    WHERE id = %s
                    """,
                    (final_crop, digital_path, json.dumps(parsed, ensure_ascii=False), document_id),
                )
            connection.commit()
            return int(document_id)
    except Exception as exc:
        parsed["database_error"] = str(exc)
        return None


@app.get("/health")
def health():
    return jsonify({"ok": True, "ocr_engine": OCR_ENGINE, "database": DB_STATUS, "database_ready": DB_READY})


@app.get("/files/<int:user_id>/documents/<int:document_id>/<filename>")
def serve_file(user_id: int, document_id: int, filename: str):
    """
    Serve uploaded files from the structured per-user, per-document directory.

    URL pattern: /files/<user_id>/documents/<document_id>/<filename>
    Blocks path traversal — filename must not contain '..' or absolute paths.
    Correct Content-Type is inferred from the file extension.
    """
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        return api_error("INVALID_IMAGE", "Invalid filename")

    from flask import send_from_directory
    from services.file_storage_service import get_document_dir

    # Resolve the document directory for the given user/document pair
    doc_dir = get_document_dir(user_id, document_id)
    return send_from_directory(doc_dir, filename)


@app.get("/")
def index():
    return jsonify({
        "name": "OCR V1.00 API",
        "database": DB_NAME,
        "health": "/health",
        "extract": "POST /extract with multipart form field 'image'",
        "learn": "POST /learn with document_id and corrected_json",
    })


@app.get("/extract")
def extract_help():
    return jsonify({
        "error": "GET is only a help response. Upload an image with POST /extract using multipart field 'image'.",
        "method": "POST",
        "field": "image",
    }), 405


@app.post("/detect-crop")
def detect_crop():
    if "image" not in request.files:
        return api_error("IMAGE_REQUIRED", "No image file provided. Use multipart field name 'image'.")
    image_bytes = request.files["image"].read()
    if not image_bytes:
        return api_error("IMAGE_REQUIRED", "Uploaded image is empty.")
    return jsonify(detect_crop_box(image_bytes))


@app.post("/extract")
def extract():
    if "image" not in request.files:
        return api_error("IMAGE_REQUIRED", "No image file provided. Use multipart field name 'image'.")

    file = request.files["image"]
    image_bytes = file.read()
    if not image_bytes:
        return api_error("IMAGE_REQUIRED", "Uploaded image is empty.")

    try:
        import time as time_module
        start_time = time_module.time()

        # Try to get authenticated user_id from token (optional for backward compat)
        user_id = _get_user_id_from_request()

        # Pass a fresh BytesIO so save_upload can read the bytes without stream exhaustion
        from io import BytesIO
        original_path = save_upload(
            __import__("werkzeug.datastructures").datastructures.FileStorage(
                BytesIO(image_bytes),
                filename=file.filename,
                content_type=file.content_type,
                name=file.name,
            ),
            image_bytes, "original", user_id=user_id,
        )
        crop_payload = request.form.get("crop_box")
        crop_box = json.loads(crop_payload) if crop_payload else None
        cropped_bytes, used_crop_box = crop_image_bytes(image_bytes, crop_box)
        image_path = save_upload(
            __import__("werkzeug.datastructures").datastructures.FileStorage(
                BytesIO(cropped_bytes),
                filename=file.filename,
                content_type=file.content_type,
                name=file.name,
            ),
            cropped_bytes, "cropped", user_id=user_id,
        ) if crop_box else original_path
        ocr = read_ocr(cropped_bytes)
        parsed = parse_bill(ocr, start_time=start_time)
        parsed["crop_box"] = used_crop_box
        document_id = store_document(parsed, original_path, image_path, user_id=user_id)
        parsed["document_id"] = document_id
        parsed["database_saved"] = document_id is not None
        parsed["database_status"] = DB_STATUS
        parsed["database_error"] = parsed.get("database_error")
        return jsonify(parsed)
    except Exception as exc:
        return api_error("OCR_FAILED", str(exc), status_code=500)


@app.get("/documents")
def documents():
    """List documents for the authenticated user (or org)."""
    if not check_ocr_db_ready():
        return api_error("DATABASE_ERROR", "OCR database not accessible", status_code=503)
    user_id = _get_user_id_from_request()
    org_id = request.args.get("org_id", type=int) or None
    category = request.args.get("category")
    search = request.args.get("search")
    limit = request.args.get("limit", 100, type=int)

    if org_id:
        extra = "AND organization_id = %s"
        params: list = [user_id, org_id]
    else:
        extra = "AND organization_id IS NULL"
        params = [user_id]

    if category:
        extra += " AND expense_category = %s"
        params.append(category)

    if search:
        extra += " AND JSON_UNQUOTE(JSON_EXTRACT(parsed_json, '$.vendor')) LIKE %s"
        params.append(f"%{search}%")

    params.append(limit)

    with db_connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id, parsed_json, image_path, created_at, organization_id, expense_category
                FROM ocr_documents
                WHERE user_id = %s {extra}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                params,
            )
            rows = cursor.fetchall()
            docs = []
            for row in rows:
                try:
                    parsed = json.loads(row["parsed_json"]) if row.get("parsed_json") else {}
                except Exception:
                    parsed = {}
                docs.append({
                    "id": row["id"],
                    "document_type": parsed.get("document_type"),
                    "vendor_name": parsed.get("vendor"),
                    "date": parsed.get("date"),
                    "invoice_number": parsed.get("invoice_number"),
                    "subtotal": parsed.get("subtotal"),
                    "tax": parsed.get("tax"),
                    "grand_total": parsed.get("grand_total"),
                    "round_off": parsed.get("round_off"),
                    "total": parsed.get("total"),
                    "currency": parsed.get("currency"),
                    "payment_method": parsed.get("payment_method"),
                    "expense_category": parsed.get("expense_category") or row.get("expense_category"),
                    "organization_id": row["organization_id"],
                    "image_path": row["image_path"],
                    "created_at": str(row["created_at"]),
                })
            return jsonify({"success": True, "documents": docs})


@app.get("/documents/<int:document_id>")
def document_detail(document_id: int):
    """Get a single document (must belong to authenticated user or org)."""
    if not check_ocr_db_ready():
        return api_error("DATABASE_ERROR", "OCR database not accessible", status_code=503)
    user_id = _get_user_id_from_request()
    org_id = request.args.get("org_id", type=int) or None

    with db_connect() as connection:
        with connection.cursor() as cursor:
            if org_id:
                cursor.execute(
                    "SELECT id, parsed_json, image_path, created_at FROM ocr_documents WHERE id = %s AND user_id = %s AND organization_id = %s",
                    (document_id, user_id, org_id),
                )
            else:
                cursor.execute(
                    "SELECT id, parsed_json, image_path, created_at FROM ocr_documents WHERE id = %s AND user_id = %s AND organization_id IS NULL",
                    (document_id, user_id),
                )
            row = cursor.fetchone()
            if not row:
                return api_error("DOCUMENT_NOT_FOUND", "Document not found", status_code=404)
            
            try:
                document = json.loads(row["parsed_json"]) if row.get("parsed_json") else {}
            except Exception:
                document = {}

            from services.file_storage_service import get_file_url

            document["id"] = row["id"]
            if row.get("image_path"):
                document["image_url"] = get_file_url(user_id, row["id"], os.path.basename(row["image_path"]))
                document["original_image_url"] = get_file_url(user_id, row["id"], "original.jpg")
                document["digital_receipt_url"] = get_file_url(user_id, row["id"], "digital-copy.png")
            return jsonify({"success": True, "document": document})


@app.post("/documents")
def create_document():
    """
    Create a manual expense (no image) for the authenticated user.
    Accepts JSON body with all expense fields.
    """
    if not check_ocr_db_ready():
        return api_error("DATABASE_ERROR", "OCR database not accessible", status_code=503)

    user_id = _get_user_id_from_request()
    payload = request.get_json(force=True, silent=True) or {}

    vendor = (payload.get("vendor") or "").strip()
    grand_total = payload.get("grand_total") or payload.get("total")
    if not vendor or not grand_total:
        return api_error("MISSING_FIELDS", "vendor and grand_total (or total) are required.", status_code=400)

    try:
        with db_connect() as connection:
            with connection.cursor() as cursor:
                # Add default fields for manual entry
                payload["document_id"] = None
                payload["success"] = True
                
                cursor.execute(
                    """
                    INSERT INTO ocr_documents (
                        user_id, raw_text, parsed_json, ocr_engine, organization_id, expense_category
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        user_id,
                        payload.get("raw_text", ""),
                        json.dumps(payload, ensure_ascii=False),
                        "manual",
                        payload.get("organization_id"),
                        payload.get("expense_category"),
                    ),
                )
                document_id = int(cursor.lastrowid)
                payload["id"] = document_id
                payload["document_id"] = document_id
                
                cursor.execute(
                    "UPDATE ocr_documents SET parsed_json = %s WHERE id = %s",
                    (json.dumps(payload, ensure_ascii=False), document_id),
                )
            connection.commit()

            return jsonify({"success": True, "document": payload}), 201
    except Exception as exc:
        return api_error("DATABASE_ERROR", str(exc), status_code=500)


@app.post("/learn")
def learn():
    if not check_ocr_db_ready():
        return api_error("DATABASE_ERROR", "OCR database not accessible", status_code=503)

    payload = request.get_json(force=True, silent=True) or {}
    document_id = payload.get("document_id")
    corrected = payload.get("corrected_json") or payload.get("corrected") or {}
    original = payload.get("original_json") or {}
    vendor_before = original.get("vendor")
    vendor_after = corrected.get("vendor", vendor_before)
    vendor_key = normalize_key(vendor_after or vendor_before)

    with db_connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO ocr_learning_examples (document_id, vendor_before, vendor_after, corrected_json)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, vendor_before, vendor_after, json.dumps(corrected, ensure_ascii=False)),
            )

            original_items = original.get("line_items") or []
            corrected_items = corrected.get("line_items") or []
            for old_item, new_item in zip(original_items, corrected_items):
                raw_name = old_item.get("item_name") or old_item.get("text")
                corrected_name = new_item.get("item_name") or new_item.get("text")
                if raw_name and corrected_name and normalize_key(raw_name) != normalize_key(corrected_name):
                    cursor.execute(
                        """
                        INSERT INTO ocr_item_aliases (vendor_key, raw_name, corrected_name, use_count)
                        VALUES (%s, %s, %s, 1)
                        ON DUPLICATE KEY UPDATE corrected_name = VALUES(corrected_name), use_count = use_count + 1
                        """,
                        (vendor_key, raw_name, corrected_name),
                    )
        connection.commit()

    return jsonify({"ok": True, "message": "Learning data saved"})


@app.post("/documents/<int:document_id>/update")
def update_document_record(document_id: int):
    """Update a document (must belong to authenticated user)."""
    if not check_ocr_db_ready():
        return api_error("DATABASE_ERROR", "OCR database not accessible", status_code=503)

    user_id = _get_user_id_from_request()
    payload = request.get_json(force=True, silent=True) or {}

    try:
        with db_connect() as connection:
            with connection.cursor() as cursor:
                # Verify ownership
                cursor.execute(
                    "SELECT id FROM ocr_documents WHERE id = %s AND user_id = %s",
                    (document_id, user_id),
                )
                if not cursor.fetchone():
                    return api_error("DOCUMENT_NOT_FOUND", "Document not found", status_code=404)
                cursor.execute(
                    """
                    UPDATE ocr_documents
                    SET expense_category = %s,
                        parsed_json = %s
                    WHERE id = %s AND user_id = %s
                    """,
                    (
                        payload.get("expense_category"),
                        json.dumps(payload, ensure_ascii=False),
                        document_id,
                        user_id,
                    )
                )
            connection.commit()
        return jsonify({"success": True, "message": "Document updated successfully"})
    except Exception as exc:
        return api_error("DATABASE_ERROR", str(exc), status_code=500)


if __name__ == "__main__":
    print(f"Starting OCR V1.00 API with {OCR_ENGINE}")
    print(f"MySQL status: {DB_STATUS}")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
