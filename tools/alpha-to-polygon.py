#!/usr/bin/env python3
"""
alpha-to-polygon.py

Converts a PNG image's alpha channel into a CSS polygon() string suitable for
shape-outside, eliminating the need for shape-outside: url(...) which causes
Chromium to rasterize pages.

Algorithm: Row-scan silhouette + Ramer-Douglas-Peucker simplification.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import List, Tuple

import numpy as np
from PIL import Image


Point = Tuple[float, float]


def load_alpha(path: str, threshold: int) -> np.ndarray:
    """Load image and return binary alpha mask (True = opaque)."""
    with Image.open(path) as img:
        if img.mode == "RGBA":
            alpha = np.asarray(img)[:, :, 3]
        elif img.mode == "LA":
            alpha = np.asarray(img)[:, :, 1]
        elif img.mode in ("P", "PA"):
            alpha = np.asarray(img.convert("RGBA"))[:, :, 3]
        else:
            # No alpha channel — treat entire image as opaque
            h, w = np.asarray(img).shape[:2]
            alpha = np.full((h, w), 255, dtype=np.uint8)
    return alpha >= threshold


def row_scan(mask: np.ndarray) -> List[Point]:
    """
    Scan each row to find leftmost and rightmost opaque pixel.
    Returns a closed polygon as (x, y) pixel coordinates.
    Left edge runs top→bottom, right edge runs bottom→top.
    """
    h, w = mask.shape
    left_edge: List[Point] = []
    right_edge: List[Point] = []

    for y in range(h):
        row = mask[y]
        opaque = np.where(row)[0]
        if len(opaque) == 0:
            continue
        left_edge.append((float(opaque[0]), float(y)))
        right_edge.append((float(opaque[-1]), float(y)))

    if not left_edge:
        # Fully transparent — return a degenerate polygon
        return [(0.0, 0.0), (float(w), 0.0), (float(w), float(h)), (0.0, float(h))]

    # Close the polygon: left top→bottom, then right bottom→top
    right_edge.reverse()
    polygon = left_edge + right_edge
    return polygon


def perpendicular_distance(point: Point, start: Point, end: Point) -> float:
    """Perpendicular distance from point to line segment start→end."""
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_sq))
    proj_x = start[0] + t * dx
    proj_y = start[1] + t * dy
    return ((point[0] - proj_x) ** 2 + (point[1] - proj_y) ** 2) ** 0.5


def rdp(points: List[Point], epsilon: float) -> List[Point]:
    """Ramer-Douglas-Peucker simplification."""
    if len(points) <= 2:
        return points

    # Find point with maximum distance from line between first and last
    max_dist = 0.0
    max_idx = 0
    for i in range(1, len(points) - 1):
        d = perpendicular_distance(points[i], points[0], points[-1])
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > epsilon:
        left = rdp(points[: max_idx + 1], epsilon)
        right = rdp(points[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]


def simplify_to_target(points: List[Point], target: int) -> List[Point]:
    """Binary search on RDP epsilon to get close to target point count."""
    if len(points) <= target:
        return points

    # Compute bounding box diagonal for epsilon range
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    diag = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5
    if diag == 0:
        return points[:target]

    lo, hi = 0.0, diag * 0.5
    best = points

    for _ in range(40):
        mid = (lo + hi) / 2.0
        result = rdp(points, mid)
        if len(result) > target:
            lo = mid
        else:
            hi = mid
        # Track closest to target
        if abs(len(result) - target) < abs(len(best) - target):
            best = result
        if len(result) == target:
            break

    return best


def expand_polygon(points: List[Point], margin_pct: float, w: int, h: int) -> List[Point]:
    """Expand polygon outward by margin percentage of image dimensions."""
    if margin_pct == 0 or len(points) < 3:
        return points

    margin_x = w * margin_pct / 100.0
    margin_y = h * margin_pct / 100.0

    # Compute centroid
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)

    expanded = []
    for x, y in points:
        dx = x - cx
        dy = y - cy
        dist = (dx * dx + dy * dy) ** 0.5
        if dist == 0:
            expanded.append((x, y))
            continue
        nx = dx / dist
        ny = dy / dist
        expanded.append((x + nx * margin_x, y + ny * margin_y))

    return expanded


def to_percentage(points: List[Point], w: int, h: int) -> List[Point]:
    """Convert pixel coordinates to percentage (0-100%)."""
    if w == 0 or h == 0:
        return points
    return [(x / w * 100.0, y / h * 100.0) for x, y in points]


def format_polygon(points: List[Point]) -> str:
    """Format as CSS polygon() string."""
    coords = ", ".join(f"{x:.2f}% {y:.2f}%" for x, y in points)
    return f"polygon({coords})"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Convert PNG alpha channel to CSS polygon() for shape-outside."
    )
    ap.add_argument("image", help="Path to PNG image")
    ap.add_argument(
        "--threshold", type=int, default=128,
        help="Alpha threshold 0-255 (default: 128)",
    )
    ap.add_argument(
        "--points", type=int, default=24,
        help="Target polygon point count (default: 24)",
    )
    ap.add_argument(
        "--margin", type=float, default=0.0,
        help="Expand outline by percentage (default: 0)",
    )
    ap.add_argument(
        "--format", dest="fmt", choices=["polygon", "css-property", "json"],
        default="polygon",
        help='Output format (default: "polygon")',
    )
    args = ap.parse_args()

    # Load and process
    with Image.open(args.image) as img:
        w, h = img.size

    mask = load_alpha(args.image, args.threshold)
    polygon = row_scan(mask)
    polygon = simplify_to_target(polygon, args.points)

    if args.margin != 0:
        polygon = expand_polygon(polygon, args.margin, w, h)

    pct_points = to_percentage(polygon, w, h)
    poly_str = format_polygon(pct_points)

    if args.fmt == "polygon":
        print(poly_str)
    elif args.fmt == "css-property":
        print(f"shape-outside: {poly_str};")
    elif args.fmt == "json":
        json.dump({
            "image": args.image,
            "width": w,
            "height": h,
            "points": len(pct_points),
            "polygon": poly_str,
            "coordinates": [{"x": round(x, 2), "y": round(y, 2)} for x, y in pct_points],
        }, sys.stdout, indent=2)
        print()


if __name__ == "__main__":
    main()
