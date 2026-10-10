import http from "node:http";
import https from "node:https";
import { OVERRIDE, SHELL } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import { ShellState } from "./ShellState";

/** 一个站点地址 */
export interface SiteTarget {
  /** 展示用标签（"站点" / "手动指定" / "命令行参数" …） */
  label: string;
  /** 完整地址，末尾带 `/` */
  url: string;
  /** 主机名 */
  host: string;
  /**
   * 是否来自手输 / 命令行 / 环境变量。
   *
   * 这类地址**可能写错**（含指向不可路由的 IP），导航会一直卡在空白页直到系统 TCP 超时，
   * 因此加载前先做一次有时限的探测；内置站点地址则直接加载，省掉等待。
   */
  override: boolean;
}

/** 地址 + 探测结果（兜底页展示用） */
export interface SiteProbeResult extends SiteTarget {
  reachable: boolean;
}

/**
 * 站点地址解析（单一实体）。
 *
 * 自 web v4.2 起站点只用**一个域名**（内外网通用，NAT 回环已开），因此这里不再做
 * 「内网/公网双地址探测与回退」，只决定「本次加载哪个地址」：
 *   1. 手动指定（兜底页手填）
 *   2. 命令行 `--endpoint=` / 环境变量 `SHELL_ENDPOINT`（现场排障）
 *   3. 内置常量 `SHELL.siteUrl`
 *
 * 启动**不做探活**：只加载一个地址时，先探测再加载纯属白等（公网链路一次探活要 2 秒以上）。
 * 探测只在**加载失败后**用于诊断，把「地址是否可达」显示到兜底页上。
 *
 * 证书交给 Chromium / Node 的**系统信任库**校验：站点用的是 Let's Encrypt，
 * 本就原生受信，壳不需要也不应该内置任何 CA。
 */
export class SiteResolver {
  constructor(private readonly state: ShellState) {}

  /** 本次要加载的地址 */
  target(): SiteTarget {
    const manual = this.state.manualEndpoint;
    if (manual) return { label: "手动指定", url: manual, host: hostOf(manual), override: true };

    const flag = process.argv.find((arg) => arg.startsWith(OVERRIDE.endpointFlag));
    if (flag) {
      const url = SiteResolver.normalizeEndpoint(flag.slice(OVERRIDE.endpointFlag.length));
      if (url) return { label: "命令行参数", url, host: hostOf(url), override: true };
    }

    const env = process.env[OVERRIDE.envEndpoint];
    if (env) {
      const url = SiteResolver.normalizeEndpoint(env);
      if (url) return { label: "环境变量", url, host: hostOf(url), override: true };
    }

    return SiteResolver.defaultTarget();
  }

  /** 内置的默认站点地址 */
  static defaultTarget(): SiteTarget {
    return { label: "站点", url: SHELL.siteUrl, host: hostOf(SHELL.siteUrl), override: false };
  }

  /** 该地址是否可达（有时限，用于覆盖地址的加载前验证） */
  async reachable(target: SiteTarget): Promise<boolean> {
    return probe(target.url);
  }

  /**
   * 诊断：探测当前地址与默认站点，交给兜底页展示「哪个可达」。
   * 只在加载失败后调用。
   */
  async diagnose(): Promise<SiteProbeResult[]> {
    const targets = dedupeByUrl([this.target(), SiteResolver.defaultTarget()]);
    return Promise.all(targets.map(async (target) => ({ ...target, reachable: await probe(target.url) })));
  }

  /** 把用户输入规范成可用地址；无法识别时返回 null */
  static normalizeEndpoint(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = new URL(withScheme);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      parsed.hash = "";
      if (!parsed.pathname.endsWith("/")) parsed.pathname = `${parsed.pathname}/`;
      return parsed.toString();
    } catch {
      return null;
    }
  }
}

/**
 * 探测单个地址是否可用。
 *
 * 判定标准：能拿到 HTTP 响应即视为可达（2xx–4xx 都算；401/404 说明服务在，
 * 只是探活路径不同）。
 *
 * 证书走系统信任库（`rejectUnauthorized: true`，不传自定义 ca），
 * 因此「探测通过」与「Chromium 能打开」的判定标准一致。
 */
function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    try {
      const target = new URL(SHELL.probePath, url);
      const secure = target.protocol === "https:";
      const request = (secure ? https : http).request(
        {
          method: "GET",
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (secure ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          rejectUnauthorized: true,
          timeout: SHELL.probeTimeoutMs,
          headers: {
            "User-Agent": ShellIdentity.userAgent(),
            Accept: "application/json",
          },
        },
        (response) => {
          const code = response.statusCode ?? 0;
          response.resume();
          done(code >= 200 && code < 500);
        },
      );
      request.on("timeout", () => {
        request.destroy();
        done(false);
      });
      request.on("error", () => done(false));
      request.end();
    } catch {
      done(false);
    }
  });
}

/** 按 URL 去重，保留先出现者（标签更具体） */
function dedupeByUrl(targets: SiteTarget[]): SiteTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

/** 从 URL 取主机名 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
