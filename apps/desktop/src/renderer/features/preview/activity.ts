// 预览“正在换模板、改参数”的信号（docs/decisions.md“模板库撑到一百个模板”）：模板库的封面生成看它让路，
// 切换模板、改参数的预览始终先做。预览引擎（装载、setParams）和选模板（经 IPC 读模板）写，封面服务读。
// 不依赖任何别的模块：官网的落地页也用封面服务，不想因此把预览引擎打进它的代码块。
// 播放不算“忙”：默认工程一直在循环播放，封面不能因此永远等着。

let active = 0;
let lastActive = Number.NEGATIVE_INFINITY;

export const previewActivity = {
  /** 开始一段忙（必须配一个 end） */
  begin(): void {
    active++;
    lastActive = performance.now();
  },
  end(): void {
    active = Math.max(0, active - 1);
    lastActive = performance.now();
  },
  /** 马上要忙（例如已经排了下一帧的装载）：从现在起重新算安静的时长 */
  pulse(): void {
    lastActive = performance.now();
  },
  /** 正在忙，或者忙完还不到 quietMs 毫秒 */
  busy(quietMs: number): boolean {
    return active > 0 || performance.now() - lastActive < quietMs;
  },
};
