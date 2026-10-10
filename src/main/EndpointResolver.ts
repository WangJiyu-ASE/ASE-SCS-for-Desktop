import http from "node:http";
import https from "node:https";
import { OVERRIDE, SHELL } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import { CertificateTrust } from "./CertificateTrust";
import { ShellState } from "./ShellState";

/** 一个候选站点地址 */
export interface EndpointCandidate {
  /** 展示用标签（"内网" / "公网" / "上次可用" / "手动指定" …） */
  label: string;
  /** 完整地址，末尾带 `/` */
  url: string;
  /** 主机名（IP 字面量） */
  host: string;
}

/** 候选地址 + 探测结果（兜底页展示用） */
export interface EndpointProbeResult extends EndpointCandidate {
  reachable: boolean;
}

/** 一次地址解析的结果 */
export interface ResolveOutcome {
  /** 要加载的地址；null 表示无可用地址，应进兜底页 */
  url: string | null;
  /** 各候选的探测结果 */
  probes: EndpointProbeResult[];
  /** 出错说明（null 表示顺利） */
  error: string | null;
}

/**
 * 站点地址解析（单一实体）。
 *
 * 站点内外网共用同一个 8081 端口，两个地址只有 IP 不同，因此「该用哪个」必须由壳决定。
 * 策略（优先级从高到低）：
 *   1. 手动指定（兜底页填写 / 菜单指定）
 *   2. 命令行 `--endpoint=` / 环境变量 `SHELL_ENDPOINT`（现场排障）
 *   3. 上次成功的地址排到最前（比如常年在 4G 的机器就不必先等内网超时）
 *   4. **并行探测、按顺序提前返回**：内网可达即刻采用，不等公网的慢探测；
 *      公网链路实测要 3.6–7.9 秒，串行等待会把启动拖成十几秒。
 *
 * 探测走 Node 的 https，并用内置 CA 做**正规链校验**（`rejectUnauthorized: true`），
 * 因此「探测通过」≈「Chromium 也能打开」。
 */
export class EndpointResolver {
  constructor(private readonly state: ShellState) {}

  /** 内置候选地址（按优先级） */
  candidates(): EndpointCandidate[] {
    return SHELL.probeOrder.map((label) => {
      const url = SHELL.endpoints[label];
      return { label: label === "intranet" ? "内网" : "公网", url, host: new URL(url).hostname };
    });
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

  /** 解析出本次要加载的地址 */
  async resolve(): Promise<ResolveOutcome> {
    const forced = this.forcedEndpoint();
    if (forced) {
      if (await this.probe(forced.url)) {
        return { url: forced.url, probes: [{ ...forced, reachable: true }], error: null };
      }
      // 指定的地址不通：连同内置候选一起探一遍，兜底页才有切换的依据
      const probes = await this.probeAll();
      return {
        url: null,
        probes: [{ ...forced, reachable: false }, ...probes],
        error: `${forced.label}的地址不可达：${forced.url}`,
      };
    }

    const candidates = this.orderedCandidates();
    // 并行发起：公网那条链路慢，不能等它拖延内网可用时的启动
    const pending = candidates.map((candidate) => this.probe(candidate.url));

    // 按优先级依次收结果：内网可达就立刻采用，不必等公网的慢探测跑完
    for (let index = 0; index < candidates.length; index++) {
      if (await pending[index]) {
        const winner: EndpointProbeResult = { ...candidates[index], reachable: true };
        this.state.setAutoEndpoint(winner.url);
        return { url: winner.url, probes: [winner], error: null };
      }
    }

    // 走到这里说明全部不可达（前面没有任何一个返回 true）
    return {
      url: null,
      probes: candidates.map((candidate) => ({ ...candidate, reachable: false })),
      error: "内网与公网地址均不可达",
    };
  }

  /** 并行探测全部内置候选 */
  private async probeAll(): Promise<EndpointProbeResult[]> {
    const candidates = this.candidates();
    return Promise.all(
      candidates.map(async (candidate) => ({ ...candidate, reachable: await this.probe(candidate.url) })),
    );
  }

  /** 候选地址，按「上次成功者优先」排序 */
  private orderedCandidates(): EndpointCandidate[] {
    const candidates = this.candidates();
    const remembered = this.state.autoEndpoint;
    if (!remembered) return candidates;
    const preferred = candidates.findIndex((candidate) => candidate.url === remembered);
    if (preferred <= 0) return candidates;
    const [head] = candidates.splice(preferred, 1);
    return [head, ...candidates];
  }

  /** 启动期覆盖项 */
  private forcedEndpoint(): (EndpointCandidate & { label: string }) | null {
    const manual = this.state.manualEndpoint;
    if (manual) {
      return { label: "手动指定", url: manual, host: hostOf(manual) };
    }
    const flag = process.argv.find((arg) => arg.startsWith(OVERRIDE.endpointFlag));
    if (flag) {
      const url = EndpointResolver.normalizeEndpoint(flag.slice(OVERRIDE.endpointFlag.length));
      if (url) return { label: "命令行参数", url, host: hostOf(url) };
    }
    const env = process.env[OVERRIDE.envEndpoint];
    if (env) {
      const url = EndpointResolver.normalizeEndpoint(env);
      if (url) return { label: "环境变量", url, host: hostOf(url) };
    }
    return null;
  }

  /**
   * 探测单个地址是否可用。
   *
   * 判定标准：能拿到 HTTP 响应即视为可达（2xx–4xx 都算；401/404 说明服务在，
   * 只是探活路径不同）。证书用内置 CA 正规校验，弱网/证书不匹配/TLS 失败都算不可达。
   */
  private probe(url: string): Promise<boolean> {
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
            ca: secure ? CertificateTrust.nodeCaOption() : undefined,
            rejectUnauthorized: secure,
            timeout: this.timeoutFor(target.hostname),
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

  /** 按链路取超时：内网走局域网超时，其余（公网 / 手填的未知地址）走公网超时 */
  private timeoutFor(host: string): number {
    const intranetHost = hostOf(SHELL.endpoints.intranet);
    return host === intranetHost ? SHELL.probe.intranetTimeoutMs : SHELL.probe.publicTimeoutMs;
  }
}

/** 从 URL 取主机名 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
