"""Focused regressions for deterministic concept framing preparation."""
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "prompt3d"))

from concept_preparation import ConceptReviewRequired, prepare_concept


def review(image):
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        image.save(root / "concept-source.png")
        try:
            prepared = prepare_concept(image, root)
            error = None
        except ConceptReviewRequired as caught:
            prepared = None
            error = caught
        report = json.loads((root / "concept-review.json").read_text())
        return prepared, report, error


def review_with_hunyuan_mask(image, mask):
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        image.save(root / "concept-source.png")
        evidence = {
            "method": "hunyuan-upstream-rembg-u2net",
            "modelPath": "models/rembg/u2net.onnx",
            "modelSha256": "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491",
            "providerSourceRevision": "82920d643c0dc2f7bfd7255f45f62d386edfe60c",
        }
        prepared = prepare_concept(image, root, isolation_mask=mask, isolation_evidence=evidence)
        report = json.loads((root / "concept-review.json").read_text())
        return prepared, report


white = (255, 255, 255)
dark = (45, 45, 45)

# Live provider conditioning uses the official Hunyuan remover alpha rather
# than guessing whether pixels are shadows or object parts.
provider_render = Image.new("RGB", (256, 256), white)
ImageDraw.Draw(provider_render).ellipse((70, 35, 185, 185), fill=dark)
ImageDraw.Draw(provider_render).ellipse((0, 190, 210, 230), fill=(145, 160, 180))
provider_mask = Image.new("L", (256, 256), 0)
ImageDraw.Draw(provider_mask).ellipse((70, 35, 185, 185), fill=255)
prepared, report = review_with_hunyuan_mask(provider_render, provider_mask)
assert report["method"] == "hunyuan-upstream-rembg-u2net-normalized"
assert report["conditioningIsolation"]["modelSha256"] == "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491"
assert report["normalization"]["sourceForegroundBounds"] == [70, 35, 185, 185]
assert prepared.getpixel((0, 210))[3] == 0

# A detached, fading, neutral studio shadow may touch a side edge without
# making the central subject cropped. It must not survive in conditioning alpha.
floating = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(floating)
drawing.ellipse((70, 35, 185, 185), fill=dark)
pixels = floating.load()
for y in range(208, 227):
    for x in range(0, 186):
        normalized_x = x / 185
        normalized_y = abs(y - 217) / 10
        if normalized_y <= 1:
            edge = (212, 215, 225)
            inner = (160, 165, 176)
            blend = normalized_x * (1 - normalized_y * 0.45)
            pixels[x, y] = tuple(round(edge[c] + (inner[c] - edge[c]) * blend) for c in range(3))
prepared, report, error = review(floating)
assert error is None
assert report["technicalStatus"] == "pass"
assert report["normalization"]["sourceForegroundBounds"] == [70, 35, 185, 185]
assert max(report["foregroundBounds"][2] - report["foregroundBounds"][0] + 1, report["foregroundBounds"][3] - report["foregroundBounds"][1] + 1) <= 128
assert report["providerSourceSha256"]
assert report["providerSourcePath"] == "concept-source.png"
assert prepared.getpixel((0, 215))[3] == 0
assert report["semanticResemblanceChecked"] is False
assert report["visualReviewRequired"] is True

# A broad lower cast shadow can touch the subject and remain one foreground
# component. Its pale neutral side fade is removable without treating the
# central subject as cropped or claiming semantic acceptance.
connected = Image.new("RGB", (256, 256), white)
pixels = connected.load()
for y in range(182, 202):
    for x in range(0, 196):
        normalized_x = x / 195
        normalized_y = abs(y - 191.5) / 10
        edge = (189, 204, 222)
        inner = (145, 164, 188)
        blend = normalized_x * (1 - normalized_y * 0.35)
        pixels[x, y] = tuple(round(edge[c] + (inner[c] - edge[c]) * blend) for c in range(3))
ImageDraw.Draw(connected).ellipse((70, 35, 185, 185), fill=dark)
prepared, report, error = review(connected)
assert error is None
assert report["technicalStatus"] == "pass"
assert report["normalization"]["sourceForegroundBounds"] == [70, 35, 185, 185]
assert max(report["foregroundBounds"][2] - report["foregroundBounds"][0] + 1, report["foregroundBounds"][3] - report["foregroundBounds"][1] + 1) <= 128
assert prepared.getpixel((0, 191))[3] == 0
assert prepared.getpixel((127, 183))[3] == 255
assert report["semanticResemblanceChecked"] is False
assert report["visualReviewRequired"] is True

# A genuinely cropped primary remains a hard failure on every image edge. The
# pale case proves that a shadow-like primary can never be removed.
for bounds, colour in (
    ((-20, 45, 155, 205), dark),
    ((100, 45, 275, 205), dark),
    ((45, -20, 205, 155), dark),
    ((45, 100, 205, 275), dark),
    ((-20, 45, 155, 205), (205, 205, 205)),
):
    cropped = Image.new("RGB", (256, 256), white)
    ImageDraw.Draw(cropped).ellipse(bounds, fill=colour)
    _, report, error = review(cropped)
    assert isinstance(error, ConceptReviewRequired)
    assert report["technicalStatus"] == "needs-regeneration"
    assert report.get("marginPixels", 0) == 0

# Geometry-identical legitimate parts remain fail-closed unless every piece of
# shadow evidence is present: uniform pale, dark, and chromatic bars all fail.
for edge_colour, inner_colour in (
    ((205, 205, 205), (205, 205, 205)),
    ((80, 80, 80), (45, 45, 45)),
    ((190, 220, 225), (120, 175, 210)),
):
    candidate = Image.new("RGB", (256, 256), white)
    drawing = ImageDraw.Draw(candidate)
    drawing.ellipse((70, 35, 185, 185), fill=dark)
    for x in range(0, 186):
        blend = x / 185
        colour = tuple(round(edge_colour[c] + (inner_colour[c] - edge_colour[c]) * blend) for c in range(3))
        drawing.line((x, 208, x, 226), fill=colour)
    _, report, error = review(candidate)
    assert isinstance(error, ConceptReviewRequired)
    assert report["marginPixels"] == 0

# Connecting those same fail-closed impostors to the primary must not make them
# removable. Only the combination of neutral soft edge, inward fade, shallow
# lower-band geometry and a larger retained primary qualifies.
for edge_colour, inner_colour in (
    ((205, 205, 205), (205, 205, 205)),
    ((80, 80, 80), (45, 45, 45)),
    ((190, 220, 225), (120, 175, 210)),
):
    candidate = Image.new("RGB", (256, 256), white)
    drawing = ImageDraw.Draw(candidate)
    for x in range(0, 196):
        blend = x / 195
        colour = tuple(round(edge_colour[c] + (inner_colour[c] - edge_colour[c]) * blend) for c in range(3))
        drawing.line((x, 182, x, 201), fill=colour)
    drawing.ellipse((70, 35, 185, 185), fill=dark)
    _, report, error = review(candidate)
    assert isinstance(error, ConceptReviewRequired)
    assert report["technicalStatus"] == "needs-regeneration"
    assert report["marginPixels"] == 0

# A soft component overlapping the primary vertically is not detached.
overlapping = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(overlapping)
drawing.ellipse((70, 35, 185, 185), fill=dark)
for x in range(0, 186):
    shade = round(212 - 52 * (x / 185))
    drawing.line((x, 165, x, 181), fill=(shade, shade, shade))
_, report, error = review(overlapping)
assert isinstance(error, ConceptReviewRequired)
assert report["marginPixels"] == 0

# A narrow detached part at an edge is not a ground shadow.
narrow = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(narrow)
drawing.ellipse((70, 45, 185, 185), fill=dark)
drawing.rectangle((0, 208, 40, 224), fill=dark)
_, report, error = review(narrow)
assert isinstance(error, ConceptReviewRequired)
assert report["marginPixels"] == 0

# A disconnected in-frame part is preserved in the alpha channel.
in_frame = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(in_frame)
drawing.ellipse((70, 35, 185, 185), fill=dark)
drawing.rectangle((25, 205, 60, 225), fill=dark)
prepared, report, error = review(in_frame)
assert error is None
assert report["normalization"]["sourceForegroundBounds"] == [25, 35, 185, 225]
assert max(report["foregroundBounds"][2] - report["foregroundBounds"][0] + 1, report["foregroundBounds"][3] - report["foregroundBounds"][1] + 1) <= 128
assert prepared.getpixel((30, 210))[3] == 0

# A complete isolated subject with a narrow real background border is safely
# centered from its retained pixels. This repairs close framing without letting
# a subject that actually reaches any image edge through the crop gate.
near_edge = Image.new("RGB", (256, 256), white)
ImageDraw.Draw(near_edge).ellipse((4, 35, 185, 225), fill=dark)
prepared, report, error = review(near_edge)
assert error is None
assert report["technicalStatus"] == "pass"
assert report["normalization"]["sourceMarginPixels"] == 4
assert report["marginPixels"] >= 64
assert report["providerSourcePath"] == "concept-source.png"
assert "Close but fully isolated" in report["message"]

# A tiny, detached, stable blue-grey remnant at a lower image edge is part of
# the same cast-shadow cleanup. A dark object fragment with the same geometry
# remains fail-closed.
shadow_speck = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(shadow_speck)
drawing.ellipse((70, 35, 185, 185), fill=dark)
drawing.rectangle((254, 224, 255, 235), fill=(128, 149, 177))
prepared, report, error = review(shadow_speck)
assert error is None
assert report["technicalStatus"] == "pass"
assert prepared.getpixel((255, 230))[3] == 0

cropped_dark_speck = Image.new("RGB", (256, 256), white)
drawing = ImageDraw.Draw(cropped_dark_speck)
drawing.ellipse((70, 35, 185, 185), fill=dark)
drawing.rectangle((254, 224, 255, 235), fill=dark)
_, report, error = review(cropped_dark_speck)
assert isinstance(error, ConceptReviewRequired)
assert report["failureCode"] == "edge-clearance"

print("Concept preparation crop and detached-shadow regressions passed.")
