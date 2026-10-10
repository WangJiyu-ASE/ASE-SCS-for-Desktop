#!/usr/bin/env node
/**
 * 生成应用图标与 NSIS 安装向导图。
 * 规范见 .cursor/skills/scs-brand-assets/SKILL.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import { LOGIN_BRAND, LOGIN_ICON, LOGIN_MARK_LAYOUT } from "./brand-icon.constants.mjs";
import { INSTALLER_ASSETS, INSTALLER_COPY } from "./installer.constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** 超采样倍率（2 足够清晰，4 会明显拖慢 gen:icon） */
const RENDER_SCALE = 2;

const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgba = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] ?? 255) / 255})`;

function loginMarkPaths(fill) {
  return LOGIN_ICON.paths.map((d) => `<path d="${d}" fill="${fill}"/>`).join("");
}

function loginMarkTransform(box, offsetX, offsetY) {
  const [vx, vy, vw] = LOGIN_ICON.viewBox;
  const scale = box / vw;
  const tx = offsetX - vx * scale;
  const ty = offsetY - vy * scale;
  return `translate(${tx} ${ty}) scale(${scale})`;
}

function loginBrandMarkElements(size, originX = 0, originY = 0) {
  const { outerPaddingRatio, boxCornerRatio, glyphInsetRatio, glyphScale } = LOGIN_MARK_LAYOUT;
  const pad = size * outerPaddingRatio;
  const box = size - pad * 2;
  const rx = size * boxCornerRatio;
  const glyphBox = box * glyphScale;
  const glyphOffset = pad + box * glyphInsetRatio;

  return `
    <rect x="${originX}" y="${originY}" width="${size}" height="${size}" rx="${rx}" fill="${rgb(LOGIN_BRAND.appCanvas)}"/>
    <rect x="${originX + pad}" y="${originY + pad}" width="${box}" height="${box}" rx="${rx * 0.85}" fill="${rgb(LOGIN_BRAND.markBackground)}"/>
    <g transform="${loginMarkTransform(glyphBox, originX + glyphOffset, originY + glyphOffset)}">${loginMarkPaths(rgb(LOGIN_BRAND.mark))}</g>
  `;
}

/** 与 web `.login-brand__mark` 一致：浅蓝底 + 主色 safety-certificate */
function loginBrandMarkSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${loginBrandMarkElements(size)}</svg>`;
}

function installerSidebarSvg() {
  const { width: w, height: h } = INSTALLER_ASSETS.sidebar;
  const markSize = 88;
  const x0 = (w - markSize) / 2;
  const y0 = 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${rgb(LOGIN_BRAND.gradientFrom)}"/>
        <stop offset="100%" stop-color="${rgb(LOGIN_BRAND.gradientTo)}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="0%" r="80%">
        <stop offset="0%" stop-color="${rgba(LOGIN_BRAND.glow)}"/>
        <stop offset="70%" stop-color="transparent"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <rect x="0" y="0" width="${w}" height="4" fill="${rgb(LOGIN_BRAND.mark)}"/>
    ${loginBrandMarkElements(markSize, x0, y0)}
    <text x="${w / 2}" y="168" text-anchor="middle" fill="#ffffff" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" font-weight="600">${INSTALLER_COPY.productLine}</text>
    <text x="${w / 2}" y="192" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="11">${INSTALLER_COPY.tagline}</text>
  </svg>`;
}

function installerHeaderSvg() {
  const { width: w, height: h } = INSTALLER_ASSETS.header;
  const markSize = 34;
  const markY = Math.round((h - markSize) / 2);
  const textX = 6 + markSize + 6;
  const textMaxWidth = w - textX - 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="hdr" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${rgb(LOGIN_BRAND.gradientFrom)}"/>
        <stop offset="100%" stop-color="${rgb(LOGIN_BRAND.gradientTo)}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#hdr)"/>
    ${loginBrandMarkElements(markSize, 6, markY)}
    <text x="${textX}" y="${h / 2}" dominant-baseline="middle" fill="#ffffff" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="10" font-weight="600" textLength="${textMaxWidth}" lengthAdjust="spacingAndGlyphs">${INSTALLER_COPY.headerLine}</text>
  </svg>`;
}

function encodeBmp24(rgba, width, height) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const fileSize = 14 + 40 + pixelBytes;
  const out = Buffer.alloc(fileSize);

  out.write("BM", 0);
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    let col = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[offset++] = rgba[i + 2];
      out[offset++] = rgba[i + 1];
      out[offset++] = rgba[i];
      col += 3;
    }
    while (col % 4 !== 0) {
      out[offset++] = 0;
      col++;
    }
  }
  return out;
}

async function rasterSvgToBmp(svg, width, height) {
  const rgba = await sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().raw().toBuffer();
  return encodeBmp24(rgba, width, height);
}

async function buildAppIconIco() {
  const masterSvg = loginBrandMarkSvg(256 * RENDER_SCALE);
  const pngBuffers = [];
  for (const size of ICON_SIZES) {
    const png = await sharp(Buffer.from(masterSvg))
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    pngBuffers.push(png);
  }
  const ico = await pngToIco(pngBuffers);
  return { ico, previewPng: pngBuffers.at(-1) };
}

async function main() {
  const resourcesDir = join(root, "resources");
  const installerDir = join(resourcesDir, "installer");
  mkdirSync(installerDir, { recursive: true });

  const { ico } = await buildAppIconIco();
  writeFileSync(join(resourcesDir, "icon.ico"), ico);

  const { sidebar, header } = INSTALLER_ASSETS;
  writeFileSync(
    join(installerDir, "installerSidebar.bmp"),
    await rasterSvgToBmp(installerSidebarSvg(), sidebar.width, sidebar.height),
  );
  writeFileSync(
    join(installerDir, "installerHeader.bmp"),
    await rasterSvgToBmp(installerHeaderSvg(), header.width, header.height),
  );

  console.log(`[icon] ${join(resourcesDir, "icon.ico")}（${ICON_SIZES.join(", ")} px，png-to-ico）`);
  console.log(`[icon] ${join(installerDir, "installerSidebar.bmp")}`);
  console.log(`[icon] ${join(installerDir, "installerHeader.bmp")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
