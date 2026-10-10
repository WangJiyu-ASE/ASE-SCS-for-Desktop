# ASE 智慧工地 · Windows 桌面壳（Electron）

把 [ASE-Smart-Construction-Site](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site)（下称 **web 仓库**）
的页面装进一个 Windows 桌面程序里。**只做壳，不含任何业务逻辑**：页面、接口、图片、视频
全部由站点自己提供，web 仓库**零改动**。

交付物是一个可安装的 `SCS Setup.exe`（NSIS 安装包），安装后**公网与内网都能用**：
壳启动时自动探测两个地址，优先内网、回退公网。

与既有的 Android 壳 [`ASE-SCA-Android`](https://github.com/WangJiyu-ASE/ASE-SCA-Android) 采用**同一套约定**：
在线壳 + `web/` submodule 仅用于版本锁定 + 常量写文件 + 内置信任自签 CA。

---

## 1. 为什么 web 侧一行都不用改

```
SCS.exe ──► https://<站点地址>:8081/ ──► 提供页面 + 代理 /api、/media、/live 的那个源（Nginx）
                                              │
                                              └─► NestJS 后端（127.0.0.1:8001）
```

壳加载的是**远程站点地址**，页面的源（origin）就是站点本身。因此
`Frontend/src/api/request.ts` 里的相对路径 `baseURL: "/api/v1"`、`components/FileUpload.tsx` 里的
`/media/...`、401 时的 `window.location.href = "/login"`、以及视频链路的同源相对前缀，
**全部天然可用**。

依据：web 仓库 [`DOCS/内网端口映射套壳验证方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/内网端口映射套壳验证方案.md) §4、
[`DOCS/公网访问端口映射方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/公网访问端口映射方案.md) §3.1。

---

## 2. 分工边界（务必遵守）

| 范围 | 归属 | 说明 |
|---|---|---|
| `src/`、`resources/`、`scripts/`、`electron-builder.yml`、本 README | **本仓库** | 壳的常量、配置、构建 |
| `web/` 下的一切（页面、样式、组件、后端、Nginx、证书） | **web 仓库负责人** | 改 UI / 页面逻辑一律在 web 仓库改，本仓库不动 `web/` |

本仓库对 `web/` 只有两个动作：**拉取更新**（`git -C web fetch && git -C web merge --ff-only`）
和**提交 submodule 指针**。除此之外不写、不改、不提交。

---

## 3. 目录结构

```
package.json                     依赖与脚本
tsconfig.json                    TS 编译配置（产物在 dist/）
electron-builder.yml             打包配置（产物名 SCS Setup.exe）
.gitmodules                      web submodule 定义
resources/
  ase-ca.crt                     内置自签 CA（公开证书，可入库）—— 终端信任与 Node 探测都用它
  fallback.html                  加载失败兜底页（本地 file:// 页面）
  icon.ico                       应用 / 安装包图标（由 scripts/gen-icon.mjs 生成）
scripts/
  gen-build-info.mjs             生成 src/generated/BuildInfo.ts（版本 / web 提交号 / 构建时间）
  gen-icon.mjs                   生成 icon.ico（无第三方依赖）
  fetch-ca.mjs                   从站点拉取 CA 并打印指纹
src/
  constants/ShellConstants.ts    全部常量（站点地址、探测参数、允许主机、CA 指纹…）
  shared/
    ShellIdentity.ts             壳身份（版本 / User-Agent）
    ShellStatus.ts               主进程 → 兜底页的数据契约
  main/
    MainApp.ts                   入口：单实例锁、证书信任、建窗
    ShellWindow.ts               窗口：加载、站外外抛、失败兜底、窗口位置记忆
    EndpointResolver.ts          内网/公网双地址并行探测与选择
    CertificateTrust.ts          内置 CA 的严格校验（签名 + IP SAN + 指纹钉扎）
    DownloadHandler.ts           导出的 Excel / Word 落盘
    AppMenu.ts                   菜单（换服务器 / 重试 / 关于）
    RuntimePaths.ts              运行期路径（打包前后不同）
    ShellState.ts                本地状态（上次可用地址 / 窗口位置）
  preload/FallbackBridge.ts      兜底页专用桥（仅 file:// 页面可见）
  generated/BuildInfo.ts         **自动生成**（已 gitignore，postinstall 会补上）
web/                             web 仓库的 submodule，只读，不要在这里改代码
.github/workflows/release.yml    GitHub Actions：构建 SCS Setup.exe 并发 Release
```

---

## 4. 前置条件

| 项 | 要求 |
|---|---|
| Node.js | 20 或以上（本仓库在 22 上验证） |
| npm | 随 Node 自带 |
| 出 Windows 包 | 建议用 GitHub Actions（`windows-latest`）；本机 macOS/Linux 交叉构建见 §7.2 |

---

## 5. 首次拉取

```bash
git clone --recurse-submodules <本仓库地址>
# 已经 clone 过（web/ 是空目录）时：
git submodule update --init --recursive
```

`web/` 只是版本锁定用；**只跑构建**的话甚至是可选的 —— `BuildInfo` 里的 web 提交号由
`git ls-tree HEAD web`（或 `git ls-files -s web`）读取，不需要子仓库的工作区。

---

## 6. 开发运行

```bash
npm install          # 会触发 postinstall 生成 src/generated/BuildInfo.ts
npm run dev          # 编译 + 起壳
```

`npm run dev` 会真的去连站点（内网或公网），需要能访问到 `8081`。

其他脚本：

| 命令 | 说明 |
|---|---|
| `npm run build` | 只做 TS 编译（`tsc`） |
| `npm run gen:build-info` | 刷新 `src/generated/BuildInfo.ts` |
| `npm run gen:icon` | 重新生成 `resources/icon.ico` |
| `npm run fetch-ca` | 从站点拉取 CA 并打印指纹（CA 轮换后用） |
| `npm run clean` | 删除 `dist/` |

---

## 7. 出包（`SCS Setup.exe`）

### 7.1 GitHub Actions（推荐）

1. 推到 GitHub 后，Actions 里手动运行 **Release Windows Installer**（`workflow_dispatch`），
   或在打 tag 时自动触发：

   ```bash
   git tag v0.1.0
   git push --tags
   ```

2. 产物：
   - 手动触发 → 在本次 run 的 **Artifacts** 里下载 `SCS-Setup`；
   - 打 tag 触发 → 自动创建 Release 并附上 `SCS Setup.exe`。

> 安装包**未做代码签名**，因此首次运行 Windows 会弹 SmartScreen 提示（「更多信息 → 仍要运行」）。
> 要消除该提示，需要自备 Windows 代码签名证书，把证书接入 `electron-builder` 的签名配置。

### 7.2 本机交叉构建（可选）

macOS / Linux 上也能交叉出 Windows 包（依赖 wine，可能需要额外安装）：

```bash
npm run dist:win     # 产物：release/SCS Setup.exe
```

若只是想在本地看打包结果，可以用 `npm run dist:dir` 出解包目录（不生成安装包）。

---

## 8. 改站点地址

站点地址是**常量**，只改 [`src/constants/ShellConstants.ts`](src/constants/ShellConstants.ts) 一处：

```ts
endpoints: {
  intranet: "https://172.23.109.240:8081/",   // 内网（优先）
  public: "https://36.129.168.66:8081/",      // 公网 NAT
},
allowedHosts: ["36.129.168.66", "172.23.109.240"],
```

改完必须**重新出包**（地址是构建期写死的）。

两个必须记住的点：

1. **末尾的 `/` 不能丢** —— 页面里的 `/api/v1`、`/media/...` 是相对路径；
2. 手机 / 电脑要访问的是「**提供页面并代理 `/api`、`/media` 的那个源**」，即 Nginx 的 `8081`，
   不是后端 `8001`。

### 8.1 临时改地址（不改仓库文件）

用于现场排障，**优先级高于内置地址与记忆值**：

```bash
SCS.exe --endpoint=https://10.0.0.5:8081/
# 或
set SHELL_ENDPOINT=https://10.0.0.5:8081/ && SCS.exe
```

也可以在程序里：菜单 **连接 → 仅用内网 / 仅用公网 / 自动选择**，
或直接在兜底页的「手动指定地址」里填。选择会记在 `userData/shell-state.json`。

### 8.2 探测超时按链路分开设（别改成同一个值）

`ShellConstants.probe` 里两个超时是**刻意不同**的：

| 常量 | 值 | 依据（2026-10-09 实测） |
|---|---|---|
| `intranetTimeoutMs` | 3000ms | 内网是局域网，探活只要 **22–77ms**，3 秒已极宽松 |
| `publicTimeoutMs` | 12000ms | 公网经路由器 NAT，仅 TLS 握手就 **1.5–4.7s**、整请求 **3.6–7.9s** |

两者若合成一个短值，**公网明明可用也会被判成不可达**（实测踩过：2.5s 时公网一直显示「不可达」），
壳只能走内网或错误地落进兜底页；若合成一个长值，人在外网时又要为内网那条死链路白等十几秒。

解析顺序也据此设计：**并行发起两个探测，按优先级提前返回** ——
内网一可达就立刻采用，不等公网那条慢链路跑完，因此办公网下启动是毫秒级的。

---

## 9. 自签 CA 与信任

站点没有域名（签不了 Let's Encrypt）且服务器离线（跑不了 ACME），用的是自签 CA，
SAN 同时覆盖 `36.129.168.66` 与 `172.23.109.240`。

壳的做法是**把 CA 内置进包**（`resources/ase-ca.crt`），并做**严格校验**：

- 主机必须在 `allowedHosts` 白名单里；
- 站点证书必须**由内置 CA 签发**（验签，不是只看 CN）；
- 站点证书必须**覆盖当前主机名**（IP 走 SAN 的 `IP Address:` 条目）；
- 内置 CA 的 SHA-256 必须与 `ShellConstants.caFingerprintSha256` **逐字符一致**（防御性钉扎）。

四条全过才放行，其余情况一律拒绝。**没有**任何「全局关闭证书校验」的开关。

> ⚠️ 为什么 IP 要单独处理：Node 的 `X509Certificate.checkHost` 底层是 OpenSSL `X509_check_host`，
> 它只比对 DNS 名，**匹配不到 SAN 里的 `IP Address:` 条目**（实测：SAN 同时含两个 IP 时，
> 只有恰好等于 CN 的那个才算命中）。因此 IP 主机名由壳自行解析 `subjectAltName` 比对。

### 9.1 CA 轮换怎么办

web 仓库执行 `./deploy/gen-cert.sh --new-ca` 后：

1. `npm run fetch-ca`（或在服务器上取 `deploy/certs/ase-ca.crt`）；
2. 把新的 SHA-256 同步进 `ShellConstants.caFingerprintSha256`；
3. **重新发版**。

只重签站点证书（同一把 CA）**不需要**动这里，也不必重新发版。

### 9.2 内网终端（浏览器）装信任

壳不需要额外操作（CA 已内置）；但**用浏览器**访问内网地址会提示证书不受信任，需导入 CA：

```bash
# Windows（管理员）
certutil -addstore -f "ROOT" ase-ca.crt
```

站点也提供下载入口：`https://36.129.168.66:8081/ase-ca.crt`（菜单 **帮助 → 打开 CA 证书下载页**）。

---

## 10. 壳具体补了哪些浏览器做不了的事

| # | 能力 | 为什么必须有 | 对应 web 代码 |
|---|---|---|---|
| 1 | 内置自签 CA 信任 | 否则 Chromium 直接拦掉自签 HTTPS，页面根本打不开 | — |
| 2 | 双地址探测与回退 | 内外网共用 8081，只有一个 IP 能通 | — |
| 3 | `localStorage` 持久化 | 登录 token 存在 localStorage，不清则保持登录 | `store/useAuthStore.ts` |
| 4 | 站外链接外抛 | `mailto:` / `tel:` / 外部站点不该困在壳里 | `pages/pc/KnowledgeManage.tsx` |
| 5 | 下载落盘 | 导出 Excel / Word 走 `<a download>` + `blob:` | `utils/download.ts` |
| 6 | 内置 PDF 阅读器（`plugins: true`） | 页面的 PDF 预览走 `<iframe src="blob:">` | `components/DocumentPreviewModal.tsx` |
| 7 | 视频自动播放 | flv.js 监控画面不能要求用户手势 | `components/VideoPlayer.tsx` |
| 8 | 加载失败兜底页 + 重试 | 弱网 / 服务器未起时不留白屏，并显示实际地址与 web 版本 | — |
| 9 | 窗口位置记忆 | 现场体验 | — |

> 与 Android 壳的差别：桌面端**不需要** JS 桥去处理 `blob:` 下载与 PDF 预览
> （Chromium 原生支持），也不需要处理安全区 / 横竖屏。壳因此比 Android 侧薄得多。

### 10.1 关于 `sandbox: false`

窗口用的是 `contextIsolation: true` + `nodeIntegration: false` + `sandbox: false`。

- **远端页面依然零 Node 能力** —— `contextIsolation` + 关掉 `nodeIntegration` 保证了这一点，
  这是安全的关键；桥（`contextBridge`）只在本地 `file://` 兜底页挂载。
- 关掉 `sandbox` 的唯一原因是：**沙箱化的 preload 只能 `require("electron")` 与少数内置模块，
  不支持相对路径 import**（见 [Electron 文档](https://www.electronjs.org/docs/latest/tutorial/sandbox)），
  而本仓库要求常量单一来源（preload 需要复用 `ShellConstants` 的 IPC 通道名）。
- 若将来希望重新打开 `sandbox`：给 preload 加一层打包器（如 esbuild）把它编译成
  自包含单文件即可，其余代码不用动。

---

## 11. 验证清单（交付前逐条走）

安装 `SCS Setup.exe` 后：

- [ ] 能双击安装、能卸载、生成桌面与开始菜单快捷方式
- [ ] **内网**环境启动后自动走 `https://172.23.109.240:8081/` 并能登录
- [ ] **公网**环境启动后自动回退 `https://36.129.168.66:8081/` 并能登录
- [ ] 全程**无证书告警**（内置 CA 生效）；把地址换成非本 CA 的站点时被拒绝
- [ ] 登录后刷新仍保持登录（`localStorage` 持久）
- [ ] 列表页出数据（`/api/v1` 通）、巡检照片正常显示（`/media` 通）
- [ ] 能上传照片（`input[type=file]` 可用）
- [ ] 导出 Excel / Word 能落盘（默认存到系统「下载」目录）
- [ ] 文档预览里的 PDF 能正常显示
- [ ] 监控页视频能播放、云台可用；划线预览 iframe 能出画
- [ ] 断开网络 / 服务器未起时出现兜底页，页面上的地址与 web 版本号正确，可重试 / 手动切换
- [ ] 站外链接交系统默认浏览器，站内在壳内跳转（不弹新窗口、不跳浏览器）

### 已在开发机实测（2026-10-09）

| 项 | 方法 | 结果 |
|---|---|---|
| 公网站点可达 | `GET https://36.129.168.66:8081/api/v1/health` | 200 |
| 内网站点可达 | `GET https://172.23.109.240:8081/api/v1/health` | 200 |
| 内置 CA 指纹与常量一致 | `openssl x509 -noout -fingerprint -sha256` 比对 | 一致 |
| 站点证书由内置 CA 签发 | `X509Certificate.verify(ca.publicKey)` on 真实 server.crt | `true` |
| IP SAN 覆盖内外网 | 壳自身的 IP 匹配逻辑跑真实 server.crt | `36.129.168.66` / `172.23.109.240` 均命中 |
| 启动后确实加载了站点 | CDP 读取页面 `location.href` 与 `document.title` | `https://172.23.109.240:8081/`、标题「智慧工地管理系统」，侧边栏菜单渲染正常 |
| 兜底页 | 强制 `--endpoint=https://10.255.255.1:8081/` 启动 | 落到 `fallback.html`，桥可用，三个候选及其可达状态显示正确 |
| 链路延迟 | `curl -w %{time_total}` ×5 | 内网 **22–77ms**；公网 **3.6–7.9s**（TLS 握手就占 1.5–4.7s） |
| TypeScript 编译 | `npm run build` | 通过，无警告 |
| 图标 | `file resources/icon.ico` | 合法 ICO，256×256 PNG 条目 |
| Windows 打包布局 | `npm run dist:dir`（macOS 交叉构建） | `release/win-unpacked/SCS.exe` + `resources/{app.asar, ase-ca.crt, fallback.html}` |

> **链路延迟这条实测直接决定了 §8.2 的超时常量**，不要把两个超时改回同一个短值：
> 公网探活要 3.6–7.9 秒，短超时会把「公网其实可用」误判为不可达，壳就永远只能走内网或兜底页。

> 安装包的实际安装 / 卸载与运行期行为需在 Windows 上按 §11 清单走一遍
> （本机为 macOS，未做 Windows 运行期验证；安装包由 CI 在 `windows-latest` 上产出）。

---

## 12. 已知限制

- **地址是构建期常量**：换 IP / 换端口必须改 `ShellConstants` 并重新发版。临时可用
  `--endpoint=` / `SHELL_ENDPOINT` / 菜单切换绕过。
- **未做代码签名**：Windows SmartScreen 会提示，需自备证书才能消除。
- **安装为「仅当前用户」**（`perMachine: false`）：不弹 UAC。若要装到 `Program Files`，
  把 `electron-builder.yml` 的 `nsis.perMachine` 改为 `true`。
- **CA 到期前必须发版**：CA 有效期为 10 年（web 仓库 `VALID_DAYS`），换 CA 需同步指纹并重发。
- **未做**：自动更新（autoUpdater）、多窗口、托盘常驻。

---

## 13. 安全红线

来自 web 仓库 [`DOCS/公网访问端口映射方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/公网访问端口映射方案.md) §10：

- **不要映射** `3306`（数据库）与 `8001`（后端，且它只监听 `127.0.0.1`）。
- 对外只用 `8081` 一个端口；不要额外暴露 `8443` 之类。
- 前端**不要长期跑 Vite dev server**（会暴露源码与 sourcemap）；正式必须 `build` + Nginx 托管 `dist`。
- 后端 CORS 已收紧为白名单、默认口令必须更换、`JWT_SECRET_KEY` / `SECRET_ENCRYPTION_KEY` 必须显式设置。
- 壳**只**放行 `allowedHosts` 白名单内的主机，且必须由内置 CA 签发；不要放开成任意主机。
- **仓库可见性**：本仓库会写入内网 IP 与私有 submodule 引用，建议设为 **private**。

---

## 14. 提交规范

提交信息以 `[BUGFIX]` / `[FEATURE]` / `[REFACTOR]` / `[DOCS]` / `[INIT]` 等标签开头，正文用英文。

升级 web submodule 的提交：

```bash
git -C web fetch
git -C web checkout <目标提交>
git add web
git commit -m "[FEATURE] bump web submodule to <短提交号>"
```
