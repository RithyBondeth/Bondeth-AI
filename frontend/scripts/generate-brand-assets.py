"""Export the approved Bubble B artwork; run with uv run --with pillow --with vtracer.

The SVG paths are automatically traced from the supplied artwork, not redrawn.
No image-generation service or credentials are needed to rebuild these exports.
"""

from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image
import vtracer


FRONTEND = Path(__file__).resolve().parents[1]
ROOT = FRONTEND.parent
BRAND = FRONTEND / "public/brand"
APP = FRONTEND / "src/app"
INK = "#292720"
PAPER = "#faf9f6"
CREAM = "#fff7e3"
SAFFRON = "#ffb544"


def export_vectors():
    source = Image.open(ROOT / "docs/brand/bubble-b-master.png").convert("RGBA")
    # Remove faint background-extraction noise and normalize to the UI palette.
    pixels = []
    for r, g, b, a in source.get_flattened_data():
        if a < 128:
            pixels.append((0, 0, 0, 0))
        elif r > 150 and r - b > 50 and g > 65:
            pixels.append((255, 181, 68, 255))
        elif (r + g + b) / 3 < 130:
            pixels.append((41, 39, 32, 255))
        else:
            pixels.append((255, 247, 227, 255))
    source.putdata(pixels)
    # The transparent gap at x=649..679 separates the approved mark and lettering.
    crops = {
        "mark": source.crop((0, 0, 665, source.height)),
        "wordmark": source.crop((665, 0, source.width, source.height)),
        "logo": source,
    }
    with tempfile.TemporaryDirectory() as directory:
        for name, image in crops.items():
            image = image.crop(image.getbbox())
            raster = Path(directory) / f"{name}.png"
            vector = Path(directory) / f"{name}.svg"
            image.save(raster)
            vtracer.convert_image_to_svg_py(
                str(raster), str(vector), colormode="color", hierarchical="stacked",
                mode="spline", filter_speckle=8, color_precision=6,
                corner_threshold=90, length_threshold=4, splice_threshold=45,
                path_precision=2,
            )
            svg = vector.read_text()
            svg = re.sub(r"<\?xml[^>]*>\s*", "", svg)
            svg = svg.replace("<svg ", f'<svg viewBox="0 0 {image.width} {image.height}" ', 1)
            (BRAND / f"{name}.svg").write_text(svg)
            # Preserve saffron while reversing ink/paper for the existing dark theme.
            dark = svg.replace(INK.upper(), "#f5efdf").replace(CREAM.upper(), "#1b1b18")
            (BRAND / f"{name}-dark.svg").write_text(dark)
            print(f"{name}: {image.width} x {image.height}")


def export_rasters():
    # sharp is already a frontend dependency through Next.js.
    subprocess.run(["node", "--input-type=module", "-e", r'''
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const mark = await readFile('public/brand/mark.svg');
const icon = await sharp(mark).resize(432, 432, { fit: 'contain', background: '#faf9f6' }).png().toBuffer();
const markSize = await sharp(mark).metadata();
const scale = 432 / Math.max(markSize.width, markSize.height);
const x = (512 - markSize.width * scale) / 2;
const y = (512 - markSize.height * scale) / 2;
const paths = mark.toString().match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)[1];
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#faf9f6"/><g transform="translate(${x} ${y}) scale(${scale})">${paths}</g></svg>`;
await writeFile('src/app/icon.svg', iconSvg + '\n');
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#faf9f6' } })
  .composite([{ input: icon, left: 40, top: 40 }]).png().toFile('public/brand/app-icon.png');
await sharp('public/brand/app-icon.png').resize(180, 180).png().toFile('src/app/apple-icon.png');
const logo = await sharp('public/brand/logo.svg').resize({ width: 520 }).png().toBuffer();
const art = await sharp('public/illustrations/voice-studio-doodle-v2.png').resize({ width: 470, height: 450, fit: 'inside' }).png().toBuffer();
const artSize = await sharp(art).metadata();
const copy = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<g font-family="Arial, sans-serif" fill="#292720">
<text x="70" y="310" font-size="62" font-weight="700">Speak Khmer.</text>
<text x="70" y="384" font-size="62" font-weight="700">Be heard.</text>
<text x="70" y="464" font-size="22">Khmer &amp; English voice tools</text>
<text x="70" y="508" font-size="18" fill="#68655c">Speech to text · Text to speech · Voice cloning</text>
</g></svg>`);
const share = await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#faf9f6' } })
  .composite([{ input: logo, left: 70, top: 66 }, { input: art, left: 650, top: Math.round((630 - artSize.height) / 2) }, { input: copy }])
  .png().toBuffer();
await writeFile('src/app/opengraph-image.png', share);
await writeFile('src/app/twitter-image.png', share);
'''], cwd=FRONTEND, check=True)
    icon = Image.open(BRAND / "app-icon.png")
    icon.save(APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])


if __name__ == "__main__":
    BRAND.mkdir(parents=True, exist_ok=True)
    export_vectors()
    export_rasters()
