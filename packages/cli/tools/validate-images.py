#!/usr/bin/env python3
"""
validate_image_tac.py

Recursively scans a folder for images, converts each to CMYK using an ICC profile,
computes Total Area Coverage (TAC = C+M+Y+K), and writes a report.

Notes:
- TAC is computed per-pixel from CMYK channel values (0..255) as percent: v/255*100.
- Conversion uses LittleCMS via Pillow.ImageCms.
- For very large images, you can choose to downsample for analysis (default) or attempt exact scan.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, List, Tuple, Dict

import numpy as np
from PIL import Image, ImageCms


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"}


@dataclass
class ImageTacResult:
    path: str
    width: int
    height: int
    original_mode: str
    converted_mode: str
    had_alpha: bool
    embedded_icc: bool
    conversion_assumed_source: str  # "embedded", "sRGB", "none"
    analysis_method: str            # "exact" or "downsample"
    analyzed_width: int
    analyzed_height: int
    threshold: float
    max_tac: float
    p99_tac: float
    pct_over_threshold: float
    pixels_analyzed: int
    error: Optional[str] = None


def build_profile(path: Path) -> ImageCms.ImageCmsProfile:
    if not path.exists():
        raise FileNotFoundError(f"ICC profile not found: {path}")
    return ImageCms.ImageCmsProfile(str(path))


def srgb_profile() -> ImageCms.ImageCmsProfile:
    # Pillow can create sRGB profile
    return ImageCms.createProfile("sRGB")


def get_embedded_profile(img: Image.Image) -> Optional[ImageCms.ImageCmsProfile]:
    icc_bytes = img.info.get("icc_profile")
    if not icc_bytes:
        return None
    try:
        return ImageCms.ImageCmsProfile(io_bytes=icc_bytes)  # type: ignore
    except TypeError:
        # Older Pillow: needs a file-like object; fall back by writing to memory bytes via BytesIO
        from io import BytesIO
        return ImageCms.ImageCmsProfile(BytesIO(icc_bytes))


def to_cmyk_with_icc(
    img: Image.Image,
    dst_profile: ImageCms.ImageCmsProfile,
    src_profile: Optional[ImageCms.ImageCmsProfile],
) -> Tuple[Image.Image, str, bool]:
    """
    Convert to CMYK using ICC transforms.
    Returns (converted_image, conversion_source_label, embedded_icc_used).
    """
    embedded_used = False
    if src_profile is not None:
        embedded_used = True
        conversion_source_label = "embedded"
        src = src_profile
    else:
        # Assume sRGB for RGB-ish sources
        conversion_source_label = "sRGB"
        src = srgb_profile()

    # Ensure we feed ImageCms something sane
    # Convert alpha-bearing modes to RGB first (drop alpha for TAC purposes)
    if img.mode in ("RGBA", "LA"):
        base = img.convert("RGB")
    elif img.mode == "P":
        base = img.convert("RGB")
    elif img.mode in ("RGB", "L", "CMYK"):
        base = img
    else:
        # Catch-all: convert to RGB
        base = img.convert("RGB")

    if base.mode == "CMYK":
        # If already CMYK, we *still* want to ensure it's in the target CMYK profile.
        # ImageCms can do CMYK->CMYK if profiles differ, but behavior varies by builds.
        # We'll attempt profileToProfile anyway.
        pass

    try:
        converted = ImageCms.profileToProfile(
            base,
            src,
            dst_profile,
            outputMode="CMYK",
        )
    except Exception as e:
        # Some Pillow builds can be picky; try a different path if needed
        raise RuntimeError(f"ICC conversion failed: {e}")

    return converted, conversion_source_label, embedded_used


def compute_tac_stats(cmyk_img: Image.Image, threshold: float) -> Tuple[float, float, float, int]:
    """
    Compute TAC stats from a CMYK image.
    Returns: (max_tac, p99_tac, pct_over_threshold, pixels_analyzed)
    """
    if cmyk_img.mode != "CMYK":
        raise ValueError(f"Expected CMYK mode, got {cmyk_img.mode}")

    arr = np.asarray(cmyk_img, dtype=np.uint16)  # H x W x 4, values 0..255
    # TAC per pixel in percent
    tac = (arr.sum(axis=2) / (255.0)) * 100.0  # 0..400
    max_tac = float(np.max(tac))
    p99_tac = float(np.quantile(tac, 0.99))
    over = float(np.mean(tac > threshold) * 100.0)
    pixels = int(tac.shape[0] * tac.shape[1])
    return max_tac, p99_tac, over, pixels


def downsample_for_analysis(img: Image.Image, target_pixels: int) -> Image.Image:
    w, h = img.size
    n = w * h
    if n <= target_pixels:
        return img
    scale = math.sqrt(target_pixels / float(n))
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    return img.resize((new_w, new_h), resample=Image.Resampling.BILINEAR)


def scan_images(
    root: Path,
    dst_icc_path: Path,
    threshold: float,
    method: str,
    target_pixels: int,
    exact_max_pixels: int,
) -> List[ImageTacResult]:
    dst_profile = build_profile(dst_icc_path)
    results: List[ImageTacResult] = []

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in SUPPORTED_EXTS:
            continue

        try:
            with Image.open(p) as img:
                original_mode = img.mode
                w, h = img.size
                had_alpha = img.mode in ("RGBA", "LA") or ("transparency" in img.info)

                # Embedded ICC?
                embedded = img.info.get("icc_profile") is not None
                src_prof = None
                assumed = "none"
                if embedded:
                    try:
                        # load embedded profile
                        src_prof = get_embedded_profile(img)
                        assumed = "embedded" if src_prof is not None else "sRGB"
                    except Exception:
                        # fallback to sRGB if profile parsing fails
                        src_prof = None
                        assumed = "sRGB"
                else:
                    assumed = "sRGB"

                # Optional analysis downsample BEFORE conversion to reduce cost
                analysis_method = method
                analysis_img = img
                if method == "downsample":
                    analysis_img = downsample_for_analysis(img, target_pixels)
                elif method == "exact":
                    # refuse huge exact scans unless user allows
                    if (w * h) > exact_max_pixels:
                        analysis_method = "downsample"
                        analysis_img = downsample_for_analysis(img, target_pixels)

                converted, conversion_source_label, embedded_used = to_cmyk_with_icc(
                    analysis_img, dst_profile, src_prof
                )

                max_tac, p99_tac, pct_over, pixels = compute_tac_stats(converted, threshold)

                results.append(
                    ImageTacResult(
                        path=str(p),
                        width=w,
                        height=h,
                        original_mode=original_mode,
                        converted_mode=converted.mode,
                        had_alpha=had_alpha,
                        embedded_icc=embedded,
                        conversion_assumed_source=conversion_source_label if conversion_source_label else assumed,
                        analysis_method=analysis_method,
                        analyzed_width=converted.size[0],
                        analyzed_height=converted.size[1],
                        threshold=threshold,
                        max_tac=max_tac,
                        p99_tac=p99_tac,
                        pct_over_threshold=pct_over,
                        pixels_analyzed=pixels,
                        error=None,
                    )
                )

        except Exception as e:
            results.append(
                ImageTacResult(
                    path=str(p),
                    width=0,
                    height=0,
                    original_mode="",
                    converted_mode="",
                    had_alpha=False,
                    embedded_icc=False,
                    conversion_assumed_source="",
                    analysis_method=method,
                    analyzed_width=0,
                    analyzed_height=0,
                    threshold=threshold,
                    max_tac=0.0,
                    p99_tac=0.0,
                    pct_over_threshold=0.0,
                    pixels_analyzed=0,
                    error=str(e),
                )
            )

    return results


def write_csv(results: List[ImageTacResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(asdict(results[0]).keys()) if results else []
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in results:
            w.writerow(asdict(r))


def write_json(results: List[ImageTacResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in results], f, indent=2)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate a TAC report for images in a folder (recursively)."
    )
    ap.add_argument("folder", help="Folder to scan (recursively)")
    ap.add_argument("--icc", required=True, help="Target CMYK ICC profile (e.g., CGATS21_CRPC1.icc)")
    ap.add_argument("--threshold", type=float, default=240.0, help="TAC threshold (default 240)")
    ap.add_argument(
        "--method",
        choices=["downsample", "exact"],
        default="downsample",
        help="Analysis method: downsample (fast) or exact (can be huge memory). Default downsample.",
    )
    ap.add_argument(
        "--target-pixels",
        type=int,
        default=2_000_000,
        help="When downsampling, cap analysis image to this many pixels (default 2,000,000).",
    )
    ap.add_argument(
        "--exact-max-pixels",
        type=int,
        default=8_000_000,
        help="If --method exact and image exceeds this pixel count, fall back to downsample (default 8,000,000).",
    )
    ap.add_argument("--out", default="tac_report", help="Output report basename (default tac_report)")
    args = ap.parse_args()

    root = Path(args.folder).resolve()
    icc = Path(args.icc).resolve()
    outbase = Path(args.out).resolve()

    if not root.exists():
        raise SystemExit(f"Folder not found: {root}")
    if not icc.exists():
        raise SystemExit(f"ICC not found: {icc}")

    results = scan_images(
        root=root,
        dst_icc_path=icc,
        threshold=float(args.threshold),
        method=str(args.method),
        target_pixels=int(args.target_pixels),
        exact_max_pixels=int(args.exact_max_pixels),
    )

    # Sort: errors first, then max_tac desc
    results.sort(key=lambda r: (r.error is None, -r.max_tac))

    write_csv(results, outbase.with_suffix(".csv"))
    write_json(results, outbase.with_suffix(".json"))

    # Console summary
    errored = [r for r in results if r.error]
    over = [r for r in results if (r.error is None and r.max_tac > float(args.threshold))]

    print(f"Scanned: {len(results)} image(s)")
    print(f"Errors:  {len(errored)}")
    print(f"Over {args.threshold:.0f} TAC: {len(over)}")
    print(f"CSV: {outbase.with_suffix('.csv')}")
    print(f"JSON:{outbase.with_suffix('.json')}")

    if over:
        print("\nTop offenders:")
        for r in over[:15]:
            print(f"- {r.max_tac:6.1f} TAC  (p99 {r.p99_tac:6.1f})  {r.pct_over_threshold:5.2f}% over  {r.path}")

    # Exit non-zero if anything exceeds threshold or errors exist
    if errored or over:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
