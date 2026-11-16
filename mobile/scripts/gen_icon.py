"""Draws the Knightfall mark (a great helm) and writes every icon/splash PNG the app config uses.

Run from mobile/:  python3 -I scripts/gen_icon.py assets
Geometry is in a 100x100 unit box, rendered at 4x and downsampled for smooth edges.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (11, 11, 13, 255)  # colors.bg
ACCENT = (250, 204, 21, 255)  # colors.accent
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling


def helm(draw: ImageDraw.ImageDraw, ox: float, oy: float, size: float, fill, cut) -> None:
    """Great helm centred in the square (ox, oy, size): rounded crown, eye slit, breaths, nasal bar."""
    u = size / 100

    def p(x: float, y: float) -> tuple[float, float]:
        return (ox + x * u, oy + y * u)

    # Shell: a dome on top of a slightly tapering body.
    body = [p(22, 40), p(78, 40), p(76, 88), p(50, 96), p(24, 88)]
    draw.polygon(body, fill=fill)
    draw.pieslice([p(22, 6), p(78, 74)], 180, 360, fill=fill)
    draw.rectangle([p(22, 39), p(78, 41)], fill=fill)

    # T-shaped visor: a full-width eye slit and the breathing slot below it.
    draw.rounded_rectangle([p(27, 43), p(73, 51)], radius=2.5 * u, fill=cut)
    draw.rounded_rectangle([p(46, 43), p(54, 82)], radius=2.5 * u, fill=cut)


def render(px: int, bg, fill, cut, scale: float) -> Image.Image:
    """`scale` is the mark's share of the canvas (the rest is padding)."""
    n = px * SS
    img = Image.new('RGBA', (n, n), bg)
    d = ImageDraw.Draw(img)
    size = n * scale
    off = (n - size) / 2
    helm(d, off, off, size, fill, cut)
    return img.resize((px, px), Image.LANCZOS)


def main(out: Path) -> None:
    clear = (0, 0, 0, 0)
    # iOS / store icon: opaque, no transparency allowed.
    render(1024, BG, ACCENT, BG, 0.62).convert('RGB').save(out / 'icon.png')
    # Android adaptive: the foreground keeps the mark inside the 66/108 safe zone.
    render(1024, clear, ACCENT, BG, 0.50).save(out / 'android-icon-foreground.png')
    Image.new('RGB', (1024, 1024), BG[:3]).save(out / 'android-icon-background.png')
    # Monochrome (themed icons): silhouette only; the cut-outs must be transparent.
    render(1024, clear, WHITE, clear, 0.50).save(out / 'android-icon-monochrome.png')
    # Splash: the mark alone on transparency; the plugin paints the background.
    render(512, clear, ACCENT, BG, 0.9).save(out / 'splash-icon.png')
    # Login / brand mark inside the app.
    render(256, clear, ACCENT, BG, 1.0).save(out / 'logo.png')
    render(48, BG, ACCENT, BG, 0.7).save(out / 'favicon.png')


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'assets'))
