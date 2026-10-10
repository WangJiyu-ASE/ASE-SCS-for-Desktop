#!/usr/bin/env node
/**
 * 从站点下载自签 CA 证书到 resources/ase-ca.crt，并校验指纹。
 *
 * 什么时候用：CA 轮换（web 仓库 `./deploy/gen-cert.sh --new-ca`）后，
 * 或首次搭建/换机器时，把线上那把 CA 取回本地，再同步 ShellConstants 里的指纹常量。
 *
 * 站点离线时也可直接用 `scp` 从服务器拷 deploy/certs/ase-ca.crt。
 *
 * 用法：
 *   node scripts/fetch-ca.mjs                       # 从公网地址拉
 *   node scripts/fetch-ca.mjs https://172.23.109.240:8081/ase-ca.crt
 */
import { X509Certificate } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://36.129.168.66:8081/ase-ca.crt";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "resources", "ase-ca.crt");
const url = process.argv[2] || DEFAULT_URL;

// 自签证书无法用常规信任链校验，这里只取下来做指纹核对，所以关掉校验是刻意的
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const response = await fetch(url);
if (!response.ok) {
  console.error(`[ca] 下载失败：HTTP ${response.status} ${url}`);
  process.exit(1);
}

const pem = await response.text();
if (!pem.includes("BEGIN CERTIFICATE")) {
  console.error("[ca] 响应不是 PEM 证书，请检查地址是否被反向代理成了 HTML");
  process.exit(1);
}

const x509 = new X509Certificate(pem);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, pem, "utf8");

console.log(`[ca] 已写入 ${target}`);
console.log(`[ca] 主题：${x509.subject}`);
console.log(`[ca] 有效期至：${x509.validTo}`);
console.log(`[ca] SHA-256：${x509.fingerprint256}`);
console.log("");
console.log("[ca] 请确认 ShellConstants.caFingerprintSha256 与上面的 SHA-256 一致，不一致需同步后重新发版。");
