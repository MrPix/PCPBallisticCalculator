/**
 * Generates the PWA icons (no image libraries, no network).
 * Run with: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [11, 16, 22];
const AMBER = [245, 165, 36];
const LIGHT = [233, 239, 247];
const MUTED = [143, 160, 179];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Trajectory: launches at (0.14,0.70), apex near (0.48,0.28), lands at (0.86,0.82). */
function trajectoryPoints(count = 120) {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = 0.14 + t * 0.72;
    // quadratic Bezier through the control point that produces the apex
    const y = (1 - t) ** 2 * 0.7 + 2 * (1 - t) * t * 0.24 + t ** 2 * 0.82;
    points.push([x, y]);
  }
  return points;
}

const CURVE = trajectoryPoints();

function coverage(distance, halfWidth, size) {
  // 1.5 px of soft edge, whatever the render size is
  const edge = 1.5 / size;
  return Math.max(0, Math.min(1, (halfWidth - distance) / edge + 0.5));
}

function sample(u, v, size) {
  let color = BG;
  let alpha = 1;

  // sight line
  const sight = distToSegment(u, v, 0.1, 0.7, 0.9, 0.7);
  const sightCov = coverage(sight, 0.008, size);
  if (sightCov > 0) {
    color = mix(color, MUTED, sightCov);
  }

  // trajectory curve
  let best = Infinity;
  for (let i = 1; i < CURVE.length; i++) {
    const d = distToSegment(u, v, CURVE[i - 1][0], CURVE[i - 1][1], CURVE[i][0], CURVE[i][1]);
    if (d < best) best = d;
  }
  const curveCov = coverage(best, 0.028, size);
  if (curveCov > 0) color = mix(color, AMBER, curveCov);

  // muzzle
  const muzzle = Math.hypot(u - 0.14, v - 0.7);
  const muzzleCov = coverage(muzzle, 0.045, size);
  if (muzzleCov > 0) color = mix(color, LIGHT, muzzleCov);

  // impact
  const impact = Math.hypot(u - 0.86, v - 0.82);
  const impactCov = coverage(impact, 0.05, size);
  if (impactCov > 0) color = mix(color, AMBER, impactCov);
  const ringCov = coverage(Math.abs(impact - 0.062), 0.008, size);
  if (ringCov > 0) color = mix(color, LIGHT, ringCov * 0.9);

  void alpha;
  return color;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const c = sample(u, v, size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = samples * samples;
      const index = (y * size + x) * 4;
      rgba[index] = r / n;
      rgba[index + 1] = g / n;
      rgba[index + 2] = b / n;
      rgba[index + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
const targets = [
  ["icon-512.png", 512],
  ["icon-192.png", 192],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of targets) {
  const png = render(size);
  writeFileSync(join(outDir, name), png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} bytes)`);
}

// Source artwork for `@capacitor/assets`, which cuts the Android launcher
// icons and splash from these. 1024 is the size that tool expects.
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(assetsDir, { recursive: true });
for (const [name, size] of [
  ["icon.png", 1024],
  ["splash-icon.png", 512],
]) {
  const png = render(size);
  writeFileSync(join(assetsDir, name), png);
  console.log(`wrote assets/${name} (${size}x${size}, ${png.length} bytes)`);
}
