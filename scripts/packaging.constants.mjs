import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 仓库内交付目录：只放安装包等最终产物，**不再**在此生成 win-unpacked。
 * 根因：win-unpacked/resources/app.asar 在仓库内会被 IDE/资源管理器占用，electron-builder 无法覆盖。
 */
export const RELEASE_DIR = "release";

/** 安装包文件名（与 electron-builder.yml → artifactName 一致） */
export const INSTALLER_FILE = "SCS Setup.exe";

/** electron-builder 实际输出根目录（系统临时目录，与仓库隔离） */
export const BUILD_OUTPUT_BASENAME = "ase-scs-for-desktop-electron-out";

export function resolveBuildOutputDir() {
  return join(tmpdir(), BUILD_OUTPUT_BASENAME);
}

/** 打包前尝试结束的进程（仅 Windows） */
export const BLOCKING_PROCESS_NAMES = ["SCS.exe", "SCS Setup.exe"];

/** electron-builder 参数：NSIS 安装包 x64 */
export const ELECTRON_BUILDER_ARGS = ["--win", "nsis", "--x64"];

/** 复制到 release/ 的文件（相对构建输出根目录） */
export const DELIVERY_ARTIFACTS = [INSTALLER_FILE, `${INSTALLER_FILE}.blockmap`];
