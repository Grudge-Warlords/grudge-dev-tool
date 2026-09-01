"""Deterministic preparation for white-background concept renders; no downloads."""
import json
import cv2
import numpy as np
from PIL import Image


class ConceptReviewRequired(RuntimeError):
    pass


def prepare_concept(image, directory):
    rgb = np.asarray(image.convert("RGB"))
    # Only remove near-white areas connected to the border. Interior highlights
    # remain part of the object. Do not pretend this works for arbitrary photos.
    white = (rgb.min(axis=2) > 225).astype(np.uint8)
    border = np.concatenate((white[0], white[-1], white[:, 0], white[:, -1]))
    if float(border.mean()) < 0.90:
        (directory / "concept-review.json").write_text(json.dumps({"method": "border-connected-white", "technicalStatus": "needs-regeneration", "whiteBorderFraction": float(border.mean()), "semanticResemblanceChecked": False, "visualReviewRequired": True}))
        raise ConceptReviewRequired("Concept needs review: the generated background is not clear enough to isolate the object. Inspect the saved image and adjust the object rules or seed. No geometry model was loaded.")
    count, labels = cv2.connectedComponents(white, connectivity=8)
    border_labels = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    border_labels = border_labels[border_labels != 0]
    mask = (~np.isin(labels, border_labels)).astype(np.uint8) * 255
    # Remove tiny background specks without dropping legitimate disconnected
    # object components. Completeness is still a human visual-review decision.
    count, components, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] < 16:
            mask[components == i] = 0
    ys, xs = np.nonzero(mask)
    if not len(xs):
        raise ConceptReviewRequired("Concept needs review: no visible foreground object was found. No geometry model was loaded.")
    margin = min(int(xs.min()), int(ys.min()), rgb.shape[1] - 1 - int(xs.max()), rgb.shape[0] - 1 - int(ys.max()))
    report = {"method": "border-connected-white", "technicalStatus": "pass" if margin >= 12 else "needs-regeneration", "foregroundBounds": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "marginPixels": margin, "semanticResemblanceChecked": False, "visualReviewRequired": True, "message": "Background isolation, foreground bounds and edge clearance only; semantic resemblance and required parts are not checked."}
    (directory / "concept-review.json").write_text(json.dumps(report, indent=2))
    result = Image.fromarray(np.dstack((rgb, mask)), "RGBA")
    result.save(directory / "concept-cutout.png")
    if margin < 12:
        raise ConceptReviewRequired("Concept needs review: the object is cropped or too close to the edge. Inspect the saved image and retry with a new seed or simpler shape details. No geometry model was loaded.")
    return result
