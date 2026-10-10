import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { app, Session } from "electron";
import type { Certificate } from "electron";
import { SHELL } from "../constants/ShellConstants";
import { RuntimePaths } from "./RuntimePaths";

/**
 * 内置自签 CA 的信任实现。
 *
 * 站点没有域名（签不了 Let's Encrypt）且服务器离线（跑不了 ACME），
 * 只能在本地生成自签 CA 后内置进壳。Chromium 默认不认自签证书，
 * 这里把 CA 装进信任链 —— 但**只**对该 CA 签发、且主机名匹配的证书放行，
 * 绝不使用「全局关闭证书校验」这类做法。
 *
 * 两道口子同时装上，覆盖所有请求形态：
 *   1. `session.setCertificateVerifyProc`：主文档 + 全部子资源（XHR / 图片 / WebSocket）；
 *   2. `app.on('certificate-error')`：兜底，未被信任的失败一律拒绝。
 */
export class CertificateTrust {
  private static caPem: string | null = null;
  private static fingerprintMatched = false;
  private static loaded = false;

  /**
   * 读取并校验内置 CA。
   * @returns CA 是否可用于信任判定（读取成功 + 指纹与常量一致）
   */
  static load(): boolean {
    if (CertificateTrust.loaded) {
      return CertificateTrust.fingerprintMatched;
    }
    CertificateTrust.loaded = true;
    try {
      const pem = fs.readFileSync(RuntimePaths.caCertFile(), "utf8");
      const actual = new X509Certificate(pem).fingerprint256.toUpperCase();
      const expected = SHELL.caFingerprintSha256.toUpperCase();
      CertificateTrust.caPem = pem;
      CertificateTrust.fingerprintMatched = actual === expected;
      if (!CertificateTrust.fingerprintMatched) {
        console.error(
          "[cert] 内置 CA 指纹与常量不符，将拒绝信任该站点（换过 CA 就需同步 ShellConstants 并重新发版）。\n" +
            `  实际：${actual}\n  期望：${expected}`,
        );
      }
      return CertificateTrust.fingerprintMatched;
    } catch (error) {
      console.error("[cert] 内置 CA 读取失败：", error);
      CertificateTrust.caPem = null;
      CertificateTrust.fingerprintMatched = false;
      return false;
    }
  }

  /** 给指定 session 装上证书校验（只需装一次） */
  static install(target: Session): void {
    CertificateTrust.load();

    target.setCertificateVerifyProc((request, callback) => {
      /*
       * callback 语义（Electron 文档）：
       *   0  = 信任
       *  -2  = 拒绝
       *  -3  = 沿用 Chromium 原本的校验结果
       * 只对我们认可的组合给 0，其余全部交回 Chromium —— 等于没有放宽任何其它站点。
       */
      callback(CertificateTrust.isTrusted(request.hostname, request.certificate) ? 0 : -3);
    });

    app.on("certificate-error", (event, _webContents, url, _error, certificate, callback) => {
      const host = hostOf(url);
      if (host && CertificateTrust.isTrusted(host, certificate)) {
        event.preventDefault();
        callback(true);
        return;
      }
      callback(false);
    });
  }

  /** 供 Node 侧（地址探测）使用的 CA 选项；不可用时返回 undefined，探测即失败 */
  static nodeCaOption(): string[] | undefined {
    return CertificateTrust.load() && CertificateTrust.caPem ? [CertificateTrust.caPem] : undefined;
  }

  /**
   * 判定是否信任：主机白名单 + 由内置 CA 签发 + 主机名覆盖。
   *
   * ⚠️ 不能用 Node 的 `X509Certificate.checkHost` 判 IP：它走的是 OpenSSL
   * `X509_check_host`，只比对 DNS 名，**匹配不到 SAN 里的 `IP Address:` 条目**
   * （实测：SAN 同时含两个 IP 时，只有恰好等于 CN 的那个返回命中）。
   * 因此 IP 主机名自行解析 subjectAltName 比对。
   */
  private static isTrusted(hostname: string, certificate: Certificate | null | undefined): boolean {
    if (!certificate?.data) return false;
    if (!SHELL.allowedHosts.includes(hostname)) return false;
    if (!CertificateTrust.load() || !CertificateTrust.caPem) return false;

    try {
      const leaf = new X509Certificate(certificate.data);
      const ca = new X509Certificate(CertificateTrust.caPem);
      // 1) 必须由内置 CA 签发（验签）
      if (!leaf.verify(ca.publicKey)) return false;
      // 2) 必须覆盖当前主机名
      return CertificateTrust.hostCoveredBy(leaf, hostname);
    } catch (error) {
      console.error("[cert] 证书校验异常，按拒绝处理：", error);
      return false;
    }
  }

  /** 证书是否覆盖该主机名（IP 走 SAN 的 iPAddress 条目，域名走 checkHost） */
  private static hostCoveredBy(leaf: X509Certificate, hostname: string): boolean {
    if (isIpLiteral(hostname)) {
      const entries = (leaf.subjectAltName ?? "").split(",").map((entry) => entry.trim());
      return entries.some((entry) => {
        const matched = /^IP Address:(.+)$/i.exec(entry);
        return matched !== null && matched[1].trim() === hostname;
      });
    }
    // 域名：交给 OpenSSL 处理通配符
    return leaf.checkHost(hostname) !== undefined;
  }
}

/** 是否为 IP 字面量（IPv4 / IPv6） */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/** 从 URL 中取主机名 */
function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}
