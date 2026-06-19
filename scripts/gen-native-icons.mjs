// Renders the notes mark (public/favicon.svg) to 1024x1024 PNGs for the
// native app's assets/ with no third-party deps — only node:zlib. The mark is
// a document outline with a folded corner and two text lines, all stroked with
// a vertical green gradient over the dark theme background, so we rasterize it
// analytically (signed distance to each stroke segment, capsule = round
// caps/joins) with 1px anti-aliasing and encode an opaque truecolor PNG by
// hand. Run from the repo root: `node scripts/gen-native-icons.mjs`.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const VIEW = 64;
// Stroke segments from the favicon `d` attributes (viewBox 0 0 64 64):
//   document outline  M20 16 H38 L46 24 V48 H20 Z
//   folded corner     M38 16 V24 H46
//   two text lines    M26 31 H40 / M26 38 H40
// Each entry is a polyline; consecutive points become capsule segments, so the
// round joins/caps the SVG asks for fall out of the distance field for free.
const POLYLINES = [
  [
    [20, 16],
    [38, 16],
    [46, 24],
    [46, 48],
    [20, 48],
    [20, 16],
  ],
  [
    [38, 16],
    [38, 24],
    [46, 24],
  ],
  [
    [26, 31],
    [40, 31],
  ],
  [
    [26, 38],
    [40, 38],
  ],
];
const STROKE = 4;
// Gradient stops (top -> bottom of the mark's bounding box).
const TOP = [0x6e, 0xe7, 0xb7]; // #6ee7b7
const BOT = [0x34, 0xd3, 0x99]; // #34d399
const THEME = [0x1f, 0x29, 0x33]; // #1f2933 — icon / adaptive background (favicon rect)
const SPLASH_BG = [0x1d, 0x20, 0x27]; // #1d2027 — splash background (One Dark page-bg)

function hexlerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Distance from point (px,py) to segment (ax,ay)-(bx,by).
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// size: output dimension; frac: fraction of the canvas the 64-unit art box
// fills (1 = full bleed, <1 = padded/centred); bg: background RGB.
function render(size, frac, bg) {
  const scale = (size * frac) / VIEW;
  const off = (size - VIEW * scale) / 2;
  const segs = [];
  for (const line of POLYLINES) {
    for (let i = 0; i < line.length - 1; i++) {
      segs.push([
        off + line[i][0] * scale,
        off + line[i][1] * scale,
        off + line[i + 1][0] * scale,
        off + line[i + 1][1] * scale,
      ]);
    }
  }
  const halfW = (STROKE * scale) / 2;
  // Gradient spans the mark's bbox in y: viewBox 16..48 -> device coords.
  const gy0 = off + 16 * scale;
  const gy1 = off + 48 * scale;

  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    const gt = Math.max(0, Math.min(1, (y + 0.5 - gy0) / (gy1 - gy0)));
    const stroke = hexlerp(TOP, BOT, gt);
    for (let x = 0; x < size; x++) {
      let d = Infinity;
      for (const s of segs) {
        const dd = distToSeg(x + 0.5, y + 0.5, s[0], s[1], s[2], s[3]);
        if (dd < d) d = dd;
      }
      // Coverage: 1 inside, ramps to 0 across a 1px edge band.
      const cov = Math.max(0, Math.min(1, halfW + 0.5 - d));
      const o = rowStart + 1 + x * 3;
      raw[o] = Math.round(bg[0] + (stroke[0] - bg[0]) * cov);
      raw[o + 1] = Math.round(bg[1] + (stroke[1] - bg[1]) * cov);
      raw[o + 2] = Math.round(bg[2] + (stroke[2] - bg[2]) * cov);
    }
  }
  return raw;
}

// --- minimal PNG encoder (truecolor, 8-bit, no alpha) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB (no alpha)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function emit(path, size, frac, bg) {
  writeFileSync(path, encodePng(size, render(size, frac, bg)));
  console.log(`wrote ${path} (${size}x${size})`);
}

// icon.png: full-bleed, matches the favicon proportions (opaque, no alpha
// per Apple's marketing-icon requirement).
emit("native/assets/icon.png", 1024, 1.0, THEME);
// adaptive-icon.png: Android masks the outer ring, so pad the mark into the
// central safe zone over the theme background (matches app.json backgroundColor).
emit("native/assets/adaptive-icon.png", 1024, 0.66, THEME);
// splash.png: smaller centred mark on the splash background.
emit("native/assets/splash.png", 1024, 0.42, SPLASH_BG);
