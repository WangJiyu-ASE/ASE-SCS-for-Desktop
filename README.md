# ASE 智慧工地 · Windows 桌面壳（Electron）

把 [ASE-Smart-Construction-Site](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site)（下称 **web 仓库**）
的页面装进一个 Windows 桌面程序里。**只做壳，不含任何业务逻辑**：页面、接口、图片、视频
全部由站点自己提供，web 仓库**零改动**。

交付物是一个可安装的 `SCS Setup.exe`（NSIS 安装包）。壳加载**单一域名**站点地址：

```
https://ase-scs.top:8081/
```

> web 仓库自 **v4.2（2026-10-10）** 起接入域名 `ase-scs.top` + **Let's Encrypt** 证书，并开启了
> **NAT 回环**：内外网都走这一个域名。因此壳**不需要**「内网/公网双地址探测」，也**不需要**内置自签 CA。
> 依据：web 仓库 [`DOCS/公网访问端口映射方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/公网访问端口映射方案.md) §1 / §4。

---

## 1. 为什么 web 侧一行都不用改

```
SCS.exe ──► https://ase-scs.top:8081/ ──► 提供页面 + 代理 /api、/media、/live 的那个源（Nginx）
                                              │
                                              └─► NestJS 后端（127.0.0.1:8001）
```

壳加载的是**远程站点地址**，页面的源（origin）就是站点本身。因此
`Frontend/src/api/request.ts` 里的相对路径 `baseURL: "/api/v1"`、`components/FileUpload.tsx` 里的
`/media/...`、401 时的 `window.location.href = "/login"`、以及视频链路的同源相对前缀，
**全部天然可用**。

依据：web 仓库 [`DOCS/内网端口映射套壳验证方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/内网端口映射套壳验证方案.md) §4。

---

## 2. 分工边界（务必遵守）

| 范围 | 归属 | 说明 |
|---|---|---|
| `src/`、`resources/`、`scripts/`、`electron-builder.yml`、本 README | **本仓库** | 壳的常量、配置、构建 |
| `web/` 下的一切（页面、样式、组件、后端、Nginx、证书、域名解析） | **web 仓库负责人** | 改 UI / 页面逻辑 / 域名 / 证书一律在 web 仓库改，本仓库不动 `web/` |

本仓库对 `web/` 只有两个动作：**拉取更新**（`git -C web fetch && git -C web merge --ff-only origin/main`）
和**提交 submodule 指针**。除此之外不写、不改、不提交。

---

## 3. 目录结构

```
package.json                     依赖与脚本
tsconfig.json                    TS 编译配置（产物在 dist/）
electron-builder.yml             打包配置（产物名 SCS Setup.exe）
.gitmodules                      web submodule 定义
resources/
  fallback.html                  加载失败兜底页（本地 file:// 页面）
  icon.ico                       应用 / 安装包图标（由 scripts/gen-icon.mjs 生成）
scripts/
  gen-build-info.mjs             生成 src/generated/BuildInfo.ts（版本 / web 提交号 / 构建时间）
  gen-icon.mjs                   生成 icon.ico（无第三方依赖）
src/
  constants/ShellConstants.ts    全部常量（站点地址、探活参数、允许主机…）
  shared/
    ShellIdentity.ts             壳身份（版本 / User-Agent）
    ShellStatus.ts               主进程 → 兜底页的数据契约
  main/
    MainApp.ts                   入口：单实例锁、建窗
    ShellWindow.ts               窗口：加载、站外外抛、失败兜底、导航看门狗、窗口位置记忆
    SiteResolver.ts              站点地址解析（手动 > 命令行 > 环境变量 > 内置常量）+ 可达性探测
    DownloadHandler.ts           导出的 Excel / Word 落盘
    AppMenu.ts                   菜单（重试 / 回到默认地址 / 关于）
    RuntimePaths.ts              运行期路径（打包前后不同）
    ShellState.ts                本地状态（手填地址 / 窗口位置）
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

`web/` 只是版本锁定用；**只跑构建**的话甚至是可选的 —— `BuildInfo` 里的 web 提交号优先取
submodule 的实际 HEAD（本地已检出时），否则回退读父仓库记录的 gitlink（`git ls-tree HEAD web`）,
因此 CI 不必为私有子仓库配 token。

---

## 6. 开发运行

```bash
npm install          # 会触发 postinstall 生成 src/generated/BuildInfo.ts
npm run dev          # 编译 + 起壳
```

`npm run dev` 会真的去连站点，需要能访问到 `ase-scs.top:8081`。

其他脚本：

| 命令 | 说明 |
|---|---|
| `npm run build` | 只做 TS 编译（`tsc`） |
| `npm run gen:build-info` | 刷新 `src/generated/BuildInfo.ts` |
| `npm run gen:icon` | 重新生成 `resources/icon.ico` |
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
siteUrl: "https://ase-scs.top:8081/",
allowedHosts: ["ase-scs.top", "www.ase-scs.top"],
```

改完必须**重新出包**（地址是构建期写死的）。

三个必须记住的点：

1. **末尾的 `/` 不能丢** —— 页面里的 `/api/v1`、`/media/...` 是相对路径；
2. **不要改回 IP 直连** —— Let's Encrypt 只签 DNS 名、**不签 IP**，
   `https://36.129.168.66:8081/` 与 `https://172.23.109.240:8081/` 都会报证书不匹配；
3. `allowedHosts` 决定哪些主机留在壳内、其余交系统浏览器 —— 换域名时**必须同步**，
   否则页面会在系统浏览器里打开，而不是在壳里。

### 8.1 临时改地址（不改仓库文件）

用于现场排障，**优先级高于内置地址**：

```bash
SCS.exe --endpoint=https://10.0.0.5:8081/
# 或
set SHELL_ENDPOINT=https://10.0.0.5:8081/ && SCS.exe
```

也可以：菜单 **连接 → 回到默认站点地址 / 在浏览器中打开站点**，
或直接在兜底页的「手动指定地址」里填。手填的地址会记在 `userData/shell-state.json`。

### 8.2 两个刻意的设计取舍

| 取舍 | 原因 |
|---|---|
| 内置站点地址**不做启动探活**，直接加载 | 只有一个地址时，先探测再加载纯属白等（实测一次探活 2 秒以上，见 §11 延迟实测） |
| 但**覆盖地址先探活**（手填 / 命令行 / 环境变量） | 这类地址可能写错、指向不可路由的 IP，导航会卡在空白页直到系统 TCP 超时（macOS 约 75 秒），所以先用有时限的探测挡掉 |
| 每次导航都上**看门狗**（`WINDOW.navigationTimeoutMs`） | 兜住「DNS 能解析、TCP 被黑洞丢掉」的情况，避免长时间白屏；正常加载会立刻撤销 |

---

## 9. 证书与信任

站点用的是 **Let's Encrypt** 证书（走 DNS-01 挑战，因为服务器离线且未映射 80/443），
**由系统/Chromium 的原生信任库校验，壳不需要、也没有内置任何 CA**。

实测（2026-10-10）：

| 项 | 值 |
|---|---|
| 证书主题 | `CN=ase-scs.top` |
| 签发者 | `C=US, O=Let's Encrypt, CN=YE1` |
| SAN | `DNS:ase-scs.top, DNS:www.ase-scs.top`（**不含 IP**） |
| 有效期 | 约 90 天，由 web 侧 `./deploy/renew-le-cert.sh` 自动续期 |
| Chromium 校验 | `SSL certificate verify ok`，**无告警** |

因此：

- 壳**不需要**装/导入证书，也**不要**引入任何「全局关闭证书校验」的开关；
- `https://172.23.109.240:8081/`、`https://36.129.168.66:8081/` 这些 IP 直连**会报证书不匹配** ——
  统一走域名即可（NAT 回环已开，内网同样能走域名）；
- 证书续期是 **web 侧的职责**，壳跟着受益（同一域名，续期后无需重新发版）。

> 历史：v4.0/v4.1 时期站点用自签 CA，壳曾内置 `ase-ca.crt` 做指纹钉扎并自行校验签名与 IP SAN。
> 换 LE 后这套逻辑已全部移除 —— 保留它只会让 LE 证书被误判为不可信。

---

## 10. 壳具体补了哪些浏览器做不了的事

| # | 能力 | 为什么必须有 | 对应 web 代码 |
|---|---|---|---|
| 1 | `localStorage` 持久化 | 登录 token 存在 localStorage，不清则保持登录 | `store/useAuthStore.ts` |
| 2 | 站外链接外抛 | `mailto:` / `tel:` / 外部站点不该困在壳里 | `pages/pc/KnowledgeManage.tsx` |
| 3 | 下载落盘 | 导出 Excel / Word 走 `<a download>` + `blob:` | `utils/download.ts` |
| 4 | 内置 PDF 阅读器（`plugins: true`） | 页面的 PDF 预览走 `<iframe src="blob:">` | `components/DocumentPreviewModal.tsx` |
| 5 | 视频自动播放 | flv.js 监控画面不能要求用户手势 | `components/VideoPlayer.tsx` |
| 6 | 加载失败兜底页 + 重试 | 弱网 / 服务器未起时不留白屏，并显示地址诊断与 web 版本 | — |
| 7 | 导航看门狗 | 地址不可路由时不至于白屏到系统 TCP 超时 | — |
| 8 | 窗口位置记忆 | 现场体验 | — |
| 9 | 内置 DevTools（**F12**） | 现场排查页面/接口/证书问题的唯一手段，见 §10.2 | — |

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

### 10.2 调试（DevTools 与远程 attach）

#### 本地调试（最省事，不需要任何额外软件）

壳内置了 DevTools。在 Windows 上启动后：

- 按 **F12**，或菜单 **视图 → 开发者工具**

> 快捷键是 **F12** 而不是 `Ctrl+Shift+I`：菜单项显式覆盖了 Electron 的默认加速键
> （见 `src/main/AppMenu.ts` 的 `toggleDevTools` 项）。

能看到的正好是现场最需要的东西：

| 面板 | 用途 |
|---|---|
| **Console** | 页面 JS 报错、证书告警、`Failed to load resource` |
| **Network** | `/api/v1/*`、`/media/*`、`/live` 是否通；点开任一请求 → **Security** 页可确认证书链是否被信任 |
| **Application → Local Storage** | 登录 token 是否落盘（刷新掉登录就是这个原因） |
| **Elements** | antd 组件样式与布局问题 |

#### 断点调试（VS Code / Cursor）

渲染进程（页面 JS）走 **CDP**，主进程（我们的 TS 代码）走 **Node inspector**，是两个不同协议，分别 attach：

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach 渲染进程",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "urlFilter": "https://ase-scs.top:8081/*"
    },
    {
      "name": "Attach 主进程",
      "type": "node",
      "request": "attach",
      "port": 9229
    }
  ]
}
```

启动时把对应端口打开（默认都只绑 `127.0.0.1`，本地调试正合适）：

```
SCS.exe --remote-debugging-port=9222 --inspect=9229
```

> ⚠️ 端口要先确认空闲。若已被占用，Electron 会在日志报 `Cannot start http server for devtools`
> 却**照常打开窗口**，于是你 attach 到的是占用该端口的别的程序（见下文「两个坑」）。

#### 远程调试（让**另一台机器**连过来）

⚠️ 先说结论：**`--remote-debugging-address=0.0.0.0` 没有用**。实测（2026-10-10）：

| 启动参数 | `lsof` 实际监听 |
|---|---|
| `--remote-debugging-port=9231 --remote-debugging-address=0.0.0.0` | `127.0.0.1:9231` |
| `--remote-debugging-port=9232`（不加 address） | `127.0.0.1:9232` |

近版 Chromium 出于安全考虑，**DevTools 端点一律只绑回环**，那个 address 开关已被忽略
（`--inspect` 同源问题）。所以要远程访问，只能在机器上加一层**端口转发**，把「对外监听」交给转发器。

**正确做法（Windows）**

```bat
:: 1) 用一个「空闲」端口启动（CDP 只会绑 127.0.0.1，这没关系）
"%LOCALAPPDATA%\Programs\SCS\SCS.exe" --remote-debugging-port=9222

:: 2) 端口转发：对外监听 0.0.0.0:9222 → 本机 127.0.0.1:9222（需管理员）
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=9222 connectaddress=127.0.0.1 connectport=9222

:: 3) 放行入站（需管理员）
netsh advfirewall firewall add rule name="SCS Debug CDP" dir=in action=allow protocol=TCP localport=9222

:: 4) 本机自检：应返回 JSON
curl http://127.0.0.1:9222/json/version
```

之后在另一台机器上访问 `http://<这台机器的IP>:9222/json`，就能看到可 attach 的页面列表。

> 该转发方案的等价实现已在本机实测通过：`0.0.0.0:9241 → 127.0.0.1:9240` 时，
> 非回环地址 `http://<内网IP>:9241/json/version` 返回 200 且内容为 Electron 本体的
> `User-Agent: ... ase-scs-for-desktop/0.1.x`。

**清理（务必做）**

```bat
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=9222
netsh advfirewall firewall delete rule name="SCS Debug CDP"
```

**方式 B：反向隧道**（不能开端口转发时）

把 Windows 的 `127.0.0.1:9222` 反向映射到对端可达的地址。
⚠️ 注意「绑在 `127.0.0.1` 的本地转发」只在被转发的那台机器内部可见，**别的机器永远连不上** ——
这正是 `adb forward` / `ssh -L` 这类工具的默认行为。要让外部连得上，转发必须落在可达的地址上。

#### 远程调试的两个坑（都实测踩到）

1. **端口被占用时会静默失败**：若该端口已被别的程序占用（典型是 `adb` 对 Android 设备的转发），
   Electron 会在日志里报 `bind() failed: Address already in use` /
   `Cannot start http server for devtools`，**但窗口照常打开** ——
   于是你以为调试通道通了，实际连到的是**另一个程序**。
   上机前先确认端口空闲：`netstat -ano | findstr :9222`。
2. **连上了也要确认连的是本应用**：看 `/json/version` 里的 `Browser` 与 `User-Agent` ——
   本壳的 UA 含 `ase-scs-for-desktop/<版本>`。

> 若用**浏览器**的 `chrome://inspect` 从另一台机器连，可能因 `Origin` 校验被拒；
> 此时再加 `--remote-allow-origins=*`（Node / VS Code attach 不需要）。
> 该开关会放宽来源校验，排障完记得去掉。

> **安全**：CDP 一旦对外可达，**同网段任何人都能拿到页面控制权**（读写 localStorage、以登录身份发请求）。
> 只在排障期间开，排障完立刻关；不要常年留着。`F12` 打开的本地 DevTools 不受此限（它不是网络端口）。

---

## 11. 验证清单（交付前逐条走）

安装 `SCS Setup.exe` 后：

- [ ] 能双击安装、能卸载、生成桌面与开始菜单快捷方式
- [ ] 启动后自动加载 `https://ase-scs.top:8081/`，**无证书告警**
- [ ] 能登录；登录后刷新仍保持登录（`localStorage` 持久）
- [ ] 列表页出数据（`/api/v1` 通）、巡检照片正常显示（`/media` 通）
- [ ] 能上传照片（`input[type=file]` 可用）
- [ ] 导出 Excel / Word 能落盘（默认存到系统「下载」目录）
- [ ] 文档预览里的 PDF 能正常显示
- [ ] 监控页视频能播放、云台可用；划线预览 iframe 能出画
- [ ] 断开网络 / 服务器未起时出现兜底页，页面上的地址诊断与 web 版本号正确，可重试 / 手动换地址
- [ ] 站外链接交系统默认浏览器，站内在壳内跳转（不弹新窗口、不跳浏览器）
- [ ] 菜单「回到默认站点地址」在填过手输地址后能复位
- [ ] 按 **F12** 能打开开发者工具（菜单 **视图 → 开发者工具**）

### 已在开发机实测（2026-10-10，web v4.2）

| 项 | 方法 | 结果 |
|---|---|---|
| 域名站点可达 | `GET https://ase-scs.top:8081/api/v1/health` | 200 |
| 证书为 LE 且系统认可 | `curl -v` | `subject: CN=ase-scs.top`、`issuer: Let's Encrypt`、**SSL certificate verify ok** |
| 证书 SAN | `openssl x509 -ext subjectAltName` | `DNS:ase-scs.top, DNS:www.ase-scs.top`（无 IP） |
| IP 直连 | `curl https://36.129.168.66:8081/` | **失败**（LE 不签 IP，证书不匹配）→ 印证必须走域名 |
| 启动加载 | CDP 读 `location.href` / `document.title` | `https://ase-scs.top:8081/login`、标题「智慧工地管理系统」，**无证书报错** |
| 兜底页 | `--endpoint=https://10.255.255.1:8081/` 启动 | 落入 `fallback.html`，报「地址不可达（命令行参数）」，候选显示「站点 … 可达」 |
| 链路延迟 | `curl -w %{time_total}` | 域名整请求约 **2.1 秒**（TLS 握手约 1.6 秒），故探活超时给 12 秒 |
| TypeScript 编译 | `npm run build` | 通过，无警告 |
| 图标 | `file resources/icon.ico` | 合法 ICO，256×256 PNG 条目 |
| 远程调试通道 | `0.0.0.0:9241 → 127.0.0.1:9240` 转发 | 非回环 `http://<内网IP>:9241/json/version` → 200，内容为本壳（UA 含 `ase-scs-for-desktop/0.1.0`） |
| `--remote-debugging-address` | `lsof` 查实际监听 | **无效**，仍只绑 `127.0.0.1`（近版 Chromium 收紧），故远程必须靠端口转发 |
| 端口冲突表现 | 让 `adb` 先占 9222 再启动 | Electron 报 `Cannot start http server for devtools` 但窗口正常，`9222` 上是 adb 的 Android 设备 |

> 安装包的实际安装 / 卸载与运行期行为需在 Windows 上按 §11 清单走一遍
> （本机为 macOS，未做 Windows 运行期验证；安装包由 CI 在 `windows-latest` 上产出）。

---

## 12. 已知限制

- **地址是构建期常量**：换域名必须改 `ShellConstants` 并重新发版。临时可用
  `--endpoint=` / `SHELL_ENDPOINT` / 兜底页手动填绕过。
- **未做代码签名**：Windows SmartScreen 会提示，需自备证书才能消除。
- **安装为「仅当前用户」**（`perMachine: false`）：不弹 UAC。若要装到 `Program Files`，
  把 `electron-builder.yml` 的 `nsis.perMachine` 改为 `true`。
- **依赖域名解析**：域名解析或 NAT 回环出问题时，壳会落到兜底页；此时可用 `--endpoint=` 指向
  可达地址临时顶用。
- **未做**：自动更新（autoUpdater）、多窗口、托盘常驻。

---

## 13. 安全红线

来自 web 仓库 [`DOCS/公网访问端口映射方案.md`](https://github.com/WangJiyu-ASE/ASE-Smart-Construction-Site/blob/main/DOCS/公网访问端口映射方案.md) §10：

- **不要映射** `3306`（数据库）与 `8001`（后端，且它只监听 `127.0.0.1`）。
- 对外只用 `8081` 一个端口；不要额外暴露 `8443` 之类。
- 前端**不要长期跑 Vite dev server**（会暴露源码与 sourcemap）；正式必须 `build` + Nginx 托管 `dist`。
- 后端 CORS 已收紧为白名单、默认口令必须更换、`JWT_SECRET_KEY` / `SECRET_ENCRYPTION_KEY` 必须显式设置。
- Let's Encrypt 的 DNS-01 凭证（阿里云 AccessKey）存于 web 侧 `~/.acme.sh/account.conf`（600），
  **不要**写进命令行或提交入库。
- 壳**只**放行 `allowedHosts` 白名单内的主机；不要放开成任意主机，也不要引入
  「全局关闭证书校验」的开关。
- **仓库可见性**：本仓库引用私有 submodule，建议设为 **private**。

---

## 14. 提交规范

提交信息以 `[BUGFIX]` / `[FEATURE]` / `[REFACTOR]` / `[DOCS]` / `[INIT]` 等标签开头，正文用英文。

升级 web submodule 的提交：

```bash
git -C web fetch
git -C web merge --ff-only origin/main
git add web
git commit -m "[FEATURE] bump web submodule to <短提交号>"
```
