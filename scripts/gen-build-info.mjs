#!/usr/bin/env node
/**
 * 生成 src/generated/BuildInfo.ts。
 *
 * 为什么要生成而不是写死：兜底页与「关于」要能回答「壳里的页面是不是最新版」，
 * 这就必须把构建时锁定的 web submodule 提交号注入进去。
 *
 * 为什么用 `git ls-tree HEAD web`（而不是读 submodule 工作区）：
 * 它**无需初始化 submodule** 就能取到 pin —— CI 检出时不必拉取私有子仓库，
 * 也就不需要为子仓库单独配 token。
 *
 * 本脚本永不失败：取不到值就写 unknown，保证 postinstall / 构建链不被打断。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readWebCommit() {
  // 优先读提交树；仓库还没有首个提交时（`HEAD` 不存在）退回读暂存区，
  // 两者都记录着 web 的 gitlink，效果一致。
  for (const args of [
    ["ls-tree", "HEAD", "web"],
    ["ls-files", "-s", "web"],
  ]) {
    try {
      const out = execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const matched = /(?:commit\s+|[0-9a-f]{6}\s+)([0-9a-f]{7,40})/.exec(out);
      if (matched) return matched[1];
    } catch {
      // 换下一种取法
    }
  }
  return "unknown";
}

const content = `/**
 * 构建期信息（自动生成，请勿手改）。
 *
 * 由 scripts/gen-build-info.mjs 生成，已加入 .gitignore（\`npm install\` 的 postinstall 会自动补上）。
 * 手工刷新：npm run gen:build-info
 */
export const BUILD_INFO = {
  /** 壳自身版本，取自 package.json */
  APP_VERSION: ${JSON.stringify(readVersion())},
  /** 构建时锁定的 web submodule 提交号（web/ 当前指向的版本） */
  WEB_COMMIT: ${JSON.stringify(readWebCommit())},
  /** 构建时间（ISO 8601） */
  BUILD_TIME: ${JSON.stringify(new Date().toISOString())},
} as const;
`;

const target = join(root, "src", "generated", "BuildInfo.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, content, "utf8");
console.log(`[build-info] ${target}`);
