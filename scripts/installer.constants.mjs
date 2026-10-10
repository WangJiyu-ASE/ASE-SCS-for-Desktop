/** NSIS 安装向导文案与尺寸（改安装包外观只改本文件 + gen-icon.mjs） */

export const INSTALLER_ASSETS = {
  /** 向导左侧竖条（NSIS 经典 UI 规格） */
  sidebar: { width: 164, height: 314 },
  /** 向导顶部横条 */
  header: { width: 150, height: 57 },
};

export const INSTALLER_COPY = {
  productLine: "SCS 智慧工地",
  /** 侧栏主标题（竖条 164px 宽，可放完整名） */
  title: "智慧工地管理系统",
  tagline: "实名制 · 出勤 · 安全 · 质量",
  /**
   * 顶栏横幅文案（NSIS installerHeader 固定 150×57，只能一行短字，否则会裁切溢出）
   */
  headerLine: "SCS 智慧工地",
};
