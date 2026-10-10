import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../constants/ShellConstants";

/**
 * 兜底页专用 preload。
 *
 * 只在本地兜底页（`file://`）上挂桥；远端站点页面什么也拿不到 ——
 * 主进程侧还会再校验一次 IPC 来源，双保险。
 *
 * 注意：这里刻意保持「能相对 require 本项目文件」的写法（复用 ShellConstants），
 * 因此窗口用的是 `sandbox: false` + `contextIsolation: true`；
 * 沙箱化 preload 的 require 是受限 polyfill，无法加载相对模块。
 */
function install(): void {
  if (typeof window === "undefined") return;
  if (window.location.protocol !== "file:") return;

  contextBridge.exposeInMainWorld(IPC.bridgeName, {
    getStatus: () => ipcRenderer.invoke(IPC.getStatus),
    retry: () => ipcRenderer.invoke(IPC.retry),
    useAuto: () => ipcRenderer.invoke(IPC.useAuto),
    setManual: (url: string) => ipcRenderer.invoke(IPC.setManual, url),
  });
}

install();
