/**
 * 清理 electron-builder 的临时输出目录（系统 Temp，不在仓库 release/ 里）。
 */
import { existsSync, rmSync } from "node:fs";
import { resolveBuildOutputDir } from "./packaging.constants.mjs";

export function cleanDirectoryAt(absoluteDir, label = absoluteDir) {
  if (!existsSync(absoluteDir)) {
    return true;
  }
  try {
    rmSync(absoluteDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    console.log(`[clean] 已删除 ${label}`);
    return true;
  } catch (err) {
    console.warn(`[clean] 无法删除 ${label}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export function cleanBuildOutputDirectory() {
  return cleanDirectoryAt(resolveBuildOutputDir(), "electron-builder 临时输出");
}
