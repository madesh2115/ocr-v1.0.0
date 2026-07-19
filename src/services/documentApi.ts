/**
 * documentApi.ts
 * ===============
 * API service for the document detection and extraction v2 endpoints.
 */

import { getApiBaseUrl } from '../utils/apiConfig';
import {
  FourCorners,
  apiCornersToFourCorners,
  fourCornersToApi,
} from '../utils/imageCoordinates';

const API_BASE = getApiBaseUrl();

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionResponse {
  success: boolean;
  data?: {
    auto_detected: boolean;
    confidence: number;
    method: string;
    requires_review: boolean;
    original_width: number;
    original_height: number;
    corners: Record<string, { x: number; y: number }>;
  };
  error?: {
    code: string;
    message: string;
  };
  _debug?: Record<string, string>;
}

export interface ExtractResponse extends DetectionResponse {
  vendor?: unknown;
  document?: unknown;
  amounts?: unknown;
  line_items?: unknown[];
  raw_text?: string;
  confidence?: number;
  document_id?: number;
  database_saved?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildFormData(imageUri: string, extras: Record<string, string> = {}): FormData {
  const uri = imageUri;
  const extension = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const formData = new FormData();
  formData.append('image', {
    uri,
    name: `bill-scan.${extension}`,
    type: extension === 'png' ? 'image/png' : 'image/jpeg',
  } as unknown as Blob);
  Object.entries(extras).forEach(([k, v]) => formData.append(k, v));
  return formData;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Detect crop (new v1 endpoint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/documents/detect-crop
 *
 * Detects the document boundary and returns four normalized corner points.
 *
 * @param imageUri - local file URI of the image
 * @param useDebug - if true, returns intermediate debug masks (development only)
 * @param signal - AbortController signal for cancellation
 */
export async function detectDocumentBoundary(
  imageUri: string,
  useDebug = false,
  signal?: AbortSignal
): Promise<DetectionResponse> {
  const formData = buildFormData(imageUri, useDebug ? { debug: '1' } : {});

  const response = await fetch(`${API_BASE}/api/v1/documents/detect-crop`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
    signal,
  });

  const data: DetectionResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message ?? `Detection failed (${response.status})`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Extract v2 (corner-based perspective crop + OCR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/documents/extract-v2
 *
 * Sends confirmed corners to apply perspective correction and run OCR.
 *
 * @param imageUri - local file URI of the original image
 * @param confirmedCorners - user-confirmed (possibly adjusted) corners in normalized 0–1 space
 * @param originalWidth - original image width (for coordinate validation)
 * @param originalHeight - original image height
 * @param signal - AbortController signal
 */
export async function extractWithCorners(
  imageUri: string,
  confirmedCorners: FourCorners,
  originalWidth: number,
  originalHeight: number,
  signal?: AbortSignal
): Promise<ExtractResponse> {
  const formData = buildFormData(imageUri, {
    corners: JSON.stringify(fourCornersToApi(confirmedCorners)),
  });

  const response = await fetch(`${API_BASE}/api/v1/documents/extract-v2`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
    signal,
  });

  const data: ExtractResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message ?? `Extraction failed (${response.status})`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rotate and re-detect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/documents/rotate-and-detect
 *
 * Rotates the image and re-runs detection to get fresh corner coordinates.
 *
 * @param imageUri - local file URI
 * @param rotations - number of 90° clockwise rotations (1–3)
 * @param signal - AbortController signal
 */
export async function rotateAndDetect(
  imageUri: string,
  rotations: number,
  signal?: AbortSignal
): Promise<DetectionResponse> {
  const formData = buildFormData(imageUri, { rotations: String(rotations % 4) });

  const response = await fetch(`${API_BASE}/api/v1/documents/rotate-and-detect`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
    signal,
  });

  const data: DetectionResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message ?? `Rotate+detect failed (${response.status})`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Legacy /extract (backward compat — simple rectangle crop)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /extract (legacy)
 *
 * Old endpoint that takes a rectangle crop_box {x, y, width, height}.
 * Still used for quick scans when corners are already confirmed.
 */
export async function extractLegacy(
  imageUri: string,
  cropBox: { x: number; y: number; width: number; height: number },
  signal?: AbortSignal
): Promise<ExtractResponse> {
  const formData = buildFormData(imageUri, {
    crop_box: JSON.stringify(cropBox),
  });

  const response = await fetch(`${API_BASE}/extract`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
    signal,
  });

  const data: ExtractResponse = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Legacy extraction failed (${response.status})`);
  }

  return data;
}
