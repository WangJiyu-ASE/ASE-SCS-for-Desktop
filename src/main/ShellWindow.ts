import { BrowserWindow, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { IPC, SHELL, WINDOW } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import type { ShellStatus } from "../shared/ShellStatus";
import { AppMenu } from "./AppMenu";
import { DownloadHandler } from "./DownloadHandler";
import { RuntimePaths } from "./RuntimePaths";
import { SiteResolver } from "./SiteResolver";
import type { SiteProbeResult } from "./SiteResolver";
import { ShellState } from "./ShellState";

/** Chromium 的 ERR_ABORTED：跳转 / SPA 导航的正常中断，不算加载失败 */
const ERR_ABORTED = -3;

/**
 * 壳窗口（单一实体）。
 *
 * 只有一个 BrowserWindow，负责：加载站点、站外链接外抛、加载失败兜底、
 * 下载落盘、窗口位置记忆。业务逻辑一概没有 —— 页面、接口、媒体全部由站点自己提供，
 * 因此 web 仓库零改动。
 */
export class ShellWindow {
  private static current: ShellWindow | null = null;

  /** 创建（或替换）壳窗口 */
  static create(state: ShellState): ShellWindow {
    ShellWindow.current = new ShellWindow(state, new SiteResolver(state));
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
      await ShellWindow.current?.useDefault();
      return true;
    });
  }

  private readonly win: BrowserWindow;
  private readonly state: ShellState;
  private readonly resolver: SiteResolver;

  private probes: SiteProbeResult[] = [];
  private activeUrl: string | null = null;
  private lastError: string | null = null;
  private showingFallback = false;
  private handlingFailure = false;
  private navTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(state: ShellState, resolver: SiteResolver) {
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
      useDefault: () => void this.useDefault(),
      reload: () => this.win.webContents.reload(),
    });

    void this.loadActive();
  }

  // ---------------------------------------------------------------- 对外动作

  /** 重新加载（菜单 / 兜底页「重试」） */
  async retry(): Promise<void> {
    await this.loadActive();
  }

  /** 回到默认站点地址（清掉手动指定） */
  async useDefault(): Promise<void> {
    this.state.setManualEndpoint(null);
    await this.loadActive();
  }

  /** 指定站点地址（兜底页手填） */
  async useEndpoint(raw: string): Promise<boolean> {
    const url = SiteResolver.normalizeEndpoint(raw);
    if (!url) {
      this.lastError = `地址无法识别：${raw}`;
      return false;
    }
    this.state.setManualEndpoint(url);
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

  /**
   * 加载当前地址。
   *
   * 内置站点地址**不做启动探活**，直接加载 —— 只有一个地址时，先探测再加载纯属白等
   * （公网链路一次探活要 2 秒以上）。
   *
   * 但手输 / 命令行 / 环境变量这类**覆盖地址**可能写错（含指向不可路由的 IP），
   * 那种地址导航会一直卡在空白页；因此先做一次有时限的探测，不通就直接进兜底页。
   */
  private async loadActive(): Promise<void> {
    const target = this.resolver.target();
    this.showingFallback = false;
    this.activeUrl = target.url;

    if (target.override && !(await this.resolver.reachable(target))) {
      this.lastError = `地址不可达（${target.label}）：${target.url}`;
      await this.failToFallback();
      return;
    }

    this.loadUrlQuietly(target.url);
    // 兜底：保证最迟在这里窗口一定可见
    if (!this.win.isDestroyed() && !this.win.isVisible()) this.win.show();
  }

  /** 切到本地兜底页 */
  private async showFallback(): Promise<void> {
    this.clearNavigationWatchdog();
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
    this.armNavigationWatchdog(url);
    void this.win.loadURL(url).catch(() => undefined);
  }

  /** 加载失败：诊断可达性后进兜底页 */
  private async handleLoadFailure(description: string, failedUrl: string): Promise<void> {
    this.clearNavigationWatchdog();
    if (this.showingFallback || this.handlingFailure) return;
    this.lastError = `${description}（${failedUrl}）`;
    await this.failToFallback();
  }

  /** 探测 + 切兜底页（诊断结果供页面展示） */
  private async failToFallback(): Promise<void> {
    this.handlingFailure = true;
    try {
      this.probes = await this.resolver.diagnose();
      await this.showFallback();
    } finally {
      this.handlingFailure = false;
    }
  }

  // ---------------------------------------------------------------- 导航看门狗

  /**
   * 对每次程序化导航上闹钟。
   *
   * 页面若能连上会很快结束并撤销闹钟；对「DNS 能解析、TCP 却被黑洞丢掉」的地址，
   * 没有闹钟就会白屏到系统 TCP 超时（macOS 约 75 秒）。
   */
  private armNavigationWatchdog(url: string): void {
    this.clearNavigationWatchdog();
    this.navTimer = setTimeout(() => {
      this.navTimer = null;
      void this.handleLoadFailure("加载超时", url);
    }, WINDOW.navigationTimeoutMs);
  }

  private clearNavigationWatchdog(): void {
    if (this.navTimer) {
      clearTimeout(this.navTimer);
      this.navTimer = null;
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

    // 导航正常结束 → 撤销看门狗
    this.win.webContents.on("did-finish-load", () => this.clearNavigationWatchdog());
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
