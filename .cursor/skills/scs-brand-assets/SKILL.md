---
name: scs-brand-assets
description: >-
  SCS 桌面壳图标与 Windows 安装包；出包用 npm run dist:win（package-win.mjs）。
---

# SCS 品牌资源与出包

## 根因

不要在仓库 `release/` 下生成 `win-unpacked`（IDE 会锁 `app.asar`）。`package-win.mjs` 在系统临时目录构建，只复制安装包到 `release/`。

## 常量与脚本

| 文件 | 作用 |
|---|---|
| `scripts/brand-icon.constants.mjs` | 登录页图标与配色 |
| `scripts/installer.constants.mjs` | NSIS 文案与 BMP 尺寸 |
| `scripts/packaging.constants.mjs` | 临时输出目录、交付文件名 |
| `scripts/gen-icon.mjs` | 生成 `resources/icon.ico` 与 installer BMP |
| `scripts/package-win.mjs` | 一键出包（dist:win 调用） |

图标须用 `png-to-ico` 生成 `.ico`。

## 命令

```bash
npm run dist:win
```
