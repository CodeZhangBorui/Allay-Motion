// 渲染目标稳定性探针在测试里的用法（docs/decisions.md“Intel 核显上渲染目标偶发被写坏”）。
//
// 每个 spec 的 beforeAll 跑一次（约 1.5 秒）：测试页在 Worker 里用裸 WebGL2 反复渲染一个静止的小场景
// （docs/reference/intel-igpu-rt-corruption/rt-probe.js，不经过引擎），读回的整帧应当每次都一样。
// - 出现两种以上的结果：这块显卡（驱动）会写坏渲染目标。这台机器上逐字节的判定（T-ENG-1 一类）带理由跳过，
//   探针的结果（多少帧里几帧不一致、渲染器、驱动版本、样例像素）打进测试输出；其余判定照常。
// - 没看到不一致（包括探针跑不起来）：一律照常判定。CI 的 WARP 和独显上不放宽任何一条。
import type { ElectronApplication, Page } from '@playwright/test';
import type { Harness } from './harness/harness';

export interface RtProbeVerdict {
  /** false：探针确实看到了同一个场景渲染出不同的结果 */
  stable: boolean;
  /** 打进测试输出的说明 */
  summary: string;
}

type ProbeResult = Awaited<ReturnType<Harness['rtProbe']>>;

/** 跑一次探针。budgetMs 是时限；看到 3 帧不一致就提前结束 */
export async function probeRenderTargets(app: ElectronApplication, page: Page, budgetMs = 1500): Promise<RtProbeVerdict> {
  let driver = 'unknown';
  try {
    // 'basic' 里所有设备的 active 都是 false，要用 'complete' 才知道 GPU 进程实际用的是哪一块
    const info = (await app.evaluate(({ app: a }) => a.getGPUInfo('complete'))) as { gpuDevice?: { active?: boolean; driverVersion?: string }[] };
    const active = info.gpuDevice?.find((d) => d.active);
    if (active?.driverVersion) driver = active.driverVersion;
  } catch {
    // 拿不到驱动版本不影响判定
  }
  let r: ProbeResult;
  try {
    r = await page.evaluate((opts) => window.harness.rtProbe(opts), { budgetMs, stopAfter: 3 });
  } catch (error) {
    return { stable: true, summary: `渲染目标探针没能运行（${(error as Error).message}），逐字节判定照常` };
  }
  const sample = r.events[0]?.sample;
  const where = sample ? `，例如第 ${r.events[0]!.frame} 帧 (${sample.x}, ${sample.y}) 应为 ${sample.expected.join('.')}、实为 ${sample.got.join('.')}` : '';
  const stable = r.distinct <= 1;
  const summary = `渲染目标探针：${r.renderer}，驱动 ${driver}：${r.frames} 帧里 ${r.bad} 帧不一致（${r.distinct} 种结果，${r.ms} ms）${where}`;
  return { stable, summary: stable ? summary : `${summary}。这台机器的显卡驱动会写坏渲染目标，逐字节判定跳过（docs/decisions.md）` };
}
