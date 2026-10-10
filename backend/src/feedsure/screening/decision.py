"""Pure, deterministic verdict and worker-instruction rules."""

from __future__ import annotations

from typing import Any

HAZARD_TYPES = {"glass", "sharp_metal", "battery", "syringe_or_medical_waste"}

ITEM_LABELS: dict[str, tuple[str, str]] = {
    "plastic_bag": ("plastic bag", "plastic bags"),
    "plastic_wrapper": ("plastic wrapper", "plastic wrappers"),
    "plastic_container": ("plastic container", "plastic containers"),
    "foil": ("piece of foil", "pieces of foil"),
    "cutlery_disposable": ("disposable utensil", "disposable utensils"),
    "cutlery_metal": ("metal utensil", "metal utensils"),
    "glass": ("piece of glass", "pieces of glass"),
    "sharp_metal": ("sharp metal item", "sharp metal items"),
    "metal_can": ("metal can", "metal cans"),
    "paper_cup": ("paper cup", "paper cups"),
    "tissue_or_napkin_pack": ("tissue or napkin pack", "tissue or napkin packs"),
    "cardboard": ("piece of cardboard", "pieces of cardboard"),
    "rubber_or_glove": ("rubber item or glove", "rubber items or gloves"),
    "battery": ("battery", "batteries"),
    "syringe_or_medical_waste": ("medical-waste item", "medical-waste items"),
    "other_non_food": ("non-food item", "non-food items"),
}


def _visible_items(items: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in items[:3]:
        count = int(item["count"])
        singular, plural = ITEM_LABELS.get(item["type"], ITEM_LABELS["other_non_food"])
        parts.append(f"{count} {singular if count == 1 else plural}")
    if not parts:
        return "visible non-food items"
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + f" and {parts[-1]}"


def _instruction(reason: str, items: list[dict[str, Any]], language: str) -> str:
    if language == "hi":
        return {
            "screening_failed": "हम फोटो जाँच नहीं सके। पिकअप पर प्लांट कर्मचारी जाँच करेगा।",
            "retake_photo": "अच्छी रोशनी में दो साफ़ फोटो फिर से लें।",
            "hazard": "कचरा अलग रखें और प्लांट कर्मचारी को बुलाएँ; खतरनाक वस्तु दिख रही है।",
            "over_threshold": "दिखाई दे रही गैर-खाद्य वस्तुएँ हटाएँ और फिर से फोटो लें।",
            "low_confidence": "कचरा अलग रखें; पिकअप पर प्लांट कर्मचारी इसकी जाँच करेगा।",
            "minor_contamination": "दिखाई दे रही गैर-खाद्य वस्तुएँ हटाएँ और फिर से फोटो लें।",
            "clean": "साफ़ दिख रहा है। पिकअप के लिए तैयार।",
        }[reason]

    visible_items = _visible_items(items)
    return {
        "screening_failed": "We couldn't check this photo. Plant staff will inspect it at pickup.",
        "retake_photo": "Take two clear photos again in better light.",
        "hazard": "Keep the load separate and call plant staff; a hazardous item is visible.",
        "over_threshold": f"Remove {visible_items} and photograph again.",
        "low_confidence": "Keep the load separate for a plant staff check at pickup.",
        "minor_contamination": f"Remove {visible_items} and photograph again.",
        "clean": "Looks clean. Ready for pickup.",
    }[reason]


def decide_verdict(
    observations: dict[str, Any],
    *,
    hold_threshold_pct: float,
    inspect_min_pct: float,
    min_confidence: float,
    language: str,
) -> dict[str, str]:
    """Apply the documented ordered rules without any model or AWS call."""
    items = observations.get("items", [])
    if observations.get("reason") == "screening_failed":
        reason = "screening_failed"
        verdict = "INSPECT"
    elif observations["image_quality"] != "ok":
        reason = "retake_photo"
        verdict = "INSPECT"
    elif observations["hazard"] or any(item["type"] in HAZARD_TYPES for item in items):
        reason = "hazard"
        verdict = "HOLD"
    elif observations["visible_contaminant_pct"] > hold_threshold_pct:
        reason = "over_threshold"
        verdict = "HOLD"
    elif observations["confidence"] < min_confidence:
        reason = "low_confidence"
        verdict = "INSPECT"
    elif observations["visible_contaminant_pct"] >= inspect_min_pct:
        reason = "minor_contamination"
        verdict = "INSPECT"
    else:
        reason = "clean"
        verdict = "ACCEPT"
    return {
        "verdict": verdict,
        "reason": reason,
        "instruction": _instruction(reason, items, language),
    }
