import type { SiteProbeResult } from "../main/SiteResolver";

/**
 * 兜底页要展示的状态（主进程 → 兜底页的唯一数据契约）。
 *
 * 定义在 shared 下，是为了让「生成方（主进程）」与「消费方（兜底页）」引用同一份结构；
 * 改字段时两边一起改。
 */
export interface ShellStatus {
  /** 地址探测结果（当前地址 + 默认站点），加载失败后才会有值 */
  candidates: SiteProbeResult[];
  /** 当前正在使用的地址（null 表示还没选中） */
  active: string | null;
  /** 用户手动指定的地址（null 表示用的是默认站点地址） */
  manual: string | null;
  /** 当前是否正停在兜底页 */
  showingFallback: boolean;
  /** 最近一次失败说明 */
  lastError: string | null;
  /** 壳版本 */
  appVersion: string;
  /** 构建时锁定的 web submodule 提交号 */
  webCommit: string;
  /** 构建时间 */
  buildTime: string;
}
