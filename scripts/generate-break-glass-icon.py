"""Generate the break-glass plan-builder symbol (256x256 PNG).

Matches the style of door-lock.png: red square with rounded look, black border,
and a white 'BG' label centred in the icon.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

SIZE = 256
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "plan-builder" / "symbols" / "break-glass.png"

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Red gradient background (top lighter, bottom darker) to match door-lock.png
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(220 - t * 60)   # 220 -> 160
    g = int(20 - t * 15)    #  20 ->   5
    b = int(20 - t * 15)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# Black border
border = 8
draw.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=(0, 0, 0, 255), width=border)

# 'BG' label, white, bold-ish
label = "BG"
# Try a few common Windows fonts; fall back to default if none found
font = None
for font_name in ("arialbd.ttf", "arial.ttf", "seguibl.ttf", "segoeuib.ttf"):
    try:
        font = ImageFont.truetype(font_name, 130)
        break
    except OSError:
        continue
if font is None:
    font = ImageFont.load_default()

bbox = draw.textbbox((0, 0), label, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
text_x = (SIZE - text_w) // 2 - bbox[0]
text_y = (SIZE - text_h) // 2 - bbox[1]

# Subtle shadow for legibility on the gradient
draw.text((text_x + 3, text_y + 3), label, font=font, fill=(0, 0, 0, 180))
draw.text((text_x, text_y), label, font=font, fill=(255, 255, 255, 255))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUTPUT, "PNG")
print(f"Wrote {OUTPUT} ({SIZE}x{SIZE})")
