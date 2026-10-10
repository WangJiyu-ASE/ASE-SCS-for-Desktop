import { dialog, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { SHELL } from "../constants/ShellConstants";
import { ShellIdentity } from "../shared/ShellIdentity";
import { SiteResolver } from "./SiteResolver";

/** 菜单需要的动作，由 ShellWindow 提供 */
export interface ShellMenuActions {
  /** 重新加载站点 */
  retry(): void;
  /** 回到默认站点地址（清掉手动指定） */
  useDefault(): void;
  /** 仅重载当前页面 */
  reload(): void;
}

/**
 * 应用菜单（单一实体）。
 *
 * 站点只有单一域名后，菜单不再需要「切内网/公网」；保留的是
 * 「重试 / 回到默认地址 / 调试 / 关于」这类现场排查入口。
 *
 * 视图菜单里的 `role` 项都显式写了中文 `label`：Electron 的默认标签是英文，
 * 不覆盖会在这套全中文界面里显得突兀（`role` 与自定义 `label`/`accelerator` 可共存，
 * 只有 `click` 会被 `role` 忽略）。
 */
export class AppMenu {
  static build(actions: ShellMenuActions): void {
    const siteUrl = SiteResolver.defaultTarget().url;

    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
      {
        label: "连接",
        submenu: [
          { label: "重新加载站点", accelerator: "CmdOrCtrl+R", click: () => actions.retry() },
          { label: "回到默认站点地址", click: () => actions.useDefault() },
          { type: "separator" },
          { label: "在浏览器中打开站点", click: () => void shell.openExternal(siteUrl) },
        ],
      },
      {
        label: "视图",
        submenu: [
          { label: "重载当前页面", accelerator: "F5", click: () => actions.reload() },
          { role: "forceReload", label: "强制重载", accelerator: "CmdOrCtrl+Shift+R" },
          { type: "separator" },
          { role: "resetZoom", label: "重置缩放" },
          { role: "zoomIn", label: "放大" },
          { role: "zoomOut", label: "缩小" },
          { type: "separator" },
          { role: "togglefullscreen", label: "切换全屏" },
          // F12 是 Windows 上的通用调试键；现场排查「页面是不是旧版 / 哪个接口没回来」全靠它
          { role: "toggleDevTools", label: "开发者工具", accelerator: "F12" },
        ],
      },
      {
        label: "帮助",
        submenu: [{ label: "关于", click: () => void AppMenu.showAbout() }],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  /** 「关于」：把版本、web 版本、站点地址一次性摊开，方便现场核对 */
  private static async showAbout(): Promise<void> {
    const detail = [
      `壳版本：${ShellIdentity.appVersion()}`,
      `web 版本（submodule 提交）：${ShellIdentity.webCommit()}`,
      `构建时间：${ShellIdentity.buildTime()}`,
      "",
      `站点地址：${SiteResolver.defaultTarget().url}`,
      "证书：Let's Encrypt（由系统信任库校验，壳不内置 CA）",
      "",
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
