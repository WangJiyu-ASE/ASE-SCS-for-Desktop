#!/usr/bin/env node
/**
 * 生成 resources/icon.ico（256×256，单条 PNG 压缩图像）。
 *
 * 为什么要自己画：本仓库不引入图像处理依赖，而图标必须随包发布。
 * ICO 允许直接内嵌 PNG（Windows Vista+ 支持），所以只要手写 PNG 编码 + ICO 目录即可。
 *
 * 需要换图标时，改下面的 COLORS / 形状参数后重跑：npm run gen:icon
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- 可调参数
const SIZE = 256; // 最终边长
const SS = 4; // 超采样倍率（先画大图再缩，得到抗锯齿边缘）
const CORNER_RATIO = 0.22; // 圆角半径 / 边长

const COLORS = {
  background: [14, 42, 71, 255], // #0E2A47
  building: [232, 241, 250, 255], // #E8F1FA
  roof: [58, 160, 232, 255], // #3AA0E8
};

// 建筑柱体（比例，相对边长）：宽 / 高 / 底距
const BARS = [
  { width: 0.13, height: 0.28 },
  { width: 0.13, height: 0.42 },
  { width: 0.13, height: 0.21 },
];
const BAR_GAP = 0.07;
const BAR_BOTTOM = 0.24; // 距底部
const ROOF_HEIGHT = 0.17; // 屋顶三角高度
const ROOF_OVERHANG = 1.9; // 屋顶半宽 / 柱宽
// ---------------------------------------------------------------------------

const N = SIZE * SS;
const pixels = new Uint8ClampedArray(N * N * 4); // RGBA

function insideRoundedSquare(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const atLeft = x < x0 + radius;
  const atRight = x > x1 - radius;
  const atTop = y < y0 + radius;
  const atBottom = y > y1 - radius;
  if ((atLeft || atRight) && (atTop || atBottom)) {
    const cx = atLeft ? x0 + radius : x1 - radius;
    const cy = atTop ? y0 + radius : y1 - radius;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  }
  return true;
}

function insideTriangle(px, py, apexX, apexY, halfWidth, baseY) {
  if (py < apexY || py > baseY) return false;
  const t = (py - apexY) / (baseY - apexY);
  return Math.abs(px - apexX) <= halfWidth * t;
}

function paint(color) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }
}

function paintWhere(color, test) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!test(x, y)) continue;
      const i = (y * N + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }
}

/** 柱体在超采样坐标下的几何 */
function barRects() {
  const totalWidth = BARS.reduce((sum, bar) => sum + bar.width, 0) + BAR_GAP * (BARS.length - 1);
  let cursor = (1 - totalWidth) / 2;
  return BARS.map((bar) => {
    const rect = {
      x0: cursor * N,
      x1: (cursor + bar.width) * N,
      y1: (1 - BAR_BOTTOM) * N,
      y0: (1 - BAR_BOTTOM - bar.height) * N,
      width: bar.width,
    };
    cursor += bar.width + BAR_GAP;
    return rect;
  });
}

function draw() {
  const radius = CORNER_RATIO * N;
  paintWhere(COLORS.background, (x, y) => insideRoundedSquare(x, y, 0, 0, N - 1, N - 1, radius));

  const rects = barRects();
  paintWhere(COLORS.building, (x, y) =>
    rects.some((rect) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1),
  );

  // 屋顶：盖在中间（最高）那根柱子上
  const top = rects.reduce((best, rect) => (rect.y0 < best.y0 ? rect : best), rects[0]);
  const apexX = (top.x0 + top.x1) / 2;
  const halfWidth = ((top.x1 - top.x0) / 2) * ROOF_OVERHANG;
  paintWhere(COLORS.roof, (x, y) =>
    insideTriangle(x, y, apexX, top.y0 - ROOF_HEIGHT * N, halfWidth, top.y0 + ROOF_HEIGHT * N * 0.55),
  );
}

/** 超采样降采样到 SIZE×SIZE */
function downsample() {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const block = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
        }
      }
      const o = (y * SIZE + x) * 4;
      out[o] = Math.round(r / block);
      out[o + 1] = Math.round(g / block);
      out[o + 2] = Math.round(b / block);
      out[o + 3] = Math.round(a / block);
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前面加一个 filter 字节（0 = None）
  const stride = SIZE * 4;
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 单个 256×256 PNG 条目的 ICO */
function encodeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width  0 = 256
  entry[1] = 0; // height 0 = 256
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
}

// ---------------------------------------------------------------- 输出

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "resources", "icon.ico");

draw();
const ico = encodeIco(encodePng(downsample()));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, ico);
console.log(`[icon] ${target}（${SIZE}×${SIZE}, ${ico.length} 字节）`);
