import { app, BrowserWindow, session } from "electron";
import { SHELL } from "../constants/ShellConstants";
import { CertificateTrust } from "./CertificateTrust";
import { ShellState } from "./ShellState";
import { ShellWindow } from "./ShellWindow";

/**
 * 主进程入口（单一实体）。
 *
 * 只负责编排：单实例锁 → 装证书信任 → 注册兜底页 IPC → 建窗。业务逻辑在 ShellWindow 里。
 */

// 视频监控（flv.js）必须能自动播放，不能要求用户先点一下
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Windows 任务栏分组 / 通知归属（其它平台为 no-op）
app.setAppUserModelId(SHELL.appId);

const state = new ShellState();

if (!app.requestSingleInstanceLock()) {
  // 已有实例在跑：直接退出，交由既有实例聚焦
  app.quit();
} else {
  app.on("second-instance", () => ShellWindow.instance()?.focus());

  app.whenReady().then(() => {
    state.load();

    // 让后端日志能区分「来自桌面壳」的请求
    app.userAgentFallback = `${app.userAgentFallback} ${SHELL.userAgentSuffix}`;

    CertificateTrust.install(session.defaultSession);
    ShellWindow.registerIpc();
    ShellWindow.create(state);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) ShellWindow.create(state);
    });
  });

  app.on("window-all-closed", () => {
    // macOS 习惯是关掉窗口仍留在 Dock；Windows 上直接退出
    if (process.platform !== "darwin") app.quit();
  });
}
