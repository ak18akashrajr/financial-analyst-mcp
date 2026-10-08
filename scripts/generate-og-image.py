"""Regenerates public/og-image.png (the 1200x630 link-preview card).

Not part of the build: run it by hand after changing the brand text or the FEATURES list in
src/pages/Landing.tsx (keep the two lists in sync):

    python scripts/generate-og-image.py

Needs Pillow and the Segoe UI fonts (Windows). Icons are the same Lucide shapes the landing page
uses, drawn from their SVG geometry (see ICONS) so the preview matches the live chips.
"""
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (9, 14, 27)
OUT = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
FONTS = Path("C:/Windows/Fonts")

# Keep in sync with FEATURES in src/pages/Landing.tsx. Icon geometry is copied from lucide-react.
FEATURES = [
    ("Live holdings", "trending-up"),
    ("Tax lots", "calculator"),
    ("Projections", "line-chart"),
    ("Risk metrics", "gauge"),
    ("Goal tracking", "flag"),
    ("Family view", "users"),
    ("AI analyst", "bot"),
]

ICONS = {
    "trending-up": [("path", "M22 7 13.5 15.5 8.5 10.5 2 17"), ("path", "M16 7h6v6")],
    "calculator": [
        ("rect", (4, 2, 16, 20, 2)),
        ("path", "M8 6h8"),
        ("path", "M16 14v4"),
        ("dot", (16, 10)),
        ("dot", (12, 10)),
        ("dot", (8, 10)),
        ("dot", (12, 14)),
        ("dot", (8, 14)),
        ("dot", (12, 18)),
        ("dot", (8, 18)),
    ],
    "line-chart": [("path", "M3 3v16a2 2 0 0 0 2 2h16"), ("path", "m19 9-5 5-4-4-3 3")],
    "gauge": [("path", "m12 14 4-4"), ("path", "M3.34 19a10 10 0 1 1 17.32 0")],
    "flag": [
        ("path", "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"),
        ("path", "M4 22v-7"),
    ],
    "users": [
        ("path", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
        ("circle", (9, 7, 4)),
        ("path", "M22 21v-2a4 4 0 0 0-3-3.87"),
        ("path", "M16 3.13a4 4 0 0 1 0 7.75"),
    ],
    "bot": [
        ("path", "M12 8V4H8"),
        ("rect", (4, 8, 16, 12, 2)),
        ("path", "M2 14h2"),
        ("path", "M20 14h2"),
        ("path", "M15 13v2"),
        ("path", "M9 13v2"),
    ],
}


def _arc_points(x1, y1, rx, ry, phi, fa, fs, x2, y2, steps=24):
    """SVG elliptical arc -> polyline (endpoint-to-centre conversion from the SVG spec)."""
    if rx == 0 or ry == 0:
        return [(x2, y2)]
    phi = math.radians(phi)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = x1p**2 / rx**2 + y1p**2 / ry**2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx**2 * ry**2 - rx**2 * y1p**2 - ry**2 * x1p**2
    den = rx**2 * y1p**2 + ry**2 * x1p**2
    co = math.sqrt(max(0, num / den)) * (-1 if fa == fs else 1)
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx, cy = cp * cxp - sp * cyp + (x1 + x2) / 2, sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not fs and dt > 0:
        dt -= 2 * math.pi
    elif fs and dt < 0:
        dt += 2 * math.pi
    pts = []
    for i in range(1, steps + 1):
        t = t1 + dt * i / steps
        pts.append(
            (
                cp * rx * math.cos(t) - sp * ry * math.sin(t) + cx,
                sp * rx * math.cos(t) + cp * ry * math.sin(t) + cy,
            )
        )
    return pts


def path_to_polylines(d):
    """Flatten an SVG path (M m L l H h V v A a C c S s Z z) into lists of points."""
    tokens = re.findall(r"[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?", d)
    i, cmd = 0, None
    x = y = sx = sy = 0.0
    lines, cur = [], []
    last_c2 = None

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        if re.match(r"[a-zA-Z]", tokens[i]):
            cmd = tokens[i]
            i += 1
            if cmd in "zZ":
                if cur:
                    cur.append((sx, sy))
                    lines.append(cur)
                    cur = []
                x, y = sx, sy
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            nx, ny = num(), num()
            if rel:
                nx, ny = x + nx, y + ny
            if cur:
                lines.append(cur)
            x, y = sx, sy = nx, ny
            cur = [(x, y)]
            cmd = "l" if rel else "L"
        elif c == "L":
            nx, ny = num(), num()
            if rel:
                nx, ny = x + nx, y + ny
            x, y = nx, ny
            cur.append((x, y))
        elif c == "H":
            v = num()
            x = x + v if rel else v
            cur.append((x, y))
        elif c == "V":
            v = num()
            y = y + v if rel else v
            cur.append((x, y))
        elif c == "A":
            rx, ry, phi, fa, fs = num(), num(), num(), int(num()), int(num())
            nx, ny = num(), num()
            if rel:
                nx, ny = x + nx, y + ny
            cur.extend(_arc_points(x, y, rx, ry, phi, fa, fs, nx, ny))
            x, y = nx, ny
        elif c in ("C", "S"):
            if c == "C":
                x1, y1, x2, y2, nx, ny = (num() for _ in range(6))
                if rel:
                    x1, y1, x2, y2, nx, ny = x + x1, y + y1, x + x2, y + y2, x + nx, y + ny
            else:
                x2, y2, nx, ny = (num() for _ in range(4))
                if rel:
                    x2, y2, nx, ny = x + x2, y + y2, x + nx, y + ny
                x1, y1 = (2 * x - last_c2[0], 2 * y - last_c2[1]) if last_c2 else (x, y)
            for k in range(1, 17):
                t = k / 16
                cur.append(
                    (
                        (1 - t) ** 3 * x + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t**3 * nx,
                        (1 - t) ** 3 * y + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t**3 * ny,
                    )
                )
            last_c2 = (x2, y2)
            x, y = nx, ny
            continue
        last_c2 = None
    if cur:
        lines.append(cur)
    return lines


def draw_icon(img, name, cx, cy, size, color):
    """Stroke a 24x24 Lucide icon centred at (cx, cy), 4x supersampled for smooth edges."""
    ss = 4
    px = int(size * ss)
    layer = Image.new("L", (px, px), 0)
    d = ImageDraw.Draw(layer)
    k = px / 24
    sw = max(1, round(2 * k))

    def stroke(points):
        pts = [(a * k, b * k) for a, b in points]
        d.line(pts, fill=255, width=sw, joint="curve")
        r = sw / 2
        for a, b in (pts[0], pts[-1]):
            d.ellipse([a - r, b - r, a + r, b + r], fill=255)

    for kind, spec in ICONS[name]:
        if kind == "path":
            for line in path_to_polylines(spec):
                stroke(line)
        elif kind == "rect":
            x, y, w, h, r = spec
            pts = []
            for ax, ay, a0 in (
                (x + w - r, y + r, -90),
                (x + w - r, y + h - r, 0),
                (x + r, y + h - r, 90),
                (x + r, y + r, 180),
            ):
                for s in range(7):
                    t = math.radians(a0 + 90 * s / 6)
                    pts.append((ax + r * math.cos(t), ay + r * math.sin(t)))
            stroke(pts + [pts[0]])
        elif kind == "circle":
            x, y, r = spec
            stroke([(x + r * math.cos(t / 20 * 2 * math.pi), y + r * math.sin(t / 20 * 2 * math.pi)) for t in range(21)])
        elif kind == "dot":
            x, y = spec
            stroke([(x, y), (x + 0.01, y)])

    layer = layer.resize((int(size), int(size)), Image.LANCZOS)
    img.paste(Image.new("RGB", layer.size, color), (int(cx - size / 2), int(cy - size / 2)), layer)


def build():
    # Backdrop: faint grid fading towards the edges (same idea as PublicBackdrop on the landing page).
    base = Image.new("RGB", (W, H), BG)
    grid = Image.new("RGB", (W, H), BG)
    g = ImageDraw.Draw(grid)
    for gx in range(0, W, 48):
        g.line([(gx, 0), (gx, H)], fill=(34, 44, 66), width=1)
    for gy in range(0, H, 48):
        g.line([(0, gy), (W, gy)], fill=(34, 44, 66), width=1)
    mask = Image.new("L", (W, H), 0)
    m = ImageDraw.Draw(mask)
    for yy in range(H):
        for xx in range(0, W, 4):
            dx, dy = (xx - W / 2) / (W * 0.5), (yy - H / 2) / (H * 0.55)
            m.rectangle([xx, yy, xx + 3, yy], fill=int(255 * min(1, max(0, 1 - (dx * dx + dy * dy)) * 1.4)))
    img = Image.composite(grid, base, mask)
    d = ImageDraw.Draw(img)

    # Logo tile
    tile, tx, ty = 120, (W - 120) // 2, 70
    d.rounded_rectangle([tx, ty, tx + tile, ty + tile], radius=28, fill=(255, 255, 255))
    s = tile / 64
    d.polygon([(tx + a * s, ty + b * s) for a, b in [(32, 13), (51, 23), (13, 23)]], fill=(0, 0, 0))
    for col in (17, 26, 34, 43):
        d.rectangle([tx + col * s, ty + 27 * s, tx + (col + 4) * s, ty + 41 * s], fill=(0, 0, 0))
    d.rectangle([tx + 13 * s, ty + 44 * s, tx + 51 * s, ty + 48 * s], fill=(0, 0, 0))
    d.rectangle([tx + 11 * s, ty + 51 * s, tx + 53 * s, ty + 54 * s], fill=(0, 0, 0))

    title = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 60)
    tag = ImageFont.truetype(str(FONTS / "segoeuii.ttf"), 30)
    chip_font = ImageFont.truetype(str(FONTS / "segoeui.ttf"), 25)

    def centered(text, font, y, fill):
        d.text(((W - d.textlength(text, font=font)) / 2, y), text, font=font, fill=fill)

    centered("Blackcrest Capital Holdings", title, 228, (240, 244, 250))
    centered("Preserving Capital. Building Legacy.", tag, 312, (150, 162, 184))

    # Feature chips: icon + label in an outlined pill, wrapped into centred rows (matches the landing page).
    icon_size, pad, gap, chip_h, row_gap = 26, 22, 12, 56, 18
    widths = [pad + icon_size + 10 + d.textlength(label, font=chip_font) + pad for label, _ in FEATURES]
    rows, row, row_w = [], [], 0
    max_w = 1000
    for idx, wd in enumerate(widths):
        if row and row_w + gap + wd > max_w:
            rows.append(row)
            row, row_w = [], 0
        row.append(idx)
        row_w += wd + (gap if len(row) > 1 else 0)
    rows.append(row)

    y = 400
    for r in rows:
        total = sum(widths[i] for i in r) + gap * (len(r) - 1)
        x = (W - total) / 2
        for i in r:
            label, icon = FEATURES[i]
            wd = widths[i]
            d.rounded_rectangle(
                [x, y, x + wd, y + chip_h], radius=chip_h / 2, fill=(17, 24, 42), outline=(52, 64, 92), width=2
            )
            draw_icon(img, icon, x + pad + icon_size / 2, y + chip_h / 2, icon_size, (150, 162, 184))
            d.text((x + pad + icon_size + 10, y + chip_h / 2 - 17), label, font=chip_font, fill=(150, 162, 184))
            x += wd + gap
        y += chip_h + row_gap

    OUT.parent.mkdir(exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT} {img.size}")


if __name__ == "__main__":
    build()
