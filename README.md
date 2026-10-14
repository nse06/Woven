# woven

Website for the band woven. Plain static files, no build step.

- `index.html`, `style.css`: the page (craigslist-style)
- `bg.js`: ambient background. It shows random frames from all the music videos (never the same video twice in a row), drawn small and ordered-dithered like an old GIF, holding each for 1.5 seconds with a 2.5-second TV-static dissolve between them, so it's moving most of the time. With reduced motion turned on in the OS, it shows one still frame.
- `fonts/`: Questrial, for the struck-through "woven" header (SIL Open Font License, in `fonts/OFL.txt`)
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

## shows

The shows submenu lists upcoming shows by hand in `index.html`, one `<li data-until="...">` per show, followed by a link to woven's [DICE artist page](https://dice.fm/artist/woven-3d5kx). Each show drops off once its `data-until` time passes, and the count updates with it. When none are left it says "nothing booked right now", so add a row whenever a show's booked.

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
  { "src": "silk-canvas.mp4" }
]
```

A loop plays after every 6 frames, for about 9 seconds each time.
