"""生成 PWA 图标（纯标准库 + Pillow，无外部素材）。

用法： python tools/make-icons.py
输出： icons/favicon.svg, icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "icons")
os.makedirs(ICON_DIR, exist_ok=True)

BG_TOP = (99, 102, 241)     # indigo-500
BG_BOTTOM = (67, 56, 202)   # indigo-700
FG = (255, 255, 255)

FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366F1"/>
      <stop offset="1" stop-color="#4338CA"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M20 15h12.5a9 9 0 0 1 0 18H20z" fill="none" stroke="#fff" stroke-width="4"
        stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M20 33h14.5a8.5 8.5 0 0 1 0 17H20z" fill="none" stroke="#fff" stroke-width="4"
        stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>
</svg>
"""


def font(size):
    for name in ("arialbd.ttf", "segoeuib.ttf", "msyhbd.ttc", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def make_icon(size):
    img = gradient(size)
    draw = ImageDraw.Draw(img)
    # 圆角遮罩（maskable 安全区：内容居中 80%）
    margin = round(size * 0.10)
    radius = round(size * 0.22)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [margin, margin, size - margin - 1, size - margin - 1], radius=radius, fill=255
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)

    # 中央文字 CET
    f = font(round(size * 0.30))
    text = "CET"
    box = draw.textbbox((0, 0), text, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    d2 = ImageDraw.Draw(out)
    d2.text(((size - tw) / 2 - box[0], (size - th) / 2 - box[1] - size * 0.03), text, font=f, fill=FG)

    # 底部 4/6 小字
    f2 = font(round(size * 0.115))
    sub = "4 · 6"
    b2 = draw.textbbox((0, 0), sub, font=f2)
    d2.text(((size - (b2[2] - b2[0])) / 2 - b2[0], size * 0.70), sub, font=f2, fill=(226, 232, 255))
    return out


def main():
    with open(os.path.join(ICON_DIR, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(FAVICON)
    for size, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")):
        make_icon(size).save(os.path.join(ICON_DIR, name), optimize=True)
        print("wrote", name)


if __name__ == "__main__":
    main()
