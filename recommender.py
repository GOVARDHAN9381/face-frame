# ============================================================
#  recommender.py  –  Frame Recommendation Engine
#  SpectAI – AI Spectacle Recommendation System
# ============================================================

from dataclasses import dataclass
from typing import Optional


@dataclass
class FrameRecommendation:
    frame_size:    str
    frame_style:   str
    lens_width:    str
    bridge_size:   str
    temple_length: str
    best_color:    str
    alt_styles:    list


# ── Size thresholds (mm) ──────────────────────────────────
SIZE_RULES = [
    (130, "Small"),
    (141, "Medium"),
    (float('inf'), "Large"),
]

# ── Style matrix ──────────────────────────────────────────
STYLE_MAP = {
    "Oval":    "Rectangle",
    "Round":   "Rectangle",
    "Square":  "Round",
    "Heart":   "Rimless",
    "Diamond": "Oval",
    "Oblong":  "Wayfarer",
}

ALT_STYLES = {
    "Oval":    ["Aviator", "Wayfarer", "Cat-Eye"],
    "Round":   ["Wayfarer", "Square", "Geometric"],
    "Square":  ["Oval", "Aviator", "Rimless"],
    "Heart":   ["Oval", "Wayfarer", "Light-Rim"],
    "Diamond": ["Cat-Eye", "Rimless", "Rectangle"],
    "Oblong":  ["Round", "Aviator", "Deep-Frame"],
}

COLOR_MAP = {
    "Oval":    "Black or Tortoise",
    "Round":   "Dark tones (Black/Navy)",
    "Square":  "Gold or Silver metallic",
    "Heart":   "Clear or Nude tones",
    "Diamond": "Warm tones (Brown/Gold)",
    "Oblong":  "Bold colors (Tortoise/Blue)",
}

# ── Lens width guide (mm) ─────────────────────────────────
LENS_WIDTH = {
    "Small":  "44–46 mm",
    "Medium": "48–52 mm",
    "Large":  "52–56 mm",
}

BRIDGE_SIZE    = "16–18 mm"
TEMPLE_LENGTHS = {
    "Small":  "135–140 mm",
    "Medium": "140–145 mm",
    "Large":  "145–150 mm",
}


def get_frame_size(face_width_mm: float) -> str:
    for threshold, label in SIZE_RULES:
        if face_width_mm < threshold:
            return label
    return "Large"


def recommend(face_shape: str,
              face_width_mm: float,
              pd_mm: Optional[float] = None) -> FrameRecommendation:
    """
    Core recommendation engine.
    Returns a FrameRecommendation dataclass.
    """
    shape = face_shape.strip().title() if face_shape else "Oval"
    size  = get_frame_size(face_width_mm)

    style      = STYLE_MAP.get(shape, "Rectangle")
    alt        = ALT_STYLES.get(shape, ["Oval", "Wayfarer"])
    color      = COLOR_MAP.get(shape, "Black or Tortoise")
    lens_w     = LENS_WIDTH.get(size, "48–52 mm")
    temple     = TEMPLE_LENGTHS.get(size, "140–145 mm")

    # PD-based bridge adjustment
    bridge = BRIDGE_SIZE
    if pd_mm:
        if pd_mm < 60:
            bridge = "14–16 mm"
        elif pd_mm > 68:
            bridge = "18–20 mm"

    return FrameRecommendation(
        frame_size    = size,
        frame_style   = style,
        lens_width    = lens_w,
        bridge_size   = bridge,
        temple_length = temple,
        best_color    = color,
        alt_styles    = alt,
    )


def recommendation_to_dict(rec: FrameRecommendation) -> dict:
    return {
        "frame_size":    rec.frame_size,
        "frame_style":   rec.frame_style,
        "lens_width":    rec.lens_width,
        "bridge_size":   rec.bridge_size,
        "temple_length": rec.temple_length,
        "best_color":    rec.best_color,
        "alt_styles":    rec.alt_styles,
    }
