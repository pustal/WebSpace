#!/usr/bin/env python3
"""Renders the app icons from assets/icons/source/icon.svg (original artwork).

Chromium (Python Playwright) draws the SVG at 1024 pixels; Pillow shrinks it to
  assets/icons/largeIcon.png   130 x 130 (also the logo inside the app)
  assets/icons/icon.png         80 x  80
  docs/images/logo.png         256 x 256 (README)

Usage: python3 scripts/make-icons.py
"""
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icons" / "source" / "icon.svg"


def main() -> None:
    svg = SOURCE.read_text(encoding="utf-8")
    rendered = ROOT / "assets" / "icons" / "source" / "render.png"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 512, "height": 512}, device_scale_factor=2)
        page.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
        page.locator("svg").screenshot(path=str(rendered), omit_background=True)
        browser.close()
    art = Image.open(rendered).convert("RGBA")
    rendered.unlink()
    (ROOT / "docs" / "images").mkdir(parents=True, exist_ok=True)
    art.resize((130, 130), Image.LANCZOS).save(ROOT / "assets" / "icons" / "largeIcon.png", optimize=True)
    art.resize((80, 80), Image.LANCZOS).save(ROOT / "assets" / "icons" / "icon.png", optimize=True)
    art.resize((256, 256), Image.LANCZOS).save(ROOT / "docs" / "images" / "logo.png", optimize=True)
    print("wrote assets/icons/largeIcon.png, assets/icons/icon.png, docs/images/logo.png")


if __name__ == "__main__":
    main()
