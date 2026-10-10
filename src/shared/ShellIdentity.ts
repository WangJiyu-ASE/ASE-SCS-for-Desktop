import { SHELL } from "../constants/ShellConstants";
import { BUILD_INFO } from "../generated/BuildInfo";

/**
 * 壳的身份标识（版本号、User-Agent）。
 *
 * User-Agent 会带上 `AseShell/Windows`，方便后端日志区分「来自桌面壳」的请求 ——
 * 排障时不必再猜是浏览器还是壳。
 */
export class ShellIdentity {
  /** 壳自身版本，取自构建期注入 */
  static appVersion(): string {
    return BUILD_INFO.APP_VERSION;
  }

  /** 构建时锁定的 web submodule 提交号 */
  static webCommit(): string {
    return BUILD_INFO.WEB_COMMIT;
  }

  /** 构建时间（ISO 8601） */
  static buildTime(): string {
    return BUILD_INFO.BUILD_TIME;
  }

  /** 统一的 User-Agent */
  static userAgent(): string {
    return `${SHELL.productName}/${ShellIdentity.appVersion()} (${SHELL.userAgentSuffix})`;
  }
}
