// Ambient background: steps through frames pulled from the music videos,
// rendered tiny and ordered-dithered like an old GIF, with dithered dissolves.
// Frames come from frames/manifest.json (see scripts/build_frames.py).
// Optional "loops" in the manifest (e.g. Spotify Canvas mp4s) play through
// the same dither filter.
(() => {
  const canvas = document.getElementById('bg');
  const caption = document.getElementById('bg-caption');
  const toggle = document.getElementById('bg-toggle');
  if (!canvas || !canvas.getContext) return;

  const W = 384, H = 216;      // internal resolution, scaled up pixelated
  const LEVELS = 8;            // colour levels per channel
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = reduce ? 8000 : 1500;   // ms a frame sits still
  const FADE = reduce ? 2000 : 650;    // ms for a dissolve
  const RUN = [8, 18];                 // frames played in sequence before switching videos
  const LOOP_MS = 9000;                // how long a video loop plays

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
  // per-pixel threshold (0..1) and dither offset (in channel units)
  const thresh = new Float32Array(W * H);
  const offset = new Float32Array(W * H);
  const QSTEP = 255 / (LEVELS - 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const b = (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
      thresh[y * W + x] = b;
      offset[y * W + x] = (b - 0.5) * QSTEP;
    }
  }
  const out = ctx.createImageData(W, H);

  let sources = [], cur = null, prev = null;
  let vi = 0, fi = 0, run = 0, runLen = 0;
  let timer = 0, raf = 0, paused = false;

  function grab(src, i) {
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

  // Blend a->b by dithered threshold p (0..1), then ordered-dither to LEVELS.
  function render(a, b, p) {
    const d = out.data;
    for (let i = 0, n = W * H; i < n; i++) {
      const s = b && thresh[i] < p ? b : a, k = i * 4, o = offset[i];
      d[k]     = Math.round((s[k]     + o) / QSTEP) * QSTEP;
      d[k + 1] = Math.round((s[k + 1] + o) / QSTEP) * QSTEP;
      d[k + 2] = Math.round((s[k + 2] + o) / QSTEP) * QSTEP;
      d[k + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  function fmt(t) {
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function setCaption(src, i) {
    if (!caption) return;
    caption.textContent = '';
    const a = document.createElement('a');
    if (src.video) {
      a.href = src.url || src.src;
      a.textContent = src.title;
    } else {
      const t = Math.floor(src.times[i] || 0);
      a.href = src.url + (t ? '&t=' + t + 's' : '');
      a.textContent = src.title + ' @ ' + fmt(t);
    }
    caption.append(a);
    if (src.credit) caption.append(' (' + src.credit + ')');
  }

  function rand(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  // switch to source i at a random spot
  function pick(i) {
    vi = i;
    const s = sources[vi];
    fi = s.video ? 0 : rand(0, s.count - 1);
    run = 0;
    runLen = s.video ? 1 : rand(RUN[0], RUN[1]);
    if (s.video) { s.video.currentTime = 0; s.video.play().catch(() => {}); }
  }

  function advance() {
    if (++run < runLen) { fi = (fi + 1) % sources[vi].count; return; }
    if (sources[vi].video) sources[vi].video.pause();
    pick((vi + 1) % sources.length);
  }

  function next() {
    if (paused || document.hidden || !sources.length) return;
    advance();
    const src = sources[vi];
    prev = cur;
    cur = grab(src, fi);
    setCaption(src, fi);
    const t0 = performance.now();
    let last = 0;
    const tick = now => {
      if (paused) return;
      const p = Math.min(1, (now - t0) / FADE);
      if (now - last > 50 || p === 1) {   // ~20fps is plenty for a dither dissolve
        last = now;
        if (src.video) cur = grab(src, 0);
        render(prev, cur, p);
      }
      if (p < 1) { raf = requestAnimationFrame(tick); return; }
      if (src.video) playLoop(src, now);
      else timer = setTimeout(next, HOLD);
    };
    raf = requestAnimationFrame(tick);
  }

  function playLoop(src, start) {
    let last = 0;
    const tick = now => {
      if (paused) return;
      if (now - start > LOOP_MS) { next(); return; }
      if (now - last > 80) { last = now; cur = grab(src, 0); render(cur, null, 0); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    const s = sources[vi];
    if (s && s.video) s.video.pause();
  }

  function start() {
    stop();
    const s = sources[vi];
    if (s && s.video) s.video.play().catch(() => {});
    next();
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
    const stills = m.videos.map(async v => ({
      ...v, cell: m.cell, cols: m.cols, img: await loadImage('frames/' + v.sheet),
    }));
    const loops = (m.loops || []).map(async l => ({
      ...l, count: 1, video: await loadVideo('frames/' + l.src),
    }));
    sources = (await Promise.allSettled([...stills, ...loops]))
      .filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!sources.length) return;

    // interleave loops between the video stills
    const s = sources.filter(x => !x.video), l = sources.filter(x => x.video);
    sources = [];
    for (let i = 0; i < Math.max(s.length, l.length); i++) {
      if (s[i]) sources.push(s[i]);
      if (l[i]) sources.push(l[i]);
    }

    pick(rand(0, sources.length - 1));
    const first = sources[vi];
    cur = grab(first, fi);
    render(cur, null, 0);
    setCaption(first, fi);
    if (first.video) playLoop(first, performance.now());
    else timer = setTimeout(next, HOLD);
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      paused = !paused;
      toggle.textContent = paused ? 'play' : 'pause';
      if (paused) stop(); else start();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (paused) return;
    if (document.hidden) stop(); else start();
  });

  init().catch(() => {});
})();
