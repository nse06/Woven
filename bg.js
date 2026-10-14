// Ambient background: random frames pulled from the music videos, rendered
// tiny and ordered-dithered like an old GIF, with slow crossfades.
// Frames come from frames/manifest.json (see scripts/build_frames.py).
// Optional "loops" in the manifest (e.g. Spotify Canvas mp4s) play through
// the same dither filter every few frames. With reduced motion turned on,
// it shows one still frame and stays put.
(() => {
  const canvas = document.getElementById('bg');
  if (!canvas || !canvas.getContext) return;

  const W = 384, H = 216;      // internal resolution, scaled up pixelated
  const LEVELS = 8;            // colour levels per channel
  const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = 5000;           // ms a frame sits still
  const FADE = 2500;           // ms for a crossfade
  const LOOP_EVERY = 6;        // frames between video loops, if there are any
  const LOOP_MS = 9000;        // how long a video loop plays

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d', { willReadFrequently: true });

  const BAYER = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ];
  // per-pixel dither offset, in channel units
  const offset = new Float32Array(W * H);
  const QSTEP = 255 / (LEVELS - 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      offset[y * W + x] = ((BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * QSTEP;
    }
  }
  const out = ctx.createImageData(W, H);

  let stills = [], loops = [], deck = [];
  let card = null, cur = null, prev = null;   // card = { src, i }: what's on screen
  let sinceLoop = 0, loopIdx = 0;
  let timer = 0, raf = 0;

  function grab({ src, i }) {
    if (src.video) {
      // cover-crop (Spotify Canvas loops are portrait)
      const v = src.video, vw = v.videoWidth, vh = v.videoHeight;
      const s = Math.min(vw / W, vh / H), cw = W * s, ch = H * s;
      octx.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, W, H);
    } else {
      const [cw, ch] = src.cell;
      const sx = (i % src.cols) * cw, sy = Math.floor(i / src.cols) * ch;
      octx.drawImage(src.img, sx, sy, cw, ch, 0, 0, W, H);
    }
    return octx.getImageData(0, 0, W, H).data;
  }

  // Crossfade a->b (p = 0..1), then ordered-dither down to LEVELS.
  function render(a, b, p) {
    const d = out.data, s = b || a, q = 1 - p;
    for (let i = 0, k = 0, n = W * H; i < n; i++, k += 4) {
      const o = offset[i];
      d[k]     = Math.round((a[k]     * q + s[k]     * p + o) / QSTEP) * QSTEP;
      d[k + 1] = Math.round((a[k + 1] * q + s[k + 1] * p + o) / QSTEP) * QSTEP;
      d[k + 2] = Math.round((a[k + 2] * q + s[k + 2] * p + o) / QSTEP) * QSTEP;
      d[k + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Pick the next card: a random frame from a random video, never from the
  // same video twice in a row. The deck holds every frame, so a frame rarely
  // comes back before the rest have been shown.
  function draw() {
    if (loops.length && (!stills.length || ++sinceLoop >= LOOP_EVERY)) {
      sinceLoop = 0;
      return { src: loops[loopIdx++ % loops.length], i: 0 };
    }
    const fresh = () => shuffle(stills.flatMap(src =>
      Array.from({ length: src.count }, (_, i) => ({ src, i }))));
    const last = card && card.src;
    const pick = () => {
      for (let k = deck.length - 1; k >= 0; k--) if (deck[k].src !== last) return k;
      return -1;
    };
    if (!deck.length) deck = fresh();
    let k = pick();
    if (k < 0 && stills.length > 1) {   // all that's left is from the video on screen
      deck = fresh().concat(deck);
      k = pick();
    }
    return deck.splice(k < 0 ? deck.length - 1 : k, 1)[0];
  }

  function show(next) {
    if (card && card.src.video && card.src !== next.src) card.src.video.pause();
    if (next.src.video) {
      next.src.video.currentTime = 0;
      next.src.video.play().catch(() => {});
    }
    card = next;
  }

  function step() {
    if (document.hidden || !(stills.length || loops.length)) return;
    show(draw());
    const c = card;
    prev = cur;
    cur = grab(c);
    const t0 = performance.now();
    let last = 0;
    const tick = now => {
      const t = Math.min(1, (now - t0) / FADE);
      if (now - last > 50 || t === 1) {   // ~20fps is plenty for a dithered fade
        last = now;
        if (c.src.video) cur = grab(c);
        render(prev, cur, t * t * (3 - 2 * t));   // eased
      }
      if (t < 1) { raf = requestAnimationFrame(tick); return; }
      if (c.src.video) playLoop(c, now);
      else timer = setTimeout(step, HOLD);
    };
    raf = requestAnimationFrame(tick);
  }

  function playLoop(c, start) {
    let last = 0;
    const tick = now => {
      if (now - start > LOOP_MS) { step(); return; }
      if (now - last > 80) { last = now; cur = grab(c); render(cur, null, 0); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    if (card && card.src.video) card.src.video.pause();
  }

  function start() {
    stop();
    step();
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function loadVideo(src) {
    return new Promise((res, rej) => {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.oncanplay = () => res(v);
      v.onerror = rej;
      v.src = src;
    });
  }

  async function init() {
    const m = await fetch('frames/manifest.json').then(r => r.json());
    const loaded = async ps => (await Promise.allSettled(ps))
      .filter(r => r.status === 'fulfilled').map(r => r.value);
    stills = await loaded(m.videos.map(async v => ({
      ...v, cell: m.cell, cols: m.cols, img: await loadImage('frames/' + v.sheet),
    })));
    loops = await loaded((m.loops || []).map(async l => ({
      ...l, count: 1, video: await loadVideo('frames/' + l.src),
    })));
    if (!stills.length && !loops.length) return;

    show(draw());
    cur = grab(card);
    render(cur, null, 0);
    if (STILL) { stop(); return; }
    if (card.src.video) playLoop(card, performance.now());
    else timer = setTimeout(step, HOLD);
  }

  document.addEventListener('visibilitychange', () => {
    if (STILL) return;
    if (document.hidden) stop(); else start();
  });

  init().catch(() => {});
})();
