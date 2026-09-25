"""Street View Static API: metadata, images, panorama discovery (cells 2 and 10, + M4b source flag)."""
import math, time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image
from shapely.geometry import Point

META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG_URL = "https://maps.googleapis.com/maps/api/streetview"


class StreetView:
    def __init__(self, key):
        assert key, "Google Maps key missing (Config.maps_key or env GOOGLE_MAPS_KEY)"
        self.key = key
        self.n_images = 0

    def _meta(self, params):
        for attempt in range(3):
            try:
                j = requests.get(META_URL, params={**params, "key": self.key}, timeout=30).json()
                break
            except requests.RequestException:
                time.sleep(1 + attempt)
        else:
            return None
        if j.get("status") != "OK":
            return None
        cr = j.get("copyright") or ""
        return {"pano_id": j.get("pano_id"), "camera_lat": j["location"]["lat"],
                "camera_lon": j["location"]["lng"], "date": j.get("date"),
                "source": "google" if "Google" in cr else "user", "copyright": cr}

    def meta_near(self, lat, lon, radius=15):
        return self._meta({"location": f"{lat},{lon}", "radius": int(round(radius)), "source": "outdoor"})

    def meta_by_id(self, pano_id):
        return self._meta({"pano": pano_id})

    def image(self, pano_id, heading=0, pitch=0, fov=90, size="640x640"):
        params = {"size": size, "pano": pano_id, "heading": heading % 360, "pitch": pitch,
                  "fov": fov, "return_error_code": "true", "key": self.key}
        for attempt in range(3):
            try:
                r = requests.get(IMG_URL, params=params, timeout=30)
                break
            except requests.RequestException:
                time.sleep(1 + attempt)
        else:
            return None
        if r.status_code != 200:
            return None
        self.n_images += 1
        return Image.open(BytesIO(r.content)).convert("RGB")

    def discover(self, polygon_ll, step_m=20, radius=15, workers=16):
        """Unique outdoor panoramas whose camera lies inside the polygon (shapely, lon/lat)."""
        lat0 = polygon_ll.centroid.y
        dlat, dlon = step_m / 110574, step_m / (111320 * math.cos(math.radians(lat0)))
        minx, miny, maxx, maxy = polygon_ll.bounds
        pts, lat = [], miny
        while lat <= maxy:
            lon = minx
            while lon <= maxx:
                if polygon_ll.contains(Point(lon, lat)):
                    pts.append((lat, lon))
                lon += dlon
            lat += dlat
        out, seen = [], set()
        with ThreadPoolExecutor(workers) as ex:
            for m in ex.map(lambda p: self.meta_near(p[0], p[1], radius), pts):
                if not m or m["pano_id"] in seen:
                    continue
                if not polygon_ll.contains(Point(m["camera_lon"], m["camera_lat"])):
                    continue
                seen.add(m["pano_id"]); out.append(m)
        return out, len(pts)
