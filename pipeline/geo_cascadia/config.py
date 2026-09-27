"""All tunable settings in one place. Values are the ones validated on Ward 29."""
import os
from dataclasses import dataclass, field

# D32 follow-up: words that appear on signs but never name a business (announcements, offers, greetings). A sign made
# only of these (plus place words) is never a display name and is not evidence of a business (textmatch.name_kind).
GENERIC_SIGN_WORDS = ("open", "opening", "opened", "grand", "sale", "offer", "offers", "discount", "discounts",
                      "welcome", "welcomes", "new", "now", "today", "special", "hurry", "free", "closed",
                      "available", "here", "entry", "exit", "entrance", "contact", "call", "hot", "best", "only", "limited",
                      "off", "flat", "upto", "up", "to", "clearance", "season", "festival", "diwali", "pongal", "happy")


@dataclass
class Config:
    data_dir: str = "/content/drive/MyDrive/alldataset"
    maps_key: str = ""                                   # Google Maps Platform key (Street View, Places, Geocoding)
    aws_region: str = "ap-south-1"
    vlm_model: str = "apac.amazon.nova-lite-v1:0"
    yolo_weights: str = ""                               # default: <data_dir>/training_runs/v8s_640_s2/weights/best.pt
    device: str = "auto"                                 # "auto" | "gpu" | "cpu"
    ocr_mode: str = "auto"                               # "auto" (full on GPU, fast on CPU) | "full" | "fast"

    # ---- Tier 1 detector ----
    classes: dict = field(default_factory=lambda: {0: "pole", 1: "lamp_head", 2: "signboard", 3: "building"})
    conf_th: dict = field(default_factory=lambda: {"pole": 0.25, "lamp_head": 0.20, "signboard": 0.30, "building": 0.30})
    base_conf: float = 0.20
    nms_iou: float = 0.45

    # ---- panorama discovery / street selection ----
    grid_step_m: float = 20.0
    search_radius_m: int = 15
    min_street_cover: float = 0.5
    min_street_len_m: float = 120.0
    max_streets: int = 10

    # ---- capture plan ----
    thin_m: float = 12.0
    min_sep_m: float = 6.0
    min_seg_m: float = 25.0
    side_range_m: float = 40.0
    tilt_pitch: int = 22
    tilt_if_closer_m: float = 15.0
    oblique_deg: float = 35.0
    ray_max_range_m: float = 40.0

    # ---- geometry ----
    cam_h: float = 2.5
    min_ratio: float = 0.06
    rough_max_d: float = 15.0
    eps_m: float = 3.0
    merge_m: float = 5.0
    lamp_fuse_m: float = 1.5
    lamp_miss_m: float = 2.0
    single_cam_uncertainty_m: float = 3.5               # measured: 86% of monocular distances within 3.5 m

    # ---- OCR ----
    ocr_min_conf: float = 0.55
    ocr_min_chars: int = 3
    ocr_target_h: int = 200
    fast_max_crops_per_building: int = 3

    # ---- building use from sign text (D32): fills ONLY a use that is still unknown, never a model decision ----
    # a building with a readable business sign (an OCR read >= ocr_min_conf that supports the kept name) is commercial.
    # House name plates are not businesses: a sign containing any of these words (Latin or Tamil) is skipped.
    sign_use_house_words: tuple = ("illam", "ilam", "nilayam", "nilaiyam", "nilaya", "nivas", "nivasam", "niwas", "bhavan",
                                   "bhavanam", "bhavana", "bhawan", "house", "home", "homes", "villa", "villas", "residency",
                                   "residence", "cottage", "kudil", "veedu", "apartment", "apartments", "flats", "enclave",
                                   "இல்லம்", "நிலையம்", "நிவாஸ்", "பவனம்", "வீடு", "குடில்", "இல்லம")
    sign_generic_words: tuple = GENERIC_SIGN_WORDS        # used by textmatch.name_kind (module list, one place)
    sign_use_min_crop_w: int = 50                        # px in the 640 x 640 photo: smaller signs are name plates
    sign_use_min_crop_area: int = 3000                   # px^2

    # ---- VLM ----
    vlm_workers: int = 4
    name_gate: float = 0.7
    building_ctx: float = 0.35
    use_router_path: str = ""                            # G1 model (models/use_router.joblib); "" = VLM for every building
    floors_shots: tuple = ("crops_building_v1/w1236978105.jpg", "crops_building_v1/w1247744938.jpg")  # 1 storey, 2 storeys

    # ---- reference layers ----
    places_radius_m: float = 40.0
    places_step_m: float = 50.0
    places_max_calls: int = 300
    geocode_points: int = 9

    # ---- matching / registers ----
    match_m: float = 15.0
    area_tol: float = 0.25
    synthetic_seed: int = 42
    disc_rate: float = 0.22
    asset_match_m: float = 6.0
    asset_shift_m: float = 25.0

    # ---- prices (USD) ----
    sv_price: float = 0.007
    vlm_in_per_m: float = 0.06
    vlm_out_per_m: float = 0.24

    # ---- validation numbers shown next to each attribute (from Ward 29 hand labels) ----
    validation: dict = field(default_factory=lambda: {
        "use": "90% vs hand labels (n=29)",
        "use_sign": "rule: readable business sign (not measured against hand labels)",
        "floors": "61% exact / 100% within 1 (n=33)",
        "names": "routed 74% (n=31); 15% confirmed by Google vs 2% chance",
        "condition": "withheld: 53% vs 66% majority baseline (n=38)"})

    def resolve(self):
        if not self.yolo_weights:
            self.yolo_weights = f"{self.data_dir}/training_runs/v8s_640_s2/weights/best.pt"
        if self.device == "auto":
            try:
                import torch
                self.device = "gpu" if torch.cuda.is_available() else "cpu"
            except Exception:
                self.device = "cpu"
        if self.ocr_mode == "auto":
            self.ocr_mode = "full" if self.device == "gpu" else "fast"
        self.maps_key = self.maps_key or os.environ.get("GOOGLE_MAPS_KEY", "")
        return self
