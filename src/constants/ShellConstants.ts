/**
 * 壳的全部常量（单一事实来源）。
 *
 * 站点地址、探测参数、允许主机等都写在这里 —— 换地址只改本文件，
 * 不要把字面量散落到业务代码里。
 */

export const SHELL = {
  /** 产品名。窗口标题、快捷方式、安装目录都取它 */
  productName: "SCS",

  /** Windows 应用标识（任务栏分组 / 通知归属）。装机后不要随意变更 */
  appId: "jp.ase.smartconstruction.desktop",

  /** 追加到 User-Agent 的标识，便于后端日志区分「来自桌面壳」的请求 */
  userAgentSuffix: "AseShell/Windows",

  /**
   * 站点地址（**唯一**）。
   *
   * 自 web v4.2（2026-10-10）起，站点改用域名 + **Let's Encrypt** 证书，并开启了 NAT 回环：
   * 内外网**都走这一个域名**，因此壳不再需要「内网/公网双地址探测与回退」。
   *
   * 不要改回 IP 直连：Let's Encrypt 只签 DNS 名、**不签 IP**，
   * `https://36.129.168.66:8081/` 与 `https://172.23.109.240:8081/` 都会报证书不匹配。
   *
   * ⚠️ 末尾的 `/` 必须保留：页面里的 `/api/v1`、`/media/...` 都是相对路径，
   * 丢了斜杠会让它们解析到上一层。
   */
  siteUrl: "https://ase-scs.top:8081/",

  /** 探活路径（相对站点根），仅在加载失败后用于诊断兜底页展示 */
  probePath: "api/v1/health",

  /**
   * 探活超时（毫秒）。
   *
   * 依据（2026-10-09 实测）：经路由器 NAT 出去时，仅 TLS 握手就要 1.5–4.7 秒、
   * 整请求 3.6–7.9 秒。给得太短会把「其实可用」误判成不可达。
   */
  probeTimeoutMs: 12000,

  /**
   * 允许留在壳内的主机。站外链接（含 mailto: / tel:）一律交系统浏览器。
   *
   * `www` 一并放行：站点证书的 SAN 同时包含 `ase-scs.top` 与 `www.ase-scs.top`，
   * 将来切换主域名时壳不必跟着发版。
   */
  allowedHosts: ["ase-scs.top", "www.ase-scs.top"] as readonly string[],
} as const;

/** 启动期覆盖项（现场排障用，优先级高于内置地址） */
export const OVERRIDE = {
  /** 命令行形如 --endpoint=https://10.0.0.5:8081/ */
  endpointFlag: "--endpoint=",
  /** 环境变量 */
  envEndpoint: "SHELL_ENDPOINT",
} as const;

/** 窗口常量 */
export const WINDOW = {
  width: 1360,
  height: 860,
  minWidth: 1024,
  minHeight: 640,
  /** 首屏底色，避免加载期间白屏闪烁 */
  backgroundColor: "#0e2a47",
  /** 标题后缀：实际标题为「<页面标题> · <后缀>」 */
  titleSuffix: "智慧工地",
  /** 加载失败兜底页的标题 */
  fallbackTitle: "智慧工地 · 无法连接",
  /**
   * 导航看门狗（毫秒）。
   *
   * 页面连通后若能加载会很快结束；但对「DNS 能解析、TCP 却被黑洞丢掉」的地址，
   * 导航会一直卡在空白页直到系统 TCP 超时（macOS 约 75 秒）。超过本时限仍未结束即按加载失败处理，
   * 转兜底页并给出诊断，避免用户面对长时间白屏。
   */
  navigationTimeoutMs: 20000,
} as const;

/** 落盘文件名（位于 userData 目录） */
export const FILES = {
  /** 记忆手填地址 / 窗口位置 */
  state: "shell-state.json",
  /** 加载失败兜底页（打包在 resources 下） */
  fallbackPage: "fallback.html",
} as const;

/** 兜底页与主进程之间的 IPC 通道（单一来源，preload 与主进程共用） */
export const IPC = {
  /** 注入到 window 上的桥对象名，兜底页用 window.<bridgeName> 访问 */
  bridgeName: "shellFallback",
  /** 取当前状态（地址探测结果、版本号等） */
  getStatus: "shell:get-status",
  /** 重新加载 */
  retry: "shell:retry",
  /** 回到默认站点地址（清掉手动指定） */
  useAuto: "shell:use-auto",
  /** 手动指定站点地址 */
  setManual: "shell:set-manual",
} as const;
