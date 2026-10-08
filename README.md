# woven

Website for the band woven. Plain static files, no build step.

- `index.html`, `style.css`: the page (craigslist-style)
- `bg.js`: ambient background. It steps through frames from the music videos, drawn small and ordered-dithered like an old GIF, with dithered dissolves between them. The footer shows which video and timestamp is on screen and links straight to that moment on YouTube.
- `frames/`: one sprite sheet per music video, plus `manifest.json`
- `scripts/build_frames.py`: regenerates `frames/`

## run locally

```sh
python3 -m http.server
# open http://localhost:8000
```

(It has to be served over http. Opening `index.html` as a file won't load the frames.)

## deploy

Any static host works. For GitHub Pages: Settings → Pages → deploy from branch, root folder.

## new music video?

Add it to `VIDEOS` in `scripts/build_frames.py`, then:

```sh
pip install "yt-dlp[default]" pillow   # yt-dlp also needs node or deno installed
python3 scripts/build_frames.py
```

Add a row for it under "music videos" in `index.html` too.

## spotify canvas loops

The background can also play short video loops, like Spotify Canvas clips, through the same dither filter. Spotify only serves Canvas files to logged-in accounts, so they aren't included yet. To add one, drop the mp4 in `frames/` and add a `loops` list to `frames/manifest.json`:

```json
"loops": [
  { "src": "silk-canvas.mp4", "title": "silk (canvas)", "url": "https://open.spotify.com/album/73RR2s5z2rAJ5YwA4khrBp" }
]
```

Loops are shuffled in between the music videos. Each one plays for about 9 seconds.
