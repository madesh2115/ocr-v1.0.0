"""
Document Routes — v2
===================
New API endpoints for document detection and perspective-corrected extraction.

Routes
-------
POST /api/v1/documents/detect-crop
    Detect document boundary, return four normalized corner points.

POST /api/v1/documents/extract-v2
    Accept confirmed corners, apply perspective correction, run OCR.
    Compatible with the existing /extract request shape but uses corner-based crop.

POST /api/v1/documents/rotate-and-detect
    Rotate image and re-run detection (for CropScreen rotation feature).
"""

from __future__ import annotations

import io
import json
import os
import time
from typing import Any

from flask import Blueprint, jsonify, request

from services.document_detector import (
    DEBUG,
    detect_document,
    detection_to_response,
)
from services.perspective_service import (
    apply_perspective_crop,
    denormalize_corners,
    perspective_crop_image_bytes,
)
from services.file_storage_service import get_file_url

doc_bp = Blueprint("documents_v1", __name__, url_prefix="/api/v1/documents")

# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB


def _validate_image_bytes(data: bytes) -> tuple[bool, str]:
    if not data:
        return False, "IMAGE_REQUIRED"
    if len(data) > MAX_FILE_SIZE:
        return False, "FILE_TOO_LARGE"
    # Check magic bytes
    magic = data[:8]
    valid_signatures = [
        b"\xff\xd8\xff",       # JPEG
        b"\x89PNG\r\n\x1a\n",  # PNG
        b"\x89Hdf",              # HDF5 (rejects)
        b"GIF87a",
        b"GIF89a",
        b"RIFF",                # WEBP / AVI / WAV
        b"BM",                  # BMP
    ]
    if not any(magic.startswith(sig) for sig in valid_signatures if sig != b"RIFF"):
        # Allow WEBP (RIFF....WEBP)
        if magic[:4] == b"RIFF" and not data[8:12] == b"WEBP":
            return False, "UNSUPPORTED_FORMAT"
    return True, ""


def _api_error(code: str, message: str, status: int = 400) -> tuple[Any, int]:
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


# ─────────────────────────────────────────────────────────────────────────────
#  POST /api/v1/documents/detect-crop
# ─────────────────────────────────────────────────────────────────────────────

@doc_bp.route("/detect-crop", methods=["POST"])
def detect_crop_v1():
    """
    Detect the physical document boundary in an uploaded image.

    Request (multipart/form-data)
    --------------------------------
    image : file  — JPEG/PNG image (max 10 MB)
    debug : bool  — (optional) return intermediate debug masks

    Response 200
    ------------
    {
      "success": true,
      "data": {
        "auto_detected": true,
        "confidence": 0.87,
        "method": "edge_contour",
        "requires_review": false,
        "original_width": 960,
        "original_height": 1280,
        "corners": {
          "top_left":     {"x": 0.147, "y": 0.052},
          "top_right":    {"x": 0.835, "y": 0.041},
          "bottom_right": {"x": 0.842, "y": 0.952},
          "bottom_left":  {"x": 0.139, "y": 0.961}
        }
      }
    }

    Response 4xx
    -----------
    IMAGE_REQUIRED    — no image field
    FILE_TOO_LARGE    — > 10 MB
    UNSUPPORTED_FORMAT — not a recognized image
    """
    if "image" not in request.files:
        return _api_error("IMAGE_REQUIRED", "No image file provided. Use multipart field 'image'.")

    file = request.files["image"]
    image_bytes = file.read()

    valid, err_code = _validate_image_bytes(image_bytes)
    if not valid:
        return _api_error(err_code, "Invalid or unsupported image format.")

    debug_mode = request.form.get("debug", "").lower() in ("1", "true", "yes")

    result = detect_document(image_bytes, debug=debug_mode)
    response = detection_to_response(result)

    if debug_mode and result.debug_images:
        response["_debug"] = {
            k: _mask_to_base64(v) if hasattr(v, "shape") else str(v)
            for k, v in result.debug_images.items()
        }

    return jsonify(response), 200


# ─────────────────────────────────────────────────────────────────────────────
#  POST /api/v1/documents/extract-v2
# ─────────────────────────────────────────────────────────────────────────────

from services.limiter import limiter

@doc_bp.route("/extract-v2", methods=["POST"])
@limiter.limit("10 per minute")
def extract_v2():
    """
    Apply user-confirmed four corners → perspective crop → OCR.

    Request (multipart/form-data)
    --------------------------------
    image        : file   — original oriented image
    corners      : JSON   — confirmed four corners {top_left, top_right, bottom_right, bottom_left}  (normalized 0–1)
    user_id      : int    — (optional) authenticated user ID
    skip_ocr     : bool   — (optional) skip OCR, just do perspective crop + save
    debug        : bool   — (optional) return debug images

    Backend actions
    --------------
    1. Validate image
    2. Parse and validate corners
    3. Denormalize corners to pixel coordinates
    4. Apply perspective warp → cropped_doc.jpg
    5. Generate OCR-enhanced grayscale for text extraction
    6. Run OCR → parse bill data
    7. Save original, cropped_doc, ocr_image to storage
    8. Store in database
    9. Return structured JSON (same shape as existing /extract)
    """
    if "image" not in request.files:
        return _api_error("IMAGE_REQUIRED", "No image file provided.")

    file = request.files["image"]
    image_bytes = file.read()

    valid, err_code = _validate_image_bytes(image_bytes)
    if not valid:
        return _api_error(err_code, "Invalid or unsupported image.")

    corners_raw = request.form.get("corners")
    if not corners_raw:
        return _api_error("CORNERS_REQUIRED", "Normalized corner points are required.")
    try:
        corners = json.loads(corners_raw)
    except json.JSONDecodeError:
        return _api_error("INVALID_CORNERS", "corners must be a valid JSON object.")

    if not isinstance(corners, dict) or len(corners) != 4:
        return _api_error("INVALID_CORNERS", "corners must have exactly 4 keys: top_left, top_right, bottom_right, bottom_left.")

    skip_ocr = request.form.get("skip_ocr", "").lower() in ("1", "true", "yes")
    debug_mode = request.form.get("debug", "").lower() in ("1", "true", "yes")
    user_id = int(request.form.get("user_id", 1))

    # Get original dimensions (from the image itself, not trust from client)
    from PIL import Image as PIL_Image
    try:
        with PIL_Image.open(io.BytesIO(image_bytes)) as im:
            orig_w, orig_h = im.size
    except Exception:
        return _api_error("IMAGE_DECODE_FAILED", "Could not decode image dimensions.")

    # Denormalize corners to pixel coords
    try:
        pixel_corners = denormalize_corners(corners, orig_w, orig_h)
    except Exception as e:
        return _api_error("CORNERS_INVALID", f"Corner conversion failed: {e}")

    # Apply perspective crop
    cropped_bytes, crop_meta = apply_perspective_crop(
        image_bytes=image_bytes,
        corners=corners,
        original_w=orig_w,
        original_h=orig_h,
    )

    if debug_mode:
        return jsonify({
            "success": True,
            "debug": {
                "cropped_image": _bytes_to_base64(cropped_bytes),
                "crop_metadata": crop_meta,
                "pixel_corners": pixel_corners.tolist(),
            }
        }), 200

    if skip_ocr:
        return jsonify({
            "success": True,
            "crop_metadata": crop_meta,
            "message": "Perspective crop applied. OCR skipped (skip_ocr=true)."
        }), 200

    # ── Run OCR on cropped document ─────────────────────────────────────
    try:
        from app import read_ocr, parse_bill
        start_time = time.time()
        ocr = read_ocr(cropped_bytes)
        parsed = parse_bill(ocr, start_time=start_time)
    except Exception as exc:
        return _api_error("OCR_FAILED", f"OCR processing failed: {exc}", 500)

    # ── Save files ─────────────────────────────────────────────────────
    try:
        from app import store_document, save_upload
        from services.file_storage_service import get_file_url
        from werkzeug.datastructures import FileStorage

        # Save original
        original_fs = FileStorage(io.BytesIO(image_bytes), filename="original.jpg", content_type="image/jpeg", name="image")
        original_path = save_upload(original_fs, image_bytes, "original", user_id=user_id)

        # Save cropped perspective-corrected document
        cropped_fs = FileStorage(io.BytesIO(cropped_bytes), filename="cropped.jpg", content_type="image/jpeg", name="image")
        cropped_path = save_upload(cropped_fs, cropped_bytes, "cropped", user_id=user_id)

        # Store and get document_id
        parsed["crop_box"] = crop_meta
        document_id = store_document(parsed, original_path, cropped_path, user_id=user_id)
        parsed["document_id"] = document_id
        parsed["database_saved"] = document_id is not None

        # File URLs
        if document_id:
            parsed["original_image_url"] = get_file_url(user_id, document_id, os.path.basename(original_path))
            parsed["image_url"] = get_file_url(user_id, document_id, os.path.basename(cropped_path))
            parsed["digital_receipt_url"] = get_file_url(user_id, document_id, "digital-copy.png")

    except Exception as exc:
        parsed["database_error"] = str(exc)
        parsed["database_saved"] = False

    parsed["success"] = True
    return jsonify(parsed), 200


# ─────────────────────────────────────────────────────────────────────────────
#  POST /api/v1/documents/rotate-and-detect
# ─────────────────────────────────────────────────────────────────────────────

@doc_bp.route("/rotate-and-detect", methods=["POST"])
def rotate_and_detect():
    """
    Rotate an image by 90° clockwise, then re-run document detection.
    Useful when the user rotates the CropScreen image and needs new corners.

    Request (multipart/form-data)
    --------------------------------
    image     : file
    rotations : int  — number of 90° clockwise rotations to apply (1–3)

    Response: same as /detect-crop
    """
    if "image" not in request.files:
        return _api_error("IMAGE_REQUIRED", "No image provided.")

    file = request.files["image"]
    image_bytes = file.read()

    valid, err_code = _validate_image_bytes(image_bytes)
    if not valid:
        return _api_error(err_code, "Invalid image.")

    try:
        rotations = int(request.form.get("rotations", 1)) % 4
    except ValueError:
        rotations = 1

    from PIL import Image as PIL_Image
    try:
        with PIL_Image.open(io.BytesIO(image_bytes)) as pil:
            rotated = pil.rotate(-90 * rotations, expand=True)   # 90° CW = -90 in PIL (counter-clockwise)
            out_io = io.BytesIO()
            rotated.save(out_io, format=pil.format or "JPEG", quality=95)
            rotated_bytes = out_io.getvalue()
    except Exception as e:
        return _api_error("ROTATION_FAILED", f"Image rotation failed: {e}")

    debug_mode = request.form.get("debug", "").lower() in ("1", "true", "yes")
    result = detect_document(rotated_bytes, debug=debug_mode)
    response = detection_to_response(result)
    return jsonify(response), 200


# ─────────────────────────────────────────────────────────────────────────────
#  Utility
# ─────────────────────────────────────────────────────────────────────────────

def _mask_to_base64(mask: np.ndarray) -> str:
    """Encode a 2D numpy uint8 mask as a small PNG base64 string."""
    import base64
    if PIL_Image is None:
        return ""
    pil_img = PIL_Image.fromarray(mask.astype(np.uint8))
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _bytes_to_base64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode()
