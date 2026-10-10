import fs from "node:fs";
import path from "node:path";
import { RuntimePaths } from "./RuntimePaths";

/** 记忆的窗口位置与尺寸 */
export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/** 落盘结构 */
interface StateShape {
  /**
   * 用户手动指定 / 菜单指定的地址（优先级最高，清空即回到默认站点地址）。
   * 站点只有单一域名，因此不再需要「记住上次探测成功的地址」。
   */
  manualEndpoint?: string;
  /** 窗口位置与尺寸 */
  window?: WindowBounds;
}

/**
 * 壳的本地状态（单一实体）。
 *
 * 只做一件事：把「用户指定的地址、窗口摆在哪」持久化到 userData，
 * 读写失败一律降级为「当作没有记忆」，绝不让状态文件影响启动。
 */
export class ShellState {
  private data: StateShape = {};

  load(): void {
    try {
      const raw = fs.readFileSync(RuntimePaths.stateFile(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        this.data = parsed as StateShape;
      }
    } catch {
      // 首次运行 / 文件损坏：静默回到空状态
      this.data = {};
    }
  }

  save(): void {
    try {
      const file = RuntimePaths.stateFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.data, null, 2), "utf8");
    } catch (error) {
      console.error("[state] 状态写入失败：", error);
    }
  }

  get manualEndpoint(): string | null {
    return this.data.manualEndpoint ?? null;
  }

  setManualEndpoint(url: string | null): void {
    if (url) {
      this.data.manualEndpoint = url;
    } else {
      delete this.data.manualEndpoint;
    }
    this.save();
  }

  get windowBounds(): WindowBounds | undefined {
    return this.data.window;
  }

  setWindowBounds(bounds: WindowBounds | undefined): void {
    if (bounds) {
      this.data.window = bounds;
    } else {
      delete this.data.window;
    }
    this.save();
  }
}
