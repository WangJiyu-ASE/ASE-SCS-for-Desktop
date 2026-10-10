import { BrowserWindow, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { IPC, SHELL, WINDOW } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import type { ShellStatus } from "../shared/ShellStatus";
import { AppMenu } from "./AppMenu";
import { DownloadHandler } from "./DownloadHandler";
import { EndpointResolver } from "./EndpointResolver";
import type { EndpointProbeResult } from "./EndpointResolver";
import { RuntimePaths } from "./RuntimePaths";
import { ShellState } from "./ShellState";

/** Chromium 的 ERR_ABORTED：跳转 / SPA 导航的正常中断，不算加载失败 */
const ERR_ABORTED = -3;

/**
 * 壳窗口（单一实体）。
 *
 * 只有一个 BrowserWindow，负责：选地址、加载远端页面、站外链接外抛、
 * 加载失败兜底、下载落盘、窗口位置记忆。业务逻辑一概没有 —— 页面、接口、
 * 媒体全部由站点自己提供，因此 web 仓库零改动。
 */
export class ShellWindow {
  private static current: ShellWindow | null = null;

  /** 创建（或替换）壳窗口 */
  static create(state: ShellState): ShellWindow {
    ShellWindow.current = new ShellWindow(state, new EndpointResolver(state));
    return ShellWindow.current;
  }

  /** 当前窗口（供菜单 / second-instance 使用） */
  static instance(): ShellWindow | null {
    return ShellWindow.current;
  }

  /**
   * 注册兜底页的 IPC 处理器（全局只注册一次）。
   *
   * 兜底页是本地的 `file://` 页面，只有它需要与主进程通信；
   * 远端站点页面拿不到任何桥（preload 只在 file:// 下挂载，这里再校验一次来源）。
   */
  static registerIpc(): void {
    ipcMain.handle(IPC.getStatus, (event: IpcMainInvokeEvent): ShellStatus | null => {
      ShellWindow.assertLocalPage(event);
      return ShellWindow.current?.status() ?? null;
    });

    ipcMain.handle(IPC.retry, async (event: IpcMainInvokeEvent): Promise<boolean> => {
      ShellWindow.assertLocalPage(event);
      await ShellWindow.current?.retry();
      return true;
    });

    ipcMain.handle(IPC.setManual, async (event: IpcMainInvokeEvent, url: unknown): Promise<boolean> => {
      ShellWindow.assertLocalPage(event);
      return (await ShellWindow.current?.useEndpoint(String(url ?? ""))) ?? false;
    });

    ipcMain.handle(IPC.useAuto, async (event: IpcMainInvokeEvent): Promise<boolean> => {
      ShellWindow.assertLocalPage(event);
      await ShellWindow.current?.useAuto();
      return true;
    });
  }

  private readonly win: BrowserWindow;
  private readonly state: ShellState;
  private readonly resolver: EndpointResolver;

  private probes: EndpointProbeResult[] = [];
  private activeUrl: string | null = null;
  private lastError: string | null = null;
  private showingFallback = false;
  private handlingFailure = false;
  private autoFallbackTried = false;

  private constructor(state: ShellState, resolver: EndpointResolver) {
    this.state = state;
    this.resolver = resolver;

    const bounds = state.windowBounds;
    this.win = new BrowserWindow({
      width: bounds?.width ?? WINDOW.width,
      height: bounds?.height ?? WINDOW.height,
      minWidth: WINDOW.minWidth,
      minHeight: WINDOW.minHeight,
      ...(bounds?.x !== undefined && bounds?.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
      show: false,
      backgroundColor: WINDOW.backgroundColor,
      title: WINDOW.titleSuffix,
      webPreferences: {
        preload: RuntimePaths.preloadScript(),
        contextIsolation: true,
        nodeIntegration: false,
        // sandbox 关闭是为了让 preload 能复用 ShellConstants（沙箱 preload 不支持相对 require，
        // 见 https://www.electronjs.org/docs/latest/tutorial/sandbox）。远端页面仍然零 Node 能力。
        sandbox: false,
        // 打开 Chromium 内置 PDF 阅读器：页面的 PDF 预览走 <iframe src="blob:">，桌面端原生可渲染
        plugins: true,
        spellcheck: false,
      },
    });

    if (bounds?.maximized) this.win.maximize();
    this.win.once("ready-to-show", () => this.win.show());

    DownloadHandler.attach(this.win.webContents.session);
    this.attachNavigation();
    this.attachLoadLifecycle();
    this.attachTitle();
    this.attachBoundsPersistence();
    AppMenu.build({
      retry: () => void this.retry(),
      useAuto: () => void this.useAuto(),
      useEndpoint: (url) => void this.useEndpoint(url),
      reload: () => this.win.webContents.reload(),
    });

    void this.loadActive();
  }

  // ---------------------------------------------------------------- 对外动作

  /** 重新探测并加载（菜单 / 兜底页「重试」） */
  async retry(): Promise<void> {
    this.autoFallbackTried = false;
    await this.loadActive();
  }

  /** 回到自动模式（清掉手动指定） */
  async useAuto(): Promise<void> {
    this.state.setManualEndpoint(null);
    this.autoFallbackTried = false;
    await this.loadActive();
  }

  /** 指定站点地址（菜单 / 兜底页手填） */
  async useEndpoint(raw: string): Promise<boolean> {
    const url = EndpointResolver.normalizeEndpoint(raw);
    if (!url) {
      this.lastError = `地址无法识别：${raw}`;
      return false;
    }
    this.state.setManualEndpoint(url);
    this.autoFallbackTried = false;
    await this.loadActive();
    return true;
  }

  /** 把窗口带到前台 */
  focus(): void {
    if (this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  /** 兜底页展示用的状态快照 */
  status(): ShellStatus {
    return {
      candidates: this.probes,
      active: this.activeUrl,
      manual: this.state.manualEndpoint,
      showingFallback: this.showingFallback,
      lastError: this.lastError,
      appVersion: ShellIdentity.appVersion(),
      webCommit: ShellIdentity.webCommit(),
      buildTime: ShellIdentity.buildTime(),
    };
  }

  // ---------------------------------------------------------------- 加载流程

  /** 解析地址并加载；无可用地址则进兜底页 */
  private async loadActive(): Promise<void> {
    const outcome = await this.resolver.resolve();
    this.probes = outcome.probes;
    this.lastError = outcome.error;
    if (outcome.url) {
      this.showingFallback = false;
      this.activeUrl = outcome.url;
      this.loadUrlQuietly(outcome.url);
    } else {
      await this.showFallback();
    }
    // 兜底：resolve 期间窗口一直是隐藏的，保证最迟在解析结束后一定可见
    if (!this.win.isDestroyed() && !this.win.isVisible()) this.win.show();
  }

  /** 切到本地兜底页 */
  private async showFallback(): Promise<void> {
    this.showingFallback = true;
    this.win.setTitle(WINDOW.fallbackTitle);
    await this.win.loadFile(RuntimePaths.fallbackPage());
  }

  /**
   * 加载但不等待：失败一律交给 `did-fail-load` 统一处理。
   * 刻意不 await —— `loadURL` 在失败时会 reject，await 会把异常抛进调用方，
   * 反而绕过统一的失败处理。
   */
  private loadUrlQuietly(url: string): void {
    void this.win.loadURL(url).catch(() => undefined);
  }

  /** 加载失败：优先换一个候选地址重试一次，仍不行才进兜底页 */
  private async handleLoadFailure(description: string, failedUrl: string): Promise<void> {
    if (this.showingFallback || this.handlingFailure) return;
    this.handlingFailure = true;
    this.lastError = `${description}（${failedUrl}）`;
    try {
      const outcome = await this.resolver.resolve();
      this.probes = outcome.probes;
      if (outcome.url && outcome.url !== this.activeUrl && !this.autoFallbackTried) {
        // 内网⇄公网之间自动跳一次，覆盖「换了网络环境」的常见场景
        this.autoFallbackTried = true;
        this.activeUrl = outcome.url;
        this.handlingFailure = false; // 允许这次跳转若再失败时继续被处理
        this.loadUrlQuietly(outcome.url);
        return;
      }
      await this.showFallback();
    } finally {
      this.handlingFailure = false;
    }
  }

  // ---------------------------------------------------------------- 事件装配

  /** 站内留在壳内，站外（含 mailto: / tel:）交系统浏览器 */
  private attachNavigation(): void {
    const contents = this.win.webContents;

    contents.setWindowOpenHandler(({ url }) => {
      if (ShellWindow.isInApp(url)) {
        this.loadUrlQuietly(url);
        return { action: "deny" };
      }
      void ShellWindow.openExternal(url);
      return { action: "deny" };
    });

    contents.on("will-navigate", (event, url) => {
      if (ShellWindow.isInApp(url)) return;
      event.preventDefault();
      void ShellWindow.openExternal(url);
    });
  }

  private attachLoadLifecycle(): void {
    this.win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (errorCode === ERR_ABORTED) return;
        void this.handleLoadFailure(errorDescription, validatedURL);
      },
    );

    this.win.webContents.on("did-finish-load", () => {
      // 远端页面成功加载 → 允许下一次「换地址」自动跳转
      if (this.win.webContents.getURL().startsWith("http")) this.autoFallbackTried = false;
    });
  }

  /** 标题统一为「<页面标题> · 智慧工地」 */
  private attachTitle(): void {
    this.win.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (this.showingFallback) {
        this.win.setTitle(WINDOW.fallbackTitle);
        return;
      }
      const suffix = WINDOW.titleSuffix;
      this.win.setTitle(!title || title === suffix ? suffix : `${title} · ${suffix}`);
    });
  }

  /** 关闭时记住窗口位置与尺寸 */
  private attachBoundsPersistence(): void {
    this.win.on("close", () => {
      const maximized = this.win.isMaximized();
      const bounds = maximized ? this.win.getNormalBounds() : this.win.getBounds();
      this.state.setWindowBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized,
      });
    });
  }

  // ---------------------------------------------------------------- 工具

  /** 是否属于壳内的地址 */
  private static isInApp(raw: string): boolean {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "file:") return true;
      if (parsed.protocol !== "https:") return false;
      return SHELL.allowedHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  /** 只把安全的协议交给系统浏览器 */
  private static async openExternal(raw: string): Promise<void> {
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) return;
      await shell.openExternal(raw);
    } catch {
      // 无法解析的链接直接忽略
    }
  }

  /** 只接受来自本地兜底页（file://）的调用 */
  private static assertLocalPage(event: IpcMainInvokeEvent): void {
    const url = event.senderFrame?.url ?? event.sender.getURL();
    if (!url.startsWith("file://")) {
      throw new Error("shell: 拒绝来自非本地页面的调用");
    }
  }
}
