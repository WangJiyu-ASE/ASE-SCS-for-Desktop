import path from "node:path";
import { app, Session } from "electron";

/**
 * 下载落盘（单一实体）。
 *
 * 页面的导出（Excel / Word）走 `<a download>` + `blob:`，桌面端不需要像 Android 那样
 * 做 JS 桥 —— Chromium 原生就能处理。这里只做一件确定化的事：**统一存到系统下载目录**，
 * 避免默认行为在不同机器上不一致（有时弹保存框、有时静默落到别处）。
 */
export class DownloadHandler {
  private static attached = false;

  static attach(target: Session): void {
    if (DownloadHandler.attached) return;
    DownloadHandler.attached = true;

    target.on("will-download", (_event, item) => {
      const savePath = path.join(app.getPath("downloads"), item.getFilename());
      item.setSavePath(savePath);
      item.once("done", (_doneEvent, state) => {
        console.log(`[download] ${item.getFilename()} → ${state}（${savePath}）`);
      });
    });
  }
}
