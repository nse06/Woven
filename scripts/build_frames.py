#!/usr/bin/env python3
"""Pull frames from Woven's YouTube videos and pack them for the ambient background.

For each video we grab:
  - YouTube's auto-generated 720p stills (maxres1/2/3.jpg)
  - the storyboard sprite sheets (one small frame every couple of seconds)

Pillarboxing is cropped off, black/duplicate frames are dropped, and every frame
is center-cropped to 16:9 and packed into one sprite sheet per video. The page
reads frames/manifest.json to know what's where.

Requires: yt-dlp (with a JS runtime, e.g. node) and Pillow.
    pip install "yt-dlp[default]" pillow
    python3 scripts/build_frames.py
"""
import io
import json
import math
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

VIDEOS = [
    {"id": "uP2mk6ti8tU", "title": "halation", "credit": "dir. cameron mcdougall"},
    {"id": "s9EypTTI7Y8", "title": "trepanation", "credit": "video by max drexler"},
    {"id": "0BioWel31ls", "title": "something like that", "credit": "animation by natalie carew-cox"},
]

OUT = Path(__file__).resolve().parent.parent / "frames"
CELL = (192, 108)   # every frame is stored at this size
COLS = 10
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def video_info(vid):
    for attempt in range(5):
        p = subprocess.run(
            ["yt-dlp", "--js-runtimes", "node", "-j", f"https://www.youtube.com/watch?v={vid}"],
            capture_output=True, text=True,
        )
        if p.returncode == 0:
            return json.loads(p.stdout)
        time.sleep(2 + attempt * 2)
    sys.exit(f"yt-dlp failed for {vid}:\n{p.stderr}")


def storyboard_frames(info):
    """Yield (seconds, image) for every cell of the largest storyboard."""
    sbs = [f for f in info["formats"] if f.get("format_note") == "storyboard"]
    sb = max(sbs, key=lambda f: f["width"] * f["height"])
    w, h, rows, cols = sb["width"], sb["height"], sb["rows"], sb["columns"]
    t = 0.0
    for frag in sb["fragments"]:
        sheet = fetch(frag["url"])
        per = frag["duration"] / (rows * cols)
        for r in range(rows):
            for c in range(cols):
                if (c + 1) * w <= sheet.width and (r + 1) * h <= sheet.height:
                    yield t, sheet.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))
                t += per


def still_frames(vid, duration):
    for n, frac in ((1, 0.25), (2, 0.5), (3, 0.75)):
        try:
            yield duration * frac, fetch(f"https://i.ytimg.com/vi/{vid}/maxres{n}.jpg")
        except Exception:
            pass


def content_box(img, thresh=14):
    """Bounding box with black pillar/letterbox bars removed."""
    g = img.convert("L")
    w, h = g.size
    cols = [ImageStat.Stat(g.crop((x, 0, x + 1, h))).mean[0] for x in range(w)]
    rows = [ImageStat.Stat(g.crop((0, y, w, y + 1))).mean[0] for y in range(h)]
    def span(v):
        lo = next((i for i, m in enumerate(v) if m > thresh), 0)
        hi = len(v) - next((i for i, m in enumerate(reversed(v)) if m > thresh), 0)
        return lo, hi
    (x0, x1), (y0, y1) = span(cols), span(rows)
    return x0, y0, x1, y1


def bars_for(frames):
    """Pillarbox is constant across a video, so take the widest content box seen."""
    boxes = [content_box(im) for _, im in frames if ImageStat.Stat(im.convert("L")).mean[0] > 30]
    if not boxes:
        return None
    # Express as fractions so the same box applies to frames of any resolution.
    W, H = frames[0][1].size
    fx0 = min(b[0] for b in boxes) / W
    fx1 = max(b[2] for b in boxes) / W
    fy0 = min(b[1] for b in boxes) / H
    fy1 = max(b[3] for b in boxes) / H
    return fx0, fy0, fx1, fy1


def cover(img, box):
    w, h = img.size
    if box:
        img = img.crop((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)))
    w, h = img.size
    target = CELL[0] / CELL[1]
    if w / h > target:
        nw = round(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize(CELL, Image.LANCZOS)


def too_similar(a, b):
    d = ImageChops.difference(a.resize((48, 27)), b.resize((48, 27))).convert("L")
    return ImageStat.Stat(d).mean[0] < 6


def main():
    OUT.mkdir(exist_ok=True)
    manifest = {"cell": list(CELL), "cols": COLS, "videos": []}
    old = OUT / "manifest.json"
    if old.exists():  # keep any hand-added Spotify Canvas loops
        loops = json.loads(old.read_text()).get("loops")
        if loops:
            manifest["loops"] = loops
    for v in VIDEOS:
        info = video_info(v["id"])
        sb = list(storyboard_frames(info))
        stills = list(still_frames(v["id"], info["duration"]))
        sb_box, still_box = bars_for(sb), bars_for(stills) if stills else None

        frames = [(t, cover(im, still_box), True) for t, im in stills]
        frames += [(t, cover(im, sb_box), False) for t, im in sb]
        frames.sort(key=lambda f: f[0])

        kept = []
        for t, im, hi in frames:
            if ImageStat.Stat(im.convert("L")).mean[0] < 14:
                continue  # black
            if kept and too_similar(kept[-1][1], im):
                if hi:  # prefer the sharper still over its storyboard twin
                    kept[-1] = (t, im, hi)
                continue
            kept.append((t, im, hi))

        rows = math.ceil(len(kept) / COLS)
        sheet = Image.new("RGB", (COLS * CELL[0], rows * CELL[1]))
        for i, (_, im, _) in enumerate(kept):
            sheet.paste(im, ((i % COLS) * CELL[0], (i // COLS) * CELL[1]))
        name = f"{v['id']}.jpg"
        sheet.save(OUT / name, quality=78, optimize=True, progressive=True)

        manifest["videos"].append({
            **v,
            "url": f"https://www.youtube.com/watch?v={v['id']}",
            "sheet": name,
            "count": len(kept),
            "times": [round(t, 1) for t, _, _ in kept],
        })
        print(f"{v['title']}: {len(kept)} frames -> {name} ({(OUT / name).stat().st_size // 1024} KB)")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
