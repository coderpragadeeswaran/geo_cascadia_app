"""Supabase Storage for appeal photos (private bucket). Uses the service-role key server-side only; the browser gets
short-lived signed URLs. Errors never include the key or full URLs."""
import uuid

import httpx

ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_BYTES = 8 * 1024 * 1024


class StorageError(RuntimeError):
    pass


def _headers(s, extra=None):
    return {"Authorization": f"Bearer {s.supabase_service_key}", "apikey": s.supabase_service_key, **(extra or {})}


def upload_photo(s, area_slug, item_id, content, content_type):
    if not (s.supabase_url and s.supabase_service_key):
        raise StorageError("photo storage is not configured")
    ext = ALLOWED.get(content_type)
    if not ext:
        raise StorageError(f"unsupported image type {content_type!r} (jpeg, png or webp)")
    if len(content) > MAX_BYTES:
        raise StorageError(f"photo is larger than {MAX_BYTES // (1024 * 1024)} MB")
    path = f"{area_slug}/review-{item_id}-{uuid.uuid4().hex[:10]}.{ext}"
    r = httpx.post(f"{s.supabase_url}/storage/v1/object/{s.supabase_bucket}/{path}", content=content, timeout=30,
                   headers=_headers(s, {"Content-Type": content_type, "x-upsert": "false"}))
    if r.status_code >= 300:
        raise StorageError(f"photo upload failed (HTTP {r.status_code})")
    return path


def signed_url(s, path, expires_in=600):
    r = httpx.post(f"{s.supabase_url}/storage/v1/object/sign/{s.supabase_bucket}/{path}", json={"expiresIn": expires_in},
                   headers=_headers(s), timeout=15)
    if r.status_code >= 300:
        raise StorageError(f"could not sign photo URL (HTTP {r.status_code})")
    signed = r.json().get("signedURL") or r.json().get("signedUrl")
    return f"{s.supabase_url}/storage/v1{signed}"
