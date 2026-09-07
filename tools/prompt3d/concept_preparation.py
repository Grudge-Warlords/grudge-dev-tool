"""Deterministic preparation for white-background concept renders; no downloads."""
import hashlib
import json
import cv2
import numpy as np
from PIL import Image


class ConceptReviewRequired(RuntimeError):
    pass


def _write_review(directory, **values):
    report = {
        "version": 1,
        "semanticResemblanceChecked": False,
        "visualReviewRequired": True,
        **values,
    }
    (directory / "concept-review.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_subject_canvas(rgb, mask, directory, source_bounds, source_margin):
    """Center only retained provider pixels within the central half.

    This is deterministic conditioning, not object generation. The untouched
    provider render remains beside the prepared concept as concept-source.png.
    """
    height, width = mask.shape
    left, top, right, bottom = source_bounds
    cropped_rgb = Image.fromarray(rgb[top:bottom + 1, left:right + 1], "RGB")
    cropped_mask = Image.fromarray(mask[top:bottom + 1, left:right + 1], "L")
    crop_width, crop_height = cropped_rgb.size
    scale = min((width // 2) / crop_width, (height // 2) / crop_height, 1.0)
    output_width = max(1, round(crop_width * scale))
    output_height = max(1, round(crop_height * scale))
    if (output_width, output_height) != (crop_width, crop_height):
        cropped_rgb = cropped_rgb.resize((output_width, output_height), Image.Resampling.LANCZOS)
        cropped_mask = cropped_mask.resize((output_width, output_height), Image.Resampling.LANCZOS)
    prepared = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    offset = ((width - output_width) // 2, (height - output_height) // 2)
    prepared.paste(cropped_rgb.convert("RGBA"), offset, cropped_mask)
    prepared.save(directory / "concept-cutout.png")
    normalized_bounds = [offset[0], offset[1], offset[0] + output_width - 1, offset[1] + output_height - 1]
    normalized_margin = min(
        normalized_bounds[0], normalized_bounds[1],
        width - 1 - normalized_bounds[2], height - 1 - normalized_bounds[3],
    )
    return prepared, normalized_bounds, normalized_margin, {
        "mode": "isolated-provider-pixels-centered",
        "sourceForegroundBounds": source_bounds,
        "sourceMarginPixels": source_margin,
        "maximumCanvasFraction": 0.5,
        "scale": scale,
        "offset": [offset[0], offset[1]],
    }


def _remove_connected_cast_shadows(mask, rgb, margin=12):
    """Remove only a low, broad, photometrically shadow-like side offender.

    A Hunyuan studio shadow can touch the subject by one or more pixels, so a
    connected-component-only rule mistakes the whole subject-plus-shadow region
    for cropped geometry.  This rule starts from a pale neutral side-edge fade,
    follows only shadow-coloured pixels, and requires a shallow lower band next
    to a substantially larger retained foreground component.  Dark, chromatic,
    uniform, tall, or primary foreground regions remain untouched and therefore
    still fail the normal edge-clearance gate.  This is isolation only; it does
    not assert that the retained pixels depict the requested subject.
    """
    height, width = mask.shape
    foreground = mask > 0
    darkness = 255 - rgb.min(axis=2).astype(np.int16)
    chroma = rgb.max(axis=2).astype(np.int16) - rgb.min(axis=2).astype(np.int16)
    shadow_tone = foreground & (darkness <= 150) & (chroma <= 48)
    shadow_tone[: height // 2] = False

    count, components, stats, _ = cv2.connectedComponentsWithStats(shadow_tone.astype(np.uint8), 8)
    for i in range(1, count):
        component = components == i
        area = int(stats[i, cv2.CC_STAT_AREA])
        component_x = int(stats[i, cv2.CC_STAT_LEFT])
        component_y = int(stats[i, cv2.CC_STAT_TOP])
        component_width = int(stats[i, cv2.CC_STAT_WIDTH])
        component_height = int(stats[i, cv2.CC_STAT_HEIGHT])
        component_right = component_x + component_width
        component_bottom = component_y + component_height
        side_offender = component_x < margin or component_right > width - margin
        broad_lower_band = (
            component_y >= height // 2
            and component_bottom <= height - margin
            and component_width >= width // 4
            and component_height <= max(1, height // 6)
            and component_width >= component_height * 4
        )
        if not side_offender or not broad_lower_band:
            continue

        side_pixels = np.zeros_like(component)
        if component_x < margin:
            side_pixels[:, :margin] = component[:, :margin]
        if component_right > width - margin:
            side_pixels[:, width - margin:] = component[:, width - margin:]
        edge_rgb = rgb[side_pixels]
        all_darkness = darkness[component]
        if not edge_rgb.size or not all_darkness.size:
            continue
        edge_darkness = 255 - edge_rgb.min(axis=1).astype(np.int16)
        edge_chroma = edge_rgb.max(axis=1).astype(np.int16) - edge_rgb.min(axis=1).astype(np.int16)
        # Diffusion shadows can pick up a cool tint and a few dark/noisy pixels
        # at the image boundary. Medians describe the broad edge fade without
        # letting one antialiased pixel turn an actual cropped part into a pass.
        edge_darkness_median = float(np.median(edge_darkness))
        edge_chroma_median = float(np.median(edge_chroma))
        all_chroma = chroma[component]
        soft_stable_edge = (
            edge_darkness_median <= 130
            and edge_chroma_median <= 50
            and float(np.percentile(all_chroma, 90)) <= edge_chroma_median + 12
        )
        fades_inward = float(np.percentile(all_darkness, 90)) >= edge_darkness_median + 12
        if not soft_stable_edge or not fades_inward:
            continue

        retained = foreground & ~component
        dilated = cv2.dilate(component.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), iterations=1) > 0
        retained_count, retained_components, retained_stats, _ = cv2.connectedComponentsWithStats(retained.astype(np.uint8), 8)
        adjacent_labels = np.unique(retained_components[dilated & retained])
        adjacent_labels = adjacent_labels[adjacent_labels != 0]
        if retained_count <= 1 or not len(adjacent_labels):
            continue
        primary = max(adjacent_labels, key=lambda label: int(retained_stats[label, cv2.CC_STAT_AREA]))
        primary_area = int(retained_stats[primary, cv2.CC_STAT_AREA])
        primary_x = int(retained_stats[primary, cv2.CC_STAT_LEFT])
        primary_y = int(retained_stats[primary, cv2.CC_STAT_TOP])
        primary_width = int(retained_stats[primary, cv2.CC_STAT_WIDTH])
        primary_height = int(retained_stats[primary, cv2.CC_STAT_HEIGHT])
        primary_bottom = primary_y + primary_height
        retained_below_band = bool(np.any(retained[component_bottom:, component_x:component_right]))
        overlap = max(
            0,
            min(component_right, primary_x + primary_width)
            - max(component_x, primary_x),
        )
        shadow_below_primary = (
            component_y >= primary_y + primary_height * 0.70
            and component_bottom >= primary_bottom - component_height * 0.25
            and not retained_below_band
            and overlap >= min(component_width, primary_width) * 0.25
            and area <= primary_area * 0.35
        )
        if shadow_below_primary:
            mask[component] = 0
            foreground[component] = False
    return mask


def _remove_background_artifacts(mask, rgb, margin=12):
    """Drop tiny specks and conservatively identified studio cast shadows.

    Hunyuan concepts are requested on white, but the image model can still add a
    soft studio shadow beneath a floating subject.  Treating every non-white
    component as object geometry makes those shadows look like cropped meshes.
    The largest component remains authoritative and can never be removed here.
    A secondary component is eligible only when geometry, edge colour and an
    inward fade all support it being a cast shadow. A connected shadow is first
    split by colour and lower-band geometry; the authoritative subject region is
    never selected merely because it is the largest component. Semantic approval
    remains mandatory because no pixel heuristic can prove object identity.
    """
    height, width = mask.shape
    mask = _remove_connected_cast_shadows(mask, rgb, margin)
    count, components, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        return mask

    primary = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    primary_x = int(stats[primary, cv2.CC_STAT_LEFT])
    primary_y = int(stats[primary, cv2.CC_STAT_TOP])
    primary_width = int(stats[primary, cv2.CC_STAT_WIDTH])
    primary_height = int(stats[primary, cv2.CC_STAT_HEIGHT])
    primary_bottom = primary_y + primary_height
    primary_area = int(stats[primary, cv2.CC_STAT_AREA])

    for i in range(1, count):
        area = int(stats[i, cv2.CC_STAT_AREA])
        component_x = int(stats[i, cv2.CC_STAT_LEFT])
        component_width = int(stats[i, cv2.CC_STAT_WIDTH])
        component_height = int(stats[i, cv2.CC_STAT_HEIGHT])
        component_y = int(stats[i, cv2.CC_STAT_TOP])
        component_right = component_x + component_width
        component_bottom = component_y + component_height
        component_pixels = components == i
        component_rgb = rgb[component_pixels]
        component_darkness = 255 - component_rgb.min(axis=1) if component_rgb.size else np.array([], dtype=np.int16)
        component_chroma = component_rgb.max(axis=1) - component_rgb.min(axis=1) if component_rgb.size else np.array([], dtype=np.int16)
        tiny = area < 16
        detached_shadow_speck = (
            i != primary
            and area <= 64
            and component_y >= height * 0.75
            and (component_x < margin or component_right > width - margin)
            and component_darkness.size > 0
            and float(np.median(component_darkness)) <= 150
            and float(np.median(component_chroma)) <= 60
            and float(np.percentile(component_chroma, 90)) <= float(np.median(component_chroma)) + 8
        )
        detached_ground_shadow = False
        if i != primary and not tiny:
            gap = component_y - primary_bottom
            side_offender = component_x < margin or component_right > width - margin
            avoids_vertical_edges = component_y >= margin and component_bottom <= height - margin
            overlap = max(
                0,
                min(component_right, primary_x + primary_width)
                - max(component_x, primary_x),
            )
            lower_overlap = (
                component_y >= primary_y + primary_height * 0.70
                and component_bottom >= primary_bottom - component_height * 0.50
            )
            geometry_matches = (
                (gap >= max(2, height // 256) or lower_overlap)
                and side_offender
                and avoids_vertical_edges
                and component_width >= width // 4
                and component_height <= max(1, height // 8)
                and component_width >= component_height * 6
                and area <= primary_area * 0.30
                and overlap >= min(component_width, primary_width) * 0.25
            )
            if geometry_matches:
                side_pixels = np.zeros_like(component_pixels)
                if component_x < margin:
                    side_pixels[:, :margin] = component_pixels[:, :margin]
                if component_right > width - margin:
                    side_pixels[:, width - margin:] = component_pixels[:, width - margin:]
                edge_rgb = rgb[side_pixels]
                all_rgb = rgb[component_pixels]
                if edge_rgb.size and all_rgb.size:
                    edge_darkness = 255 - edge_rgb.min(axis=1)
                    edge_chroma = edge_rgb.max(axis=1) - edge_rgb.min(axis=1)
                    all_darkness = 255 - all_rgb.min(axis=1)
                    all_chroma = all_rgb.max(axis=1) - all_rgb.min(axis=1)
                    edge_darkness_median = float(np.median(edge_darkness))
                    edge_chroma_median = float(np.median(edge_chroma))
                    soft_neutral_edge = (
                        edge_darkness_median <= 110
                        and edge_chroma_median <= 55
                        and float(np.percentile(all_chroma, 90)) <= edge_chroma_median + 12
                    )
                    fades_inward = float(np.percentile(all_darkness, 90)) >= edge_darkness_median + 12
                    detached_ground_shadow = soft_neutral_edge and fades_inward
        if tiny or detached_shadow_speck or detached_ground_shadow:
            mask[components == i] = 0
    return mask


def _validated_isolation_mask(image, isolation_mask, isolation_evidence):
    if isolation_mask is None and isolation_evidence is None:
        return None
    if isolation_mask is None or not isinstance(isolation_evidence, dict):
        raise ConceptReviewRequired("Concept provenance is incomplete: Hunyuan background-isolation evidence is missing. No geometry model was loaded.")
    if (
        isolation_evidence.get("method") != "hunyuan-upstream-rembg-u2net"
        or isolation_evidence.get("modelPath") != "models/rembg/u2net.onnx"
        or isolation_evidence.get("modelSha256") != "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491"
        or isolation_evidence.get("providerSourceRevision") != "82920d643c0dc2f7bfd7255f45f62d386edfe60c"
    ):
        raise ConceptReviewRequired("Concept provenance is incomplete: the Hunyuan isolation implementation or model identity is not pinned. No geometry model was loaded.")
    mask_image = isolation_mask.convert("L")
    if mask_image.size != image.size:
        raise ConceptReviewRequired("Concept isolation dimensions differ from the untouched provider render. No geometry model was loaded.")
    return np.asarray(mask_image).copy()


def prepare_concept(image, directory, presentation_contract=None, isolation_mask=None, isolation_evidence=None):
    rgb = np.asarray(image.convert("RGB"))
    source_path = directory / "concept-source.png"
    if not source_path.is_file():
        raise ConceptReviewRequired("Concept provenance is incomplete: the untouched provider render is missing. No geometry model was loaded.")
    source_sha256 = _sha256(source_path)
    contract = presentation_contract if isinstance(presentation_contract, dict) else {}
    background = contract.get("background") if isinstance(contract.get("background"), dict) else {}
    scenery = contract.get("scenery") if isinstance(contract.get("scenery"), dict) else {}
    requested_backdrop = background.get("mode") == "requested" or scenery.get("mode") == "requested"
    if requested_backdrop:
        _write_review(
            directory,
            method="effective-presentation-contract",
            technicalStatus="pass",
            conditioningIsolationStatus="not-applicable-requested-presentation",
            providerSourcePath=source_path.name,
            providerSourceSha256=source_sha256,
            message="An affirmative backdrop or scenery exception is retained. Semantic identity and compliance with that requested presentation require explicit visual review.",
        )
        result = Image.fromarray(np.dstack((rgb, np.full(rgb.shape[:2], 255, dtype=np.uint8))), "RGBA")
        result.save(directory / "concept-cutout.png")
        return result
    mask = _validated_isolation_mask(image, isolation_mask, isolation_evidence)
    method = "hunyuan-upstream-rembg-u2net" if mask is not None else "border-connected-white"
    if mask is None:
        # Test-only/conservative fallback for callers without the official
        # Hunyuan remover. Live provider work always supplies its pinned mask.
        white = (rgb.min(axis=2) > 225).astype(np.uint8)
        border = np.concatenate((white[0], white[-1], white[:, 0], white[:, -1]))
        if float(border.mean()) < 0.90:
            _write_review(directory, method="border-connected-white", technicalStatus="needs-regeneration", failureCode="background-isolation", whiteBorderFraction=float(border.mean()), providerSourcePath=source_path.name, providerSourceSha256=source_sha256, message="The generated background is not clear enough to isolate the subject.")
            raise ConceptReviewRequired("Concept needs review: the generated background is not clear enough to isolate the object. Inspect the saved image and adjust the object rules or seed. No geometry model was loaded.")
        count, labels = cv2.connectedComponents(white, connectivity=8)
        border_labels = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
        border_labels = border_labels[border_labels != 0]
        mask = (~np.isin(labels, border_labels)).astype(np.uint8) * 255
        # Preserve disconnected object parts while removing only conservative
        # test-fixture artifacts. Semantic acceptance remains mandatory.
        mask = _remove_background_artifacts(mask, rgb)
    else:
        # The official remover emits feathered alpha. Ignore numerical dust but
        # preserve every meaningful disconnected subject part.
        mask[mask < 8] = 0
    ys, xs = np.nonzero(mask)
    if not len(xs):
        _write_review(directory, method=method, technicalStatus="needs-regeneration", failureCode="foreground-missing", providerSourcePath=source_path.name, providerSourceSha256=source_sha256, **({"conditioningIsolation": isolation_evidence} if isolation_evidence else {}), message="No visible foreground subject was found.")
        raise ConceptReviewRequired("Concept needs review: no visible foreground object was found. No geometry model was loaded.")
    source_bounds = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    margin = min(source_bounds[0], source_bounds[1], rgb.shape[1] - 1 - source_bounds[2], rgb.shape[0] - 1 - source_bounds[3])
    if margin <= 0:
        _write_review(directory, method=method, technicalStatus="needs-regeneration", failureCode="edge-clearance", foregroundBounds=source_bounds, marginPixels=margin, providerSourcePath=source_path.name, providerSourceSha256=source_sha256, **({"conditioningIsolation": isolation_evidence} if isolation_evidence else {}), message="The isolated provider subject reaches an image edge, so normalization cannot prove the subject is complete.")
        Image.fromarray(np.dstack((rgb, mask)), "RGBA").save(directory / "concept-cutout.png")
        raise ConceptReviewRequired("Concept needs review: the object reaches an image edge and may be cropped. Inspect the saved image and retry with a new seed or simpler shape details. No geometry model was loaded.")
    result, normalized_bounds, normalized_margin, normalization = _normalize_subject_canvas(rgb, mask, directory, source_bounds, margin)
    _write_review(
        directory,
        method=f"{method}-normalized",
        technicalStatus="pass",
        foregroundBounds=normalized_bounds,
        marginPixels=normalized_margin,
        normalization=normalization,
        providerSourcePath=source_path.name,
        providerSourceSha256=source_sha256,
        **({"conditioningIsolation": isolation_evidence} if isolation_evidence else {}),
        message=("Close but fully isolated provider pixels were centered within the central half; the untouched provider image remains retained for semantic review."
                 if margin < 12 else
                 "Raw provider pixels were isolated and centered within the central half. Semantic resemblance, required parts and artistic quality are not checked."),
    )
    return result
