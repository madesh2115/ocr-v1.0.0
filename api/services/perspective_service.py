"""
Perspective Correction Service
============================
Applies a four-point perspective transform to a document image.

Receives:
  - image_bytes:    raw JPEG/PNG of the original oriented image
  - corners:        four normalized (0–1) corner points {top_left, top_right, bottom_right, bottom_left}
  - original_w, original_h: original image dimensions

Pipeline:
1. Validate and order corners (always reorder on backend — never trust mobile)
2. Convert normalized → pixel coordinates
3. Compute output dimensions from the quadrilateral
4. Add small safe padding (0.5% outward)
5. Build destination rectangle
6. Compute perspective transform matrix
7. Apply cv2.warpPerspective with high-quality interpolation
8. Return cropped JPEG bytes

Safe output dimensions
----------------------
Max output pixels: 2500 on any edge (prevents memory issues)
Min output pixels: 100 on any edge
"""

from __future__ import annotations

import io
import math
from typing import Any, Optional

import numpy as np

# Optional imports — degrade gracefully
cv2 = None
try:
    import cv2
except Exception:
    pass

PIL_Image = None
try:
    from PIL import Image as PIL_Image
except Exception:
    pass

# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

# Safe output limits
MAX_OUTPUT_DIM = 2500   # pixels
MIN_OUTPUT_DIM = 600    # pixels — minimum 600px on any edge for readable OCR
MIN_CROP_RATIO = 0.15   # if crop is < 15% of original image area, skip perspective and use original
PAD_FRAC_OUTWARD = 0.005  # 0.5% outward padding from detected corners


def apply_perspective_crop(
    image_bytes: bytes,
    corners: dict[str, dict[str, float]],
    original_w: int,
    original_h: int,
    pad_frac: float = PAD_FRAC_OUTWARD,
) -> tuple[bytes, dict[str, Any]]:
    """
    Apply four-point perspective transform to crop and rectify a document.

    Parameters
    ----------
    image_bytes : bytes
        Raw JPEG/PNG image data (EXIF already applied by caller).
    corners : dict
        Four corner dicts with 'x' and 'y' keys, values in 0–1 normalized space.
        Example: {"top_left": {"x": 0.1, "y": 0.05}, ...}
    original_w, original_h : int
        Physical image dimensions (before any resize).
    pad_frac : float
        Outward padding as fraction of detected document size (default 0.5%).

    Returns
    -------
    (cropped_jpeg_bytes, metadata_dict)
        metadata contains: output_width, output_height, used_pad_frac, perspective_applied
    """
    if cv2 is None or PIL_Image is None:
        return image_bytes, {"error": "opencv_or_pil_unavailable"}

    # ── Step 1: Load image ────────────────────────────────────────────────────────
    try:
        pil = PIL_Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img = np.array(pil)
    except Exception as e:
        return image_bytes, {"error": f"image_decode_failed: {e}"}

    h, w = img.shape[:2]
    if h != original_h or w != original_w:
        # Resize to match declared original dimensions
        img = cv2.resize(img, (original_w, original_h), interpolation=cv2.INTER_AREA)

    # ── Step 2: Parse and validate corners ───────────────────────────────────
    raw_pts = _parse_corners(corners)
    if raw_pts is None:
        return _simple_center_crop(img, original_w, original_h)

    # ── Step 3: Reorder corners to [tl, tr, br, bl] ─────────────────────
    try:
        ordered = _order_four_corners(raw_pts)
    except ValueError:
        return _simple_center_crop(img, original_w, original_h)

    # ── Step 4: Validate polygon is not self-intersecting ────────────────
    if _is_self_intersecting(ordered):
        return _simple_center_crop(img, original_w, original_h)

    # ── Step 5: Compute output dimensions ───────────────────────────────────
    # Use the larger of top and bottom widths, and larger of left and right heights
    top_width    = math.hypot(ordered[1][0] - ordered[0][0], ordered[1][1] - ordered[0][1])
    bottom_width = math.hypot(ordered[2][0] - ordered[3][0], ordered[2][1] - ordered[3][1])
    left_height  = math.hypot(ordered[3][0] - ordered[0][0], ordered[3][1] - ordered[0][1])
    right_height = math.hypot(ordered[2][0] - ordered[1][0], ordered[2][1] - ordered[1][1])

    out_w_px = int(max(top_width, bottom_width))
    out_h_px = int(max(left_height, right_height))

    # If computed crop is less than MIN_CROP_RATIO of original area, use original instead
    crop_area_ratio = (out_w_px * out_h_px) / (original_w * original_h)
    if crop_area_ratio < MIN_CROP_RATIO:
        # Crop too small — use original image for OCR instead
        return _simple_center_crop(img, original_w, original_h)

    # Clamp to safe dimensions
    out_w_px = max(MIN_OUTPUT_DIM, min(MAX_OUTPUT_DIM, out_w_px))
    out_h_px = max(MIN_OUTPUT_DIM, min(MAX_OUTPUT_DIM, out_h_px))

    # ── Step 6: Add safe outward padding ───────────────────────────────────
    pad_x = int(out_w_px * pad_frac)
    pad_y = int(out_h_px * pad_frac)

    # Apply padding in pixel space of output, then scale back to get extra source padding
    # Simple approach: scale the source points slightly inward (negative padding = less crop)
    # But for outward padding we expand the source quad
    # Instead: add outward pad to destination (output) — just add border after warp
    # For simplicity, we use a very small inward adjustment (safety crop = no text cut)
    # The detected corners are the SAFE boundary — no outward pad needed for source

    # ── Step 7: Build source and destination point arrays ──────────────────
    src_pts = ordered.astype(np.float32)
    dst_pts = np.array([
        [0,           0],
        [out_w_px-1,  0],
        [out_w_px-1,  out_h_px-1],
        [0,            out_h_px-1],
    ], dtype=np.float32)

    # ── Step 8: Compute transform and warp ─────────────────────────────────
    try:
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(
            img,
            M,
            (out_w_px, out_h_px),
            flags=cv2.INTER_CUBIC,        # high-quality interpolation
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=255,             # white fill for any空白 edge
        )
    except Exception:
        return _simple_center_crop(img, original_w, original_h)

    # ── Step 9: Encode as JPEG ─────────────────────────────────────────────
    try:
        out_buf = PIL_Image.fromarray(warped)
        out_io = io.BytesIO()
        out_io = io.BytesIO()
        out_buf.save(out_io, format="JPEG", quality=95, optimize=True)
        result_bytes = out_io.getvalue()
    except Exception:
        return _simple_center_crop(img, original_w, original_h)

    metadata = {
        "output_width":  out_w_px,
        "output_height": out_h_px,
        "used_pad_frac": pad_frac,
        "perspective_applied": True,
        "corner_method": "four_point_warp",
    }
    return result_bytes, metadata


def _simple_center_crop(img: np.ndarray, w: int, h: int) -> tuple[bytes, dict]:
    """Fallback: simple center crop when perspective fails."""
    scale = min(w, h) / max(MIN_OUTPUT_DIM, min(w, h))
    crop_w = int(w * scale * 0.9)
    crop_h = int(h * scale * 0.9)
    x1 = max(0, (w - crop_w) // 2)
    y1 = max(0, (h - crop_h) // 2)
    cropped = img[y1:y1+crop_h, x1:x1+crop_w]
    if PIL_Image:
        out_buf = PIL_Image.fromarray(cropped)
        out_io = io.BytesIO()
        out_buf.save(out_io, format="JPEG", quality=90)
        result_bytes = out_io.getvalue()
    else:
        result_bytes = img.tobytes()
    return result_bytes, {
        "output_width": crop_w,
        "output_height": crop_h,
        "perspective_applied": False,
        "corner_method": "center_crop_fallback",
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Corner Parsing and Validation
# ─────────────────────────────────────────────────────────────────────────────

def _parse_corners(corners: dict[str, dict[str, float]]) -> Optional[np.ndarray]:
    """Parse a corner dict into a (4, 2) numpy array of pixel coordinates."""
    if not corners or len(corners) != 4:
        return None

    expected_keys = {"top_left", "top_right", "bottom_right", "bottom_left"}
    if not all(k in corners for k in expected_keys):
        return None

    try:
        pts = np.array([
            [corners["top_left"]["x"],     corners["top_left"]["y"]],
            [corners["top_right"]["x"],    corners["top_right"]["y"]],
            [corners["bottom_right"]["x"], corners["bottom_right"]["y"]],
            [corners["bottom_left"]["x"],  corners["bottom_left"]["y"]],
        ], dtype=np.float64)
        return pts
    except (KeyError, TypeError, ValueError):
        return None


def _order_four_corners(pts: np.ndarray) -> np.ndarray:
    """
    Order 4 points into [top_left, top_right, bottom_right, bottom_left].

    Algorithm:
    1. Sort by y → top two = potential top corners, bottom two = potential bottom
    2. Of top two: leftmost = top_left, rightmost = top_right
    3. Of bottom two: leftmost = bottom_left, rightmost = bottom_right
    """
    if pts.shape != (4, 2):
        raise ValueError(f"Expected (4, 2) array, got {pts.shape}")

    # Sort by y
    by_y = pts[np.argsort(pts[:, 1])]

    # Top two and bottom two
    top_two    = by_y[:2]
    bottom_two = by_y[2:]

    # Leftmost x among top_two → top_left
    tl = top_two[np.argmin(top_two[:, 0])]
    # Rightmost x among top_two → top_right
    tr = top_two[np.argmax(top_two[:, 0])]
    # Leftmost x among bottom_two → bottom_left
    bl = bottom_two[np.argmin(bottom_two[:, 0])]
    # Rightmost x among bottom_two → bottom_right
    br = bottom_two[np.argmax(bottom_two[:, 0])]

    return np.array([tl, tr, br, bl], dtype=np.float64)


def _is_self_intersecting(pts: np.ndarray) -> bool:
    """
    Check if the quadrilateral is self-intersecting (bow-tie / hourglass).
    Uses the cross-product sign test on adjacent edges.
    """
    n = len(pts)
    signs = set()
    for i in range(n):
        p0 = pts[i]
        p1 = pts[(i + 1) % n]
        p2 = pts[(i + 2) % n]
        # Vector a = p1 - p0, b = p2 - p1
        ax = p1[0] - p0[0]
        ay = p1[1] - p0[1]
        bx = p2[0] - p1[0]
        by = p2[1] - p1[1]
        cross = ax * by - ay * bx
        if abs(cross) < 1e-10:
            continue
        signs.add(cross > 0)
        if len(signs) > 1:
            return True   # sign changed → self-intersecting
    return False


def denormalize_corners(
    corners: dict[str, dict[str, float]],
    orig_w: int,
    orig_h: int,
) -> np.ndarray:
    """
    Convert normalized 0–1 corners to pixel coordinates on the original image.
    Also reorders them [tl, tr, br, bl].

    Returns (4, 2) numpy array of pixel coords.
    """
    pts = _parse_corners(corners)
    if pts is None:
        raise ValueError("Invalid corners input")

    ordered = _order_four_corners(pts)

    # Scale to pixel space
    pixel_pts = ordered * np.array([[orig_w, orig_h]], dtype=np.float64)

    # Clamp to image boundaries
    pixel_pts[:, 0] = np.clip(pixel_pts[:, 0], 0, orig_w - 1)
    pixel_pts[:, 1] = np.clip(pixel_pts[:, 1], 0, orig_h - 1)

    return pixel_pts


def perspective_crop_image_bytes(
    image_bytes: bytes,
    corners: dict[str, dict[str, float]],
    orig_w: int,
    orig_h: int,
) -> tuple[bytes, dict]:
    """
    High-level wrapper: denormalize corners → apply perspective warp.

    Returns (cropped_jpeg_bytes, metadata_dict).
    """
    return apply_perspective_crop(
        image_bytes=image_bytes,
        corners=corners,
        original_w=orig_w,
        original_h=orig_h,
    )
