"""
Structured per-user, per-document file storage for the OCR API.

Directory layout
----------------
uploads/
  users/
    {user_id}/
      documents/
        {document_id}/
          original.jpg       ← original uploaded scan
          cropped.jpg        ← user-cropped region (if different from original)
          digital-copy.png   ← generated Pillow receipt PNG

All filenames are randomly generated (using `secrets`) to prevent collisions
and avoid any path-traversal risk from user-supplied filenames.
"""
import hashlib
import io
import os
import secrets
from typing import Optional, Tuple

from PIL import Image

# Base directory for all uploads (absolute path)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_ROOT = os.path.join(BASE_DIR, "uploads", "users")

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

ALLOWED_IMAGE_SIGNATURES = {
    b"\xff\xd8\xff",       # JPEG
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"GIF87a",              # GIF
    b"GIF89a",              # GIF
    b"RIFF",                # WEBP (starts with RIFF....WEBP)
    b"BM",                  # BMP
}


def _is_image_bytes(data: bytes) -> bool:
    """Check image content magic bytes. Returns True only for recognised formats."""
    return any(data.startswith(sig) for sig in ALLOWED_IMAGE_SIGNATURES)


def _remove_exif(image_bytes: bytes) -> bytes:
    """
    Re-save a JPEG/PNG image without EXIF metadata using Pillow.

    PIL's `getdata()` discards EXIF automatically when we construct a new
    ``Image.new`` and ``putdata()``.  Re-encoding as JPEG/PNG also strips it.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("RGB")
        data = list(img.getdata())
        img_clean = Image.new(img.mode, img.size)
        img_clean.putdata(data)
        buf = io.BytesIO()
        fmt = img.format or "JPEG"
        img_clean.save(buf, format=fmt, quality=88)
        return buf.getvalue()
    except Exception:
        # If anything goes wrong during EXIF removal, return original bytes
        return image_bytes


def get_user_dir(user_id: int) -> str:
    """Return absolute path to user's upload directory (creates if missing)."""
    path = os.path.join(UPLOAD_ROOT, str(user_id))
    os.makedirs(path, exist_ok=True)
    return path


def get_document_dir(user_id: int, document_id: int) -> str:
    """Return absolute path to a specific document's directory. Creates if missing."""
    path = os.path.join(get_user_dir(user_id), "documents", str(document_id))
    os.makedirs(path, exist_ok=True)
    return path


def generate_safe_filename(original_filename: str) -> str:
    """
    Generate a safe random filename preserving the lowercased extension.

    Format: ``{8_random_hexchars}_{first_8_original_ext}``

    The original filename is only used to extract the extension; no part of it
    is used verbatim in the output name.

    Examples
    --------
    >>> generate_safe_filename("My Photo.JPG")   # doctest: +SKIP
    'a3f8c2d1_photo.jpg'
    """
    # Normalise extension: take last '.' segment, lowercase, max 10 chars
    ext = os.path.splitext(original_filename)[1].lower()
    ext = "".join(c for c in ext if c.isalnum())  # strip any dots / weird chars
    ext = f".{ext[:10]}" if ext else ""

    random_part = secrets.token_hex(4)  # 8 hex chars
    return f"{random_part}{ext}"


def compute_image_hash(image_bytes: bytes) -> str:
    """Return SHA-256 hex digest of image bytes (for duplicate detection)."""
    return hashlib.sha256(image_bytes).hexdigest()


def save_upload_file(
    file_storage,
    user_id: int,
    document_id: Optional[int],
    prefix: str,  # 'original', 'cropped', 'digital-copy'
) -> Tuple[str, str]:
    """
    Save an uploaded file to the structured directory.

    Parameters
    ----------
    file_storage : werkzeug FileStorage
        The uploaded file wrapper.
    user_id : int
        Owner user ID (placeholder until auth is implemented).
    document_id : int, optional
        If provided, saves directly into the document directory.
        If None, saves into the user root (temp location before document creation).
    prefix : str
        Filename prefix: 'original', 'cropped', or 'digital-copy'.

    Returns
    -------
    Tuple[str, str]
        (absolute_path, url_path) where url_path is like
        '/files/1/documents/5/original.jpg' (when document_id is set) or
        '/files/1/scan_a3f8c2d1.jpg' (when document_id is None, temp file)

    Raises
    ------
    ValueError
        If the file is not a recognised image or exceeds MAX_FILE_SIZE_BYTES.
    """
    image_bytes = file_storage.read()

    if len(image_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds maximum size of {MAX_FILE_SIZE_BYTES // (1024*1024)} MB")

    if not _is_image_bytes(image_bytes):
        raise ValueError("Uploaded file is not a recognised image format")

    # Strip EXIF data
    image_bytes = _remove_exif(image_bytes)

    # Compute hash (for duplicate detection)
    image_hash = compute_image_hash(image_bytes)

    # Generate safe filename
    original_name = getattr(file_storage, "filename", None) or "upload"
    safe_name = generate_safe_filename(original_name)
    # Use prefix in filename: e.g. 'original_a3f8c2d1.jpg'
    filename = f"{prefix}_{safe_name}"

    # Determine target directory
    if document_id is not None:
        target_dir = get_document_dir(user_id, document_id)
    else:
        target_dir = get_user_dir(user_id)

    abs_path = os.path.join(target_dir, filename)
    with open(abs_path, "wb") as f:
        f.write(image_bytes)

    # Build URL path
    if document_id is not None:
        url_path = f"/files/{user_id}/{document_id}/{filename}"
    else:
        url_path = f"/files/{user_id}/{filename}"

    return abs_path, url_path


def get_file_url(user_id: int, document_id: int, filename: str) -> str:
    """
    Return the API URL path for a file.

    E.g. '/files/1/documents/5/original.jpg'   (served by GET /files/<user_id>/documents/<document_id>/<filename>)
    """
    return f"/files/{user_id}/documents/{document_id}/{filename}"


def is_temp_file(path: str) -> bool:
    """
    Return True if ``path`` points to a file in the user root (temp area)
    and not inside a ``documents/`` subdirectory.

    Files stored directly under ``uploads/users/{user_id}/`` (without a
    ``documents/<document_id>/`` segment) are considered temporary and will
    be moved into their document directory after ``store_document`` completes.
    """
    # Normalize path separators for consistent comparison
    normalized = path.replace("\\", "/")
    # Temp if it contains UPLOAD_ROOT but NOT "/documents/" — i.e. user root only
    return UPLOAD_ROOT.replace("\\", "/") in normalized and "/documents/" not in normalized


def move_to_document_dir(
    src_path: str,
    user_id: int,
    document_id: int,
    filename: str,
) -> str:
    """
    Move a file from a temp location into its final document directory.

    Returns the new absolute path.
    """
    dst_dir = get_document_dir(user_id, document_id)
    dst_path = os.path.join(dst_dir, filename)
    os.rename(src_path, dst_path)
    return dst_path
