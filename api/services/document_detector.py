"""
Hybrid Document Detector — v2
============================
Detects the physical paper boundary of a bill/receipt/invoice in a mobile camera image.

Returns four normalized corner points (top_left, top_right, bottom_right, bottom_left)
with confidence, method name, and requires_review flag.

Detection pipeline
------------------
1. EXIF orientation correction  (image bytes → rotated numpy array + original size)
2. Resize for detection       (only for speed, coordinates mapped back to original)
3. Edge-based candidates       (Canny + morphological closing + external contours)
4. Brightness-based candidates (Otsu on grayscale + bright paper threshold)
5. Saturation-based candidates (HSV: low-saturation regions = paper-like)
6. Text-region fallback       (black-hat + dilated text bounding boxes → padded rectangle)
7. Candidate scoring           (area, rectangularity, convexity, border contrast, center, aspect)
8. Best-boundary selection
9. Corner ordering and validation
10. Output as normalized {corner_name: {x,y}} dictionary

Scoring weights
---------------
candidate_score =
    rectangularity  * 0.20
  + convexity      * 0.15
  + border_contrast * 0.20
  + edge_continuity * 0.10
  + area_ratio   * 0.10
  + aspect_valid  * 0.05
  + center_score * 0.05
  + text_density * 0.10
  + paper_fill   * 0.05

Confidence thresholds
-------------------
0.80–1.00  : Good boundary, auto-detected, allow manual override
0.60–0.79   : Possible boundary, set requires_review = true
Below 0.60   : Treat as estimate, requires_review = true
Detection fail : Return 5% inset default, auto_detected = false, requires_review = true
"""

from __future__ import annotations

import io
import math
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

# Optional imports — detector degrades gracefully if OpenCV/numpy are unavailable
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
#  Constants
# ─────────────────────────────────────────────────────────────────────────────

# Detection image max edge (pixels). Higher = slower but more accurate edge detection.
# The existing code used 360px — keep it for speed but document the trade-off.
DETECT_MAX_EDGE = 480

# Minimum paper area as fraction of image
MIN_AREA_RATIO = 0.03

# Maximum paper area (allow full-frame receipts)
MAX_AREA_RATIO = 0.98

# Minimum four-corner quality score to accept without fallback
MIN_ACCEPT_SCORE = 0.28

# Acceptable aspect ratio range for receipts/bills
MIN_ASPECT = 0.30     # very tall narrow thermal
MAX_ASPECT = 6.0      # very wide landscape A4

# Padding as fraction of detected dimensions (small safe border)
DEFAULT_PAD_FRAC = 0.008   # 0.8 %

# Fallback inset when all methods fail
FALLBACK_INSET = 0.05   # 5 % inset from each border

# Debug mode — saves intermediate masks (set DEBUG=True to enable)
DEBUG = False


# ─────────────────────────────────────────────────────────────────────────────
#  Data classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DetectedCorners:
    """Four corners of the detected document boundary, in display order."""
    top_left:     tuple[float, float]  # (x_norm, y_norm)  0–1
    top_right:    tuple[float, float]
    bottom_right: tuple[float, float]
    bottom_left:  tuple[float, float]

    def to_dict(self) -> dict[str, dict[str, float]]:
        return {
            "top_left":     {"x": round(self.top_left[0],     4), "y": round(self.top_left[1],     4)},
            "top_right":    {"x": round(self.top_right[0],    4), "y": round(self.top_right[1],    4)},
            "bottom_right": {"x": round(self.bottom_right[0], 4), "y": round(self.bottom_right[1], 4)},
            "bottom_left":  {"x": round(self.bottom_left[0],  4), "y": round(self.bottom_left[1],  4)},
        }

    def to_simple_dict(self) -> dict[str, dict[str, float]]:
        return {
            "top_left":     {"x": round(self.top_left[0],     4), "y": round(self.top_left[1],     4)},
            "top_right":    {"x": round(self.top_right[0],    4), "y": round(self.top_right[1],    4)},
            "bottom_right": {"x": round(self.bottom_right[0], 4), "y": round(self.bottom_right[1], 4)},
            "bottom_left":  {"x": round(self.bottom_left[0],  4), "y": round(self.bottom_left[1],  4)},
        }


@dataclass
class DetectionResult:
    success:         bool
    auto_detected:   bool           # True = algorithm found boundary; False = fallback/default
    confidence:      float          # 0.0–1.0
    requires_review: bool           # True = user should verify corners
    method:          str            # e.g. "edge_contour", "brightness_paper", "text_region", "manual_default"
    corners:         Optional[DetectedCorners]
    original_width:  int            # Physical image width before any resize
    original_height: int
    debug_images:    dict[str, Any] = field(default_factory=dict)  # only populated in DEBUG mode


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

def detect_document(image_bytes: bytes, debug: bool = False) -> DetectionResult:
    """
    Main entry point. Takes raw image bytes, returns DetectionResult.

    Parameters
    ----------
    image_bytes : bytes
        Raw JPEG/PNG image data from mobile camera or gallery.
    debug : bool
        If True, populates debug_images with intermediate masks.

    Returns
    -------
    DetectionResult
        corners.corners is None only if success is False.
    """
    global DEBUG
    if debug:
        DEBUG = True

    # ── Step 1: Load and orient the image ────────────────────────────────────
    oriented, orig_w, orig_h = _load_and_orient(image_bytes)
    if oriented is None:
        return _fallback_result(orig_w, orig_h, "image_load_failed")

    h, w = oriented.shape[:2]

    # ── Step 2: Resize for detection ────────────────────────────────────────
    small, scale = _resize_for_detection(oriented, DETECT_MAX_EDGE)
    sh, sw = small.shape[:2]

    if DEBUG:
        debug_imgs = {"resized": small}
    else:
        debug_imgs = {}

    # ── Step 3: Generate candidate masks ────────────────────────────────────
    edge_mask    = _edge_based_detection(small)
    bright_mask = _brightness_based_detection(small)
    sat_mask    = _saturation_based_detection(small)
    text_mask, text_density = _text_region_detection(small)

    if DEBUG:
        debug_imgs.update({
            "edge_mask":    edge_mask,
            "bright_mask":  bright_mask,
            "sat_mask":     sat_mask,
            "text_mask":    text_mask,
        })

    # ── Step 4: Find contour candidates from each mask ──────────────────────
    candidates: list[dict] = []

    for mask, method_name in [
        (edge_mask,    "edge"),
        (bright_mask,  "brightness"),
        (sat_mask,     "saturation"),
    ]:
        found = _find_contour_candidates(mask, small, method_name, text_density)
        candidates.extend(found)

    # ── Step 5: Text-region fallback ────────────────────────────────────────
    text_candidates = _text_fallback_candidates(text_mask, small, text_density)
    candidates.extend(text_candidates)

    # ── Step 6: Score and rank candidates ────────────────────────────────────
    scored = [_score_candidate(c, small) for c in candidates]
    scored.sort(key=lambda x: x["score"], reverse=True)

    if DEBUG:
        debug_imgs["candidates"] = [
            {"contour": c["contour"], "score": c["score"], "method": c["method"]}
            for c in scored
        ]

    # ── Step 7: Select best candidate ──────────────────────────────────────
    best = scored[0] if scored else None

    if best and best["score"] >= MIN_ACCEPT_SCORE:
        # Derive ordered 4-corner points from the best candidate's approx polygon
        approx = best["approx"]
        # approx is (N, 1, 2) — squeeze to (N, 2)
        approx_pts = approx.reshape(-1, 2) if approx.ndim == 3 else approx

        if len(approx_pts) != 4:
            # For large-area contours touching the image border, minAreaRect produces
            # a box whose dimensions exceed the image (angle ≈ ±90°). Instead, use
            # the bounding rect — it correctly spans the full image for full-frame shots.
            area_ratio = best.get("area_ratio", 0)
            if area_ratio > 0.5:
                x, y, cw, ch = best["bbox"]
                approx_pts = np.array([[x, y], [x+cw, y], [x+cw, y+ch], [x, y+ch]], dtype=np.float64)
            else:
                # Use minAreaRect for smaller centered contours
                rot_rect = best.get("rot_rect")
                if rot_rect is not None:
                    box = cv2.boxPoints(rot_rect)  # returns (4, 2) array
                    approx_pts = box
                else:
                    # Last resort: bounding rect corners
                    x, y, cw, ch = best["bbox"]
                    approx_pts = np.array([[x, y], [x+cw, y], [x+cw, y+ch], [x, y+ch]], dtype=np.float64)
        corners_small = _order_corners(approx_pts)  # (4, 2) array in small image coords
        corners_orig = corners_small / scale         # scale UP from small img to original pixels
        corners_norm = _normalize_corners(corners_orig, orig_w, orig_h)

        confidence = float(best["score"])
        requires_review = confidence < 0.80

        result = DetectionResult(
            success=True,
            auto_detected=True,
            confidence=confidence,
            requires_review=requires_review,
            method=best["method"],
            corners=DetectedCorners(
                top_left=     corners_norm[0],
                top_right=    corners_norm[1],
                bottom_right=  corners_norm[2],
                bottom_left=   corners_norm[3],
            ),
            original_width=orig_w,
            original_height=orig_h,
            debug_images=debug_imgs,
        )
    else:
        result = _fallback_result(orig_w, orig_h, "low_confidence" if best else "no_candidates")
        result.debug_images = debug_imgs

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Image Loading & Orientation
# ─────────────────────────────────────────────────────────────────────────────

def _load_and_orient(image_bytes: bytes):
    """
    Decode image bytes, apply EXIF orientation tag, return RGB numpy array.

    Returns (oriented_rgb, original_width, original_height) or (None, w, h) on failure.
    """
    if PIL_Image is None:
        return None, 0, 0

    try:
        pil = PIL_Image.open(io.BytesIO(image_bytes))
        orig_w, orig_h = pil.size
    except Exception:
        return None, 0, 0

    try:
        exif = pil.getexif()
        orientation = exif.get(0x0112, 1)  # Tag 274 = Orientation
    except Exception:
        orientation = 1

    # Apply EXIF orientation transform
    transform_map = {
        2: PIL_Image.FLIP_LEFT_RIGHT,
        3: PIL_Image.ROTATE_180,
        4: PIL_Image.FLIP_TOP_BOTTOM,
        5: PIL_Image.TRANSPOSE,
        6: PIL_Image.ROTATE_270,
        7: PIL_Image.TRANSVERSE,
        8: PIL_Image.ROTATE_90,
    }
    flip_and_rotate = transform_map.get(orientation)
    if flip_and_rotate:
        pil = pil.transpose(flip_and_rotate)
        # After rotation 90/270, dimensions swap
        if orientation in (6, 8):
            orig_w, orig_h = orig_h, orig_w

    rgb = np.array(pil.convert("RGB"))
    return rgb, orig_w, orig_h


def _resize_for_detection(img: np.ndarray, max_edge: int) -> tuple[np.ndarray, float]:
    """Resize image for faster detection. Returns (resized, scale)."""
    h, w = img.shape[:2]
    if max(h, w) <= max_edge:
        return img, 1.0
    scale = max_edge / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA) if cv2 else img
    return resized, scale


# ─────────────────────────────────────────────────────────────────────────────
#  Mask Generators
# ─────────────────────────────────────────────────────────────────────────────

def _edge_based_detection(img: np.ndarray) -> np.ndarray:
    """
    Edge + morphology + external contours → binary paper-edge mask.
    Works well for receipts placed on contrasting backgrounds.
    """
    if cv2 is None:
        return np.zeros(img.shape[:2], dtype=np.uint8)

    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

    # Automatic Canny — use median to avoid noisy threshold selection
    median = float(np.median(gray))
    lower = int(max(0,   median * 0.5))
    upper = int(min(255, median * 1.8))
    edges = cv2.Canny(gray, lower, upper)

    # Thicken edges to close gaps in broken contours
    kernel = np.ones((3, 3), dtype=np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), dtype=np.uint8), iterations=2)

    # Keep only external (outermost) contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    mask = np.zeros(gray.shape, dtype=np.uint8)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 500:   # tiny contours are noise
            continue
        # Approximate to check if roughly quadrilateral
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
        if 4 <= len(approx) <= 8:
            cv2.drawContours(mask, [cnt], -1, 255, -1)

    return mask


def _brightness_based_detection(img: np.ndarray) -> np.ndarray:
    """
    Otsu thresholding on grayscale + brightness range filter.
    Detects white/bright paper regions.
    Works for receipts on dark or patterned backgrounds.
    """
    if cv2 is None:
        return np.zeros(img.shape[:2], dtype=np.uint8)

    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

    # Otsu's automatic threshold
    _, otsu_thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    otsu_mask = (gray > otsu_thresh).astype(np.uint8) * 255

    # Bright paper filter: high brightness AND low variance (paper is relatively uniform)
    h, w = gray.shape
    block_size = max(15, min(h, w) // 20)
    if block_size % 2 == 0:
        block_size += 1
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, 5
    )

    # Combine: bright AND (otsu OR adaptive)
    bright_mask = cv2.bitwise_or(otsu_mask, adaptive)

    # Clean up noise
    kernel = np.ones((5, 5), dtype=np.uint8)
    bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_OPEN, np.ones((3, 3), dtype=np.uint8), iterations=1)

    return bright_mask


def _saturation_based_detection(img: np.ndarray) -> np.ndarray:
    """
    Low-saturation regions in HSV color space.
    Paper (especially white) has low saturation. Works for receipts on colorful/clothing backgrounds.
    """
    if cv2 is None:
        return np.zeros(img.shape[:2], dtype=np.uint8)

    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)

    # Paper-like: low saturation AND medium-high value
    low_sat = s < 60
    medium_v = s > 40
    paper_like = (low_sat & medium_v).astype(np.uint8) * 255

    # Also include very bright neutral regions (near-white paper)
    bright_neutral = (s < 40) & (v > 200)
    combined = np.maximum(paper_like, bright_neutral.astype(np.uint8) * 255)

    kernel = np.ones((7, 7), dtype=np.uint8)
    mask = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
    return mask


def _text_region_detection(img: np.ndarray) -> tuple[np.ndarray, float]:
    """
    Black-hat morphology to find dark text on light paper.
    Returns (text_mask, text_density).

    text_density = fraction of image area covered by detected text components.
    Used as a signal in candidate scoring.
    """
    if cv2 is None:
        return np.zeros(img.shape[:2], dtype=np.uint8), 0.0

    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

    # Black-hat: dark objects on light background = text
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    black_hat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)

    # Threshold the black-hat result
    _, text_bin = cv2.threshold(black_hat, 12, 255, cv2.THRESH_BINARY)

    # Dilate to connect text characters
    dilated = cv2.dilate(text_bin, np.ones((3, 3), dtype=np.uint8), iterations=2)

    text_density = float(cv2.countNonZero(dilated)) / max(1, dilated.shape[0] * dilated.shape[1])

    return dilated, text_density


# ─────────────────────────────────────────────────────────────────────────────
#  Contour Candidate Finder
# ─────────────────────────────────────────────────────────────────────────────

def _find_contour_candidates(
    mask: np.ndarray,
    img: np.ndarray,
    method_name: str,
    text_density: float,
) -> list[dict]:
    """
    Find large external contours from mask and return candidate dicts.
    Each candidate has keys: contour, method, approx, bbox, area_ratio.
    """
    if cv2 is None:
        return []

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = img.shape[:2]
    img_area = h * w
    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        area_ratio = area / img_area

        # Reject tiny or full-frame contours
        if area_ratio < MIN_AREA_RATIO or area_ratio > MAX_AREA_RATIO:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = ch / max(1, cw)

        # Reject absurd aspect ratios
        if aspect < 0.15 or aspect > 8.0:
            continue

        # Approximate to polygon
        peri = cv2.arcLength(cnt, True)
        if peri < 1:
            continue
        approx = cv2.approxPolyDP(cnt, 0.025 * peri, True)

        # Get rotated bounding rect for convexity / rectangularity scoring
        rot_rect = cv2.minAreaRect(cnt)
        rot_area = rot_rect[1][0] * rot_rect[1][1]

        # Rectangularity: how much of bounding rect is filled by contour
        rectangularity = area / max(1, rot_area)

        # Convexity: contour area / convex hull area
        hull = cv2.convexHull(cnt)
        hull_area = cv2.contourArea(hull)
        convexity = area / max(1, hull_area)

        # Border contrast: mean edge pixel value at contour boundary in original image
        border_contrast = _estimate_border_contrast(cnt, img)

        # Edge continuity: fraction of perimeter that is "straight-ish"
        edge_continuity = _edge_continuity_score(approx, peri)

        # Center score: penalize contours far from image center
        cx = (x + cw / 2) / w
        cy = (y + ch / 2) / h
        center_score = 1.0 - math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2) / 0.71  # normalize by max possible distance

        # Aspect validity: score aspect ratio plausibility for documents
        aspect_score = 1.0 if MIN_ASPECT <= aspect <= MAX_ASPECT else max(0, 1.0 - abs(aspect - 1.0) / 2.0)

        candidate = {
            "method":         method_name,
            "contour":         cnt,
            "approx":          approx,
            "bbox":            (x, y, cw, ch),
            "area_ratio":      area_ratio,
            "aspect":          aspect,
            "rectangularity":  rectangularity,
            "convexity":       convexity,
            "border_contrast": border_contrast,
            "edge_continuity": edge_continuity,
            "center_score":    center_score,
            "aspect_score":     aspect_score,
            "text_density":    text_density,
            "rot_rect":        rot_rect,
        }
        candidates.append(candidate)

    return candidates


def _text_fallback_candidates(
    text_mask: np.ndarray,
    img: np.ndarray,
    text_density: float,
) -> list[dict]:
    """
    When no strong paper boundary is found, use the text region as a fallback.
    Finds bounding boxes of text components and expands to a padded rectangle.
    """
    if cv2 is None:
        return []

    h, w = img.shape[:2]
    contours, _ = cv2.findContours(text_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return []

    # Combine all text components into one bounding box
    all_points = np.vstack(contours)
    x, y, bw, bh = cv2.boundingRect(all_points)

    # Very small text region → ignore
    if (bw * bh) / (w * h) < MIN_AREA_RATIO:
        return []

    # Pad the text region to approximate paper edges
    pad_x = int(bw * 0.15)
    pad_y = int(bh * 0.12)

    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(w - 1, x + bw + pad_x)
    y2 = min(h - 1, y + bh + pad_y)

    # Build a quadrilateral from the padded rectangle (as approx)
    pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float64)

    return [{
        "method":         "text_region",
        "contour":         pts,
        "approx":          pts,
        "bbox":            (x1, y1, x2 - x1, y2 - y1),
        "area_ratio":      ((x2 - x1) * (y2 - y1)) / (w * h),
        "aspect":          (y2 - y1) / max(1, x2 - x1),
        "rectangularity":  1.0,
        "convexity":       1.0,
        "border_contrast": 0.5,
        "edge_continuity": 1.0,
        "center_score":    0.5,
        "aspect_score":    0.8,
        "text_density":    text_density,
        "rot_rect":        (((x1 + x2) / 2, (y1 + y2) / 2), (x2 - x1, y2 - y1), 0),
        "is_text_fallback": True,
    }]


# ─────────────────────────────────────────────────────────────────────────────
#  Candidate Scoring
# ─────────────────────────────────────────────────────────────────────────────

# Scoring weights — tuneable
W_RECTANGULARITY  = 0.20
W_CONVEXITY       = 0.15
W_BORDER_CONTRAST = 0.20
W_EDGE_CONTINUITY = 0.10
W_AREA_RATIO      = 0.10
W_ASPECT_VALID   = 0.05
W_CENTER_SCORE   = 0.05
W_TEXT_DENSITY   = 0.10
W_PAPER_FILL     = 0.05


def _score_candidate(c: dict, img: np.ndarray) -> dict:
    """Compute composite score for a candidate. Adds 'score' key."""
    h, w = img.shape[:2]

    # Rectangularity score (0–1)
    rect_score = float(c.get("rectangularity", 0))

    # Convexity score (0–1)
    conv_score = float(c.get("convexity", 0))

    # Border contrast (0–1): higher = stronger edge = more likely paper boundary
    bc = float(c.get("border_contrast", 0))
    border_score = min(1.0, bc / 80.0)

    # Edge continuity (0–1): how smooth/straight the contour perimeter is
    ec = float(c.get("edge_continuity", 0))
    continuity_score = ec

    # Area ratio score: prefer medium-large areas, penalize tiny and full-frame
    ar = float(c.get("area_ratio", 0))
    if ar < MIN_AREA_RATIO:
        area_score = ar / MIN_AREA_RATIO
    elif ar > 0.80:
        area_score = max(0, 1.0 - (ar - 0.80) / 0.18)
    else:
        area_score = 1.0

    # Aspect validity score
    asp_score = float(c.get("aspect_score", 0))

    # Center score already computed (0–1)
    center_score = float(c.get("center_score", 0.5))

    # Text density score: moderate density is good; very low or very high is suspicious
    td = float(c.get("text_density", 0))
    if td < 0.01:
        text_score = 0.0
    elif td > 0.5:
        text_score = max(0, 1.0 - (td - 0.5) / 0.5)
    else:
        text_score = td / 0.5 * 0.7 + 0.3   # scale 0.01–0.5 → 0.3–1.0

    # Paper fill inside bbox
    x, y, bw, bh = c.get("bbox", (0, 0, w, h))
    if bw > 0 and bh > 0 and cv2 is not None:
        roi = img[y:y+bh, x:x+bw]
        gray_roi = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY) if len(roi.shape) == 3 else roi
        paper_fill = float(np.mean(gray_roi) / 255.0)
    else:
        paper_fill = 0.5

    score = (
        rect_score    * W_RECTANGULARITY
      + conv_score   * W_CONVEXITY
      + border_score * W_BORDER_CONTRAST
      + continuity_score * W_EDGE_CONTINUITY
      + area_score  * W_AREA_RATIO
      + asp_score   * W_ASPECT_VALID
      + center_score * W_CENTER_SCORE
      + text_score  * W_TEXT_DENSITY
      + paper_fill  * W_PAPER_FILL
    )

    c["score"] = round(min(1.0, max(0.0, score)), 4)
    c["border_score"] = border_score
    c["continuity_score"] = continuity_score
    c["text_score"] = text_score
    c["paper_fill"] = paper_fill

    return c


def _estimate_border_contrast(cnt: np.ndarray, img: np.ndarray) -> float:
    """Estimate how strong the edge is at the contour boundary. Higher = clearer paper edge."""
    if cv2 is None or len(cnt) < 4:
        return 30.0

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY) if len(img.shape) == 3 else img

    # Sample pixels just inside and just outside each contour edge
    interior_vals = []
    exterior_vals = []

    for pt in cnt[:min(len(cnt), 40)]:   # sample up to 40 points
        px, py = int(pt[0][0]), int(pt[0][1])
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ix, iy = px + dx, py + dy
            ox, oy = px - dx, py - dy
            if 0 <= ix < w and 0 <= iy < h:
                interior_vals.append(gray[iy, ix])
            if 0 <= ox < w and 0 <= oy < h:
                exterior_vals.append(gray[oy, ox])

    if not exterior_vals:
        # Contour touches image border — use interior variance as proxy for edge strength
        # A full-frame receipt typically has high contrast between paper and background
        if interior_vals:
            contrast = max(30.0, np.std(interior_vals) * 2)
        else:
            contrast = 30.0
    else:
        contrast = abs(np.mean(interior_vals) - np.mean(exterior_vals))

    return float(contrast)


def _edge_continuity_score(approx: np.ndarray, perimeter: float) -> float:
    """
    How straight/continuous the contour edges are.
    Uses the ratio of polygon perimeter to the perimeter of its rotated bounding rect.
    """
    if cv2 is None or len(approx) < 4 or perimeter < 1:
        return 0.5

    # Compute perimeter of the approximated polygon
    poly_perim = sum(
        math.hypot(approx[i][0][0] - approx[(i+1) % len(approx)][0][0],
                   approx[i][0][1] - approx[(i+1) % len(approx)][0][1])
        for i in range(len(approx))
    )

    # Compare to the perimeter of the minAreaRect (perfect rectangle = 1.0)
    rot_rect = cv2.minAreaRect(approx)
    box = cv2.boxPoints(rot_rect)
    box_perim = sum(
        math.hypot(box[i][0] - box[(i+1) % 4][0], box[i][1] - box[(i+1) % 4][1])
        for i in range(4)
    )

    return min(1.0, poly_perim / max(1, box_perim))


# ─────────────────────────────────────────────────────────────────────────────
#  Corner Ordering
# ─────────────────────────────────────────────────────────────────────────────

def _order_corners(corners: np.ndarray) -> np.ndarray:
    """
    Take an array of 4 points (any order) and return them in display order:
    [top_left, top_right, bottom_right, bottom_left].

    Strategy:
    1. Find the top-leftmost point → index 0
    2. Of the remaining 3, find the one with smallest cross product magnitude
       with (top_left → point) — that is top_right
    3. The remaining two: bottom_right is the one farther from top_left
    4. bottom_left is the last remaining
    """
    if isinstance(corners, list):
        corners = np.array(corners, dtype=np.float64)
    if corners.shape != (4, 2):
        raise ValueError(f"Expected 4 points, got {corners.shape}")

    # Sort by y then x to find top-left as anchor
    sorted_by_y = corners[np.argsort(corners[:, 1])]

    # Among the top 2 (top-most points), the left-most is top_left
    top_two = sorted_by_y[:2]
    leftmost_idx = np.argmin(top_two[:, 0])
    top_left = top_two[leftmost_idx]

    # Find the bottom-most point (farthest from top_left by y)
    bottom_idx = np.argmax(corners[:, 1])
    bottom_right = corners[bottom_idx]

    # Remaining two points
    others = [c for i, c in enumerate(corners) if i != bottom_idx and not np.allclose(c, top_left)]
    if len(others) != 2:
        raise ValueError(f"Unexpected remaining points: {others}")

    # Among the 2 remaining, the one with larger x is top_right
    others = sorted(others, key=lambda p: p[0])
    top_right, bottom_left = others[1], others[0]

    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float64)


def _normalize_corners(
    corners: np.ndarray,
    orig_w: int,
    orig_h: int,
) -> list[tuple[float, float]]:
    """Convert pixel corner coordinates to normalized 0–1 coordinates."""
    normalized = []
    for pt in corners:
        nx = min(1.0, max(0.0, pt[0] / orig_w))
        ny = min(1.0, max(0.0, pt[1] / orig_h))
        normalized.append((round(nx, 4), round(ny, 4)))
    return normalized


def _clamp_norm(val: float) -> float:
    return min(1.0, max(0.0, val))


# ─────────────────────────────────────────────────────────────────────────────
#  Fallback
# ─────────────────────────────────────────────────────────────────────────────

def _fallback_result(orig_w: int, orig_h: int, reason: str) -> DetectionResult:
    """
    When all detection methods fail, return a 5% inset default crop.
    This is NOT a confident detection — requires_review = True.
    """
    inset = FALLBACK_INSET
    corners = DetectedCorners(
        top_left=     (_clamp_norm(inset),          _clamp_norm(inset)),
        top_right=    (_clamp_norm(1.0 - inset),    _clamp_norm(inset)),
        bottom_right= (_clamp_norm(1.0 - inset),    _clamp_norm(1.0 - inset)),
        bottom_left=  (_clamp_norm(inset),          _clamp_norm(1.0 - inset)),
    )
    return DetectionResult(
        success=True,
        auto_detected=False,
        confidence=0.15,
        requires_review=True,
        method="manual_default",
        corners=corners,
        original_width=orig_w,
        original_height=orig_h,
        debug_images={},
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Convenience: build the API response dict
# ─────────────────────────────────────────────────────────────────────────────

def detection_to_response(result: DetectionResult) -> dict[str, Any]:
    """
    Convert a DetectionResult into the API response dict format.
    Matches the spec in the task description.
    """
    if result.corners is None:
        corners_dict = {}
    else:
        c = result.corners
        corners_dict = {
            "top_left":     {"x": c.top_left[0],     "y": c.top_left[1]},
            "top_right":    {"x": c.top_right[0],    "y": c.top_right[1]},
            "bottom_right": {"x": c.bottom_right[0], "y": c.bottom_right[1]},
            "bottom_left":  {"x": c.bottom_left[0],  "y": c.bottom_left[1]},
        }

    return {
        "success": result.success,
        "data": {
            "auto_detected": result.auto_detected,
            "confidence": round(result.confidence, 4),
            "method": result.method,
            "requires_review": result.requires_review,
            "original_width": result.original_width,
            "original_height": result.original_height,
            "corners": corners_dict,
        },
    }
