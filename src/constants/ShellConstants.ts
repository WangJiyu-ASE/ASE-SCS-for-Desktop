/**
 * 壳的全部常量（单一事实来源）。
 *
 * 站点地址、探测参数、允许主机、CA 指纹等都写在这里 —— 换地址只改本文件，
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
   * 站点地址。内外网**同端口（8081）同协议（HTTPS）**，只映射这一个端口；
   * 自签 CA 的 SAN 同时覆盖这两个 IP，因此两侧都能正常握手。
   *
   * ⚠️ 末尾的 `/` 必须保留：页面里的 `/api/v1`、`/media/...` 都是相对路径，
   * 丢了斜杠会让它们解析到上一层。
   */
  endpoints: {
    /** 内网直连（优先） */
    intranet: "https://172.23.109.240:8081/",
    /** 公网 NAT 映射（回退） */
    public: "https://36.129.168.66:8081/",
  },

  /**
   * 探测优先级。两个地址**并行探测**，命中多个时按此顺序取用。
   * 内网在前：同一局域网内直连更快，也避免绕公网出口。
   */
  probeOrder: ["intranet", "public"] as const,

  /** 探活路径（相对站点根） */
  probePath: "api/v1/health",

  /**
   * 探测超时（毫秒），按链路分别设置。
   *
   * 为什么要分开（2026-10-09 实测）：内网是局域网，一次探活约 **30ms**；
   * 公网经路由器 NAT 出去，仅 TLS 握手就要 **1.5–4.7s**、整请求 **3.6–7.9s**。
   * 若两边共用一个短超时，公网明明可用也会被判成不可达，壳白等一圈后错误地落进兜底页；
   * 若共用一个长超时，内网不可达时（如人在外网）又白白多等十几秒。
   */
  probe: {
    /** 内网（局域网） */
    intranetTimeoutMs: 3000,
    /** 公网（NAT / 4G） */
    publicTimeoutMs: 12000,
  },

  /** 内置自签 CA 的文件名（打包后在 resources 目录下） */
  caCertFile: "ase-ca.crt",

  /**
   * 内置 CA 的 SHA-256 指纹（防御性钉扎）。
   *
   * 取法：openssl x509 -in deploy/certs/ase-ca.crt -noout -fingerprint -sha256
   *
   * ⚠️ 换 CA（web 仓库 `./deploy/gen-cert.sh --new-ca`）后必须同步这里并**重新发版**，
   * 否则指纹不符，壳会拒绝信任该站点。仅重签站点证书（同一把 CA）不受影响。
   */
  caFingerprintSha256:
    "35:3D:9C:78:73:C6:BA:99:F9:5B:FD:F7:C9:22:43:A7:33:FE:3B:D5:06:15:AB:3E:EA:39:FF:64:82:B7:44:05",

  /** 允许留在壳内的主机。站外链接（含 mailto: / tel:）一律交系统浏览器 */
  allowedHosts: ["36.129.168.66", "172.23.109.240"] as readonly string[],
} as const;

/** 启动期覆盖项（现场排障用，优先级高于内置地址与记忆值） */
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
} as const;

/** 落盘文件名（位于 userData 目录） */
export const FILES = {
  /** 记忆可用地址 / 窗口位置 */
  state: "shell-state.json",
  /** 加载失败兜底页（打包在 resources 下） */
  fallbackPage: "fallback.html",
} as const;

/** 兜底页与主进程之间的 IPC 通道（单一来源，preload 与主进程共用） */
export const IPC = {
  /** 注入到 window 上的桥对象名，兜底页用 window.<bridgeName> 访问 */
  bridgeName: "shellFallback",
  /** 取当前状态（候选地址探测结果、版本号等） */
  getStatus: "shell:get-status",
  /** 重新探测并加载 */
  retry: "shell:retry",
  /** 回到自动选择（清掉手动指定） */
  useAuto: "shell:use-auto",
  /** 手动指定站点地址 */
  setManual: "shell:set-manual",
} as const;
