"""Settings from backend/.env. Values are secrets or config; never print them (use `describe()` for logs)."""
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BACKEND)
load_dotenv(os.path.join(BACKEND, ".env"))  # does not override variables already set (tests rely on this)


def _env(k, default=""):
    return os.environ.get(k, default).strip()


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL"))
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL").rstrip("/"))
    supabase_service_key: str = field(default_factory=lambda: _env("SUPABASE_SERVICE_ROLE_KEY"))
    supabase_bucket: str = field(default_factory=lambda: _env("SUPABASE_BUCKET", "appeal-photos"))
    maps_browser_key: str = field(default_factory=lambda: _env("GOOGLE_MAPS_BROWSER_KEY"))
    map_id: str = field(default_factory=lambda: _env("GOOGLE_MAP_ID"))
    worker_token: str = field(default_factory=lambda: _env("WORKER_TOKEN"))
    cors_origins: list = field(default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()])
    data_dir: str = field(default_factory=lambda: _env("GEO_DATA_DIR") or os.path.join(ROOT, "data"))
    offline_retry_s: float = 30.0      # after a DB failure, serve JSON for this long before trying the DB again
    worker_online_s: float = 90.0      # a worker seen within this window counts as online
    max_polygon_km2: float = 1.5       # job size cap for drawn areas (a street click is capped by the picker at 1.2 km)

    @property
    def areas_dir(self):
        return os.path.join(self.data_dir, "areas")

    def describe(self):
        """Safe summary for logs: which settings are present, never their values."""
        return {k: bool(getattr(self, k)) for k in ("database_url", "supabase_url", "supabase_service_key",
                                                     "maps_browser_key", "map_id", "worker_token")}
