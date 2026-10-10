#!/usr/bin/env node
/**
 * Windows 安装包：临时目录构建 → 复制到 release/SCS Setup.exe
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBuildOutputDirectory } from "./clean-release.mjs";
import {
  BLOCKING_PROCESS_NAMES,
  DELIVERY_ARTIFACTS,
  ELECTRON_BUILDER_ARGS,
  INSTALLER_FILE,
  RELEASE_DIR,
  resolveBuildOutputDir,
} from "./packaging.constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const electronBuilder = join(root, "node_modules", "electron-builder", "cli.js");

class WinPackager {
  constructor(projectRoot = root) {
    this.projectRoot = projectRoot;
    this.buildOutputDir = resolveBuildOutputDir();
  }

  run() {
    console.log("[package-win] 开始打包");
    this.stopBlockingProcesses();
    cleanBuildOutputDirectory();

    this.runStep("gen-build-info", [node, join(root, "scripts", "gen-build-info.mjs")]);
    this.runStep("gen-icon", [node, join(root, "scripts", "gen-icon.mjs")]);
    this.runStep("tsc", [node, tsc, "-p", "tsconfig.json"]);
    this.runElectronBuilder();
    const installer = this.copyDeliveryArtifacts();
    if (!installer) {
      console.error("[package-win] 未生成安装包");
      process.exit(1);
    }
    console.log(`[package-win] 完成：${installer}`);
  }

  copyDeliveryArtifacts() {
    const releaseDir = join(this.projectRoot, RELEASE_DIR);
    mkdirSync(releaseDir, { recursive: true });
    let installer = null;
    for (const name of DELIVERY_ARTIFACTS) {
      const src = join(this.buildOutputDir, name);
      if (!existsSync(src)) continue;
      const dest = join(releaseDir, name);
      let written = dest;
      try {
        copyFileSync(src, dest);
      } catch (err) {
        written = join(this.projectRoot, name);
        copyFileSync(src, written);
        console.warn(`[package-win] ${RELEASE_DIR}/ 被占用，改放到项目根目录`);
        console.warn(err instanceof Error ? err.message : err);
      }
      console.log(`[package-win] ${written}`);
      if (name === INSTALLER_FILE) installer = written;
    }
    return installer;
  }

  stopBlockingProcesses() {
    if (process.platform !== "win32") return;
    for (const name of BLOCKING_PROCESS_NAMES) {
      const r = spawnSync("taskkill", ["/IM", name, "/F", "/T"], { stdio: "ignore", windowsHide: true });
      if (r.status === 0) console.log(`[package-win] 已结束 ${name}`);
    }
  }

  runStep(label, command) {
    console.log(`[package-win] ${label}`);
    const r = spawnSync(command[0], command.slice(1), {
      cwd: this.projectRoot,
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false" },
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  runElectronBuilder() {
    if (!existsSync(electronBuilder)) {
      console.error("[package-win] 请先 npm install");
      process.exit(1);
    }
    const configArg = `--config.directories.output=${this.buildOutputDir}`;
    this.runStep("electron-builder", [node, electronBuilder, ...ELECTRON_BUILDER_ARGS, configArg]);
  }
}

new WinPackager().run();
