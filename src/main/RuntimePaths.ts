import path from "node:path";
import { app } from "electron";
import { FILES } from "../constants/ShellConstants";

/**
 * 运行期路径（单一来源）。
 *
 * 打包后，兜底页由 electron-builder 的 extraResources 放到 `<安装目录>/resources/` 下
 * （与 app.asar 同级），因此走 process.resourcesPath；开发态直接读仓库里的 `resources/`。
 */
export class RuntimePaths {
  /** 加载失败兜底页的绝对路径 */
  static fallbackPage(): string {
    return path.join(RuntimePaths.resourcesDir(), FILES.fallbackPage);
  }

  /** 状态文件绝对路径（userData 下，随用户走，不随安装目录） */
  static stateFile(): string {
    return path.join(app.getPath("userData"), FILES.state);
  }

  /** 打包后 preload 的绝对路径 */
  static preloadScript(): string {
    return path.join(__dirname, "..", "preload", "FallbackBridge.js");
  }

  private static resourcesDir(): string {
    return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
  }
}
