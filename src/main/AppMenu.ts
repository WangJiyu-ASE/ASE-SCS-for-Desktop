import { dialog, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { SHELL } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import { RuntimePaths } from "./RuntimePaths";

/** 菜单需要的动作，由 ShellWindow 提供 */
export interface ShellMenuActions {
  /** 重新探测并加载 */
  retry(): void;
  /** 回到自动选择 */
  useAuto(): void;
  /** 指定某个站点地址 */
  useEndpoint(url: string): void;
  /** 仅重载当前页面 */
  reload(): void;
}

/**
 * 应用菜单（单一实体）。
 *
 * 桌面端必须有显式的「换服务器 / 重试 / 关于」入口：现场网络切换后，
 * 用户不必重装或改配置，直接从菜单切内网/公网即可。
 */
export class AppMenu {
  static build(actions: ShellMenuActions): void {
    const connectionItems: MenuItemConstructorOptions[] = [
      { label: "重新探测并加载", accelerator: "CmdOrCtrl+R", click: () => actions.retry() },
      { type: "separator" },
      { label: "自动选择服务器（内网优先）", click: () => actions.useAuto() },
      { label: `仅用内网 ${SHELL.endpoints.intranet}`, click: () => actions.useEndpoint(SHELL.endpoints.intranet) },
      { label: `仅用公网 ${SHELL.endpoints.public}`, click: () => actions.useEndpoint(SHELL.endpoints.public) },
    ];

    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
      { label: "连接", submenu: connectionItems },
      {
        label: "视图",
        submenu: [
          { label: "重载当前页面", accelerator: "F5", click: () => actions.reload() },
          { role: "forceReload" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "帮助",
        submenu: [
          { label: "关于", click: () => void AppMenu.showAbout() },
          {
            label: "打开 CA 证书下载页（内网终端装信任用）",
            click: () => void shell.openExternal(`${SHELL.endpoints.public}ase-ca.crt`),
          },
          { label: "查看内置 CA 证书文件", click: () => shell.showItemInFolder(RuntimePaths.caCertFile()) },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  /** 「关于」：把版本、web 版本、地址、CA 指纹一次性摊开，方便现场核对 */
  private static async showAbout(): Promise<void> {
    const detail = [
      `壳版本：${ShellIdentity.appVersion()}`,
      `web 版本（submodule 提交）：${ShellIdentity.webCommit()}`,
      `构建时间：${ShellIdentity.buildTime()}`,
      "",
      `内网地址：${SHELL.endpoints.intranet}`,
      `公网地址：${SHELL.endpoints.public}`,
      "",
      `内置 CA SHA-256：${SHELL.caFingerprintSha256}`,
      `Electron：${process.versions.electron}  Chromium：${process.versions.chrome}  Node：${process.versions.node}`,
    ].join("\n");

    await dialog.showMessageBox({
      type: "info",
      title: `关于 ${SHELL.productName}`,
      message: SHELL.productName,
      detail,
      buttons: ["确定"],
      noLink: true,
    });
  }
}
