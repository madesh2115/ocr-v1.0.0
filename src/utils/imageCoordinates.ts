/**
 * imageCoordinates.ts
 * ========================
 * Coordinate conversion utilities for the CropScreen.
 *
 * Problem:
 * The original image has dimensions (origW × origH).
 * The display container has dimensions (containerW × containerH).
 * The image is displayed with resizeMode="contain" → letterboxed.
 *
 * Conversions:
 *
 *  displayX = containerOffsetX + normalizedX * displayedWidth
 *  displayY = containerOffsetY + normalizedY * displayedHeight
 *
 *  normalizedX = (displayX - containerOffsetX) / displayedWidth
 *  normalizedY = (displayY - containerOffsetY) / displayedHeight
 *
 * Clamp normalized values to [0, 1].
 */

export type NormalizedPoint = { x: number; y: number };
export type DisplayPoint = { x: number; y: number };
export type ImageRect = { left: number; top: number; width: number; height: number };

/** Convert normalized (0–1) point → display pixel coordinates */
export function normalizedToDisplay(
  point: NormalizedPoint,
  imgRect: ImageRect
): DisplayPoint {
  return {
    x: imgRect.left + point.x * imgRect.width,
    y: imgRect.top + point.y * imgRect.height,
  };
}

/** Convert display pixel coordinates → normalized (0–1) */
export function displayToNormalized(
  point: DisplayPoint,
  imgRect: ImageRect
): NormalizedPoint {
  const x = (point.x - imgRect.left) / imgRect.width;
  const y = (point.y - imgRect.top) / imgRect.height;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

/** Compute the image rect (display area) given container and image dimensions with resizeMode="contain" */
export function computeImageRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): ImageRect {
  const containerRatio = containerW / containerH;
  const imageRatio = imageW / imageH;

  let displayW: number;
  let displayH: number;
  let left: number;
  let top: number;

  if (imageRatio > containerRatio) {
    // Image is wider — fit to width, letterbox top/bottom
    displayW = containerW;
    displayH = containerW / imageRatio;
    top = (containerH - displayH) / 2;
    left = 0;
  } else {
    // Image is taller — fit to height, letterbox left/right
    displayH = containerH;
    displayW = containerH * imageRatio;
    left = (containerW - displayW) / 2;
    top = 0;
  }

  return { left, top, width: displayW, height: displayH };
}

/** Clamp a normalized point to [0, 1] on each axis */
export function clampNormalized(point: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
}

/** Four corners in normalized (0–1) space */
export interface FourCorners {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
}

/** Convert API corner response to FourCorners */
export function apiCornersToFourCorners(
  api: Record<string, { x: number; y: number }>
): FourCorners {
  return {
    topLeft:     { x: api.top_left.x,     y: api.top_left.y },
    topRight:    { x: api.top_right.x,    y: api.top_right.y },
    bottomRight: { x: api.bottom_right.x, y: api.bottom_right.y },
    bottomLeft:  { x: api.bottom_left.x,  y: api.bottom_left.y },
  };
}

/** Convert FourCorners to API format */
export function fourCornersToApi(corners: FourCorners): Record<string, { x: number; y: number }> {
  return {
    top_left:     { x: corners.topLeft.x,     y: corners.topLeft.y },
    top_right:    { x: corners.topRight.x,    y: corners.topRight.y },
    bottom_right: { x: corners.bottomRight.x, y: corners.bottomRight.y },
    bottom_left:  { x: corners.bottomLeft.x,  y: corners.bottomLeft.y },
  };
}

/** Check if a corner has been moved (different from another reference) */
export function cornersChanged(
  a: FourCorners,
  b: FourCorners,
  threshold = 0.001
): boolean {
  return (
    Math.abs(a.topLeft.x - b.topLeft.x) > threshold ||
    Math.abs(a.topLeft.y - b.topLeft.y) > threshold ||
    Math.abs(a.topRight.x - b.topRight.x) > threshold ||
    Math.abs(a.topRight.y - b.topRight.y) > threshold ||
    Math.abs(a.bottomRight.x - b.bottomRight.x) > threshold ||
    Math.abs(a.bottomRight.y - b.bottomRight.y) > threshold ||
    Math.abs(a.bottomLeft.x - b.bottomLeft.x) > threshold ||
    Math.abs(a.bottomLeft.y - b.bottomLeft.y) > threshold
  );
}

/** Apply a 90° clockwise rotation to normalized corners */
export function rotateCornersCW(corners: FourCorners): FourCorners {
  // 90° CW: (x, y) → (y, 1-x) around center (0.5, 0.5)
  const rot = (p: NormalizedPoint): NormalizedPoint => ({
    x: p.y,
    y: 1 - p.x,
  });
  // CW: top-left→top-right, top-right→bottom-right, bottom-right→bottom-left, bottom-left→top-left
  return {
    topLeft:     rot(corners.bottomLeft),
    topRight:    rot(corners.topLeft),
    bottomRight: rot(corners.topRight),
    bottomLeft:  rot(corners.bottomRight),
  };
}

/** Default crop (5% inset from each border) */
export function defaultCorners(): FourCorners {
  const inset = 0.05;
  return {
    topLeft:     { x: inset,     y: inset },
    topRight:    { x: 1 - inset, y: inset },
    bottomRight: { x: 1 - inset, y: 1 - inset },
    bottomLeft:  { x: inset,     y: 1 - inset },
  };
}
