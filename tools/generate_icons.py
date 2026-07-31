#!/usr/bin/env python3
# 生成扩展图标：粉色(#FB7299)圆角方形 + 白色放大镜，含灰度版
# 用法: pip install pillow && python3 tools/generate_icons.py
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

def make_icon(size, gray=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = (140, 140, 140, 255) if gray else (251, 114, 153, 255)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 4, fill=color)
    lw = max(2, size // 10)
    cx, cy, r = size * 0.44, size * 0.44, size * 0.22
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 255), width=lw)
    x1, y1 = cx + r * 0.72, cy + r * 0.72
    d.line([x1, y1, x1 + size * 0.18, y1 + size * 0.18], fill=(255, 255, 255, 255), width=lw)
    return img

if __name__ == "__main__":
    for size in (16, 48, 128):
        make_icon(size).save(os.path.join(OUT, f"icon{size}.png"))
        make_icon(size, gray=True).save(os.path.join(OUT, f"icon{size}_gray.png"))
    print("icons generated.")
