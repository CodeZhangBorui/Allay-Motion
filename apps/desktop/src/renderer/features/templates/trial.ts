// 安装时的试运行（docs/04-templates.md 4.8 第 4 步、02-engine.md 2.4）：在杂务 Worker 里用默认参数装载，
// 以 320×180 渲染首帧、cutTime 帧、末帧，全部在看门狗时限内完成；同时做确定性自检和规则 7、8 的检查。
// 装载或渲染失败（含看门狗超时）拒绝安装；其余问题只是警告，仍允许安装（模板卡片上标注）。
import { frameCount } from '@allay/engine/frames';
import { defaultParams, type FrameQuality } from '@allay/template-sdk';
import type { TemplateBundle, TrialWarning } from '../../../shared/templates';
import { EngineHost, type WatchdogTimeouts } from '../../engine-host/EngineHost';
import { createResolver, loadStamp } from '../../engine-host/resource-client';
import { sourceFromBundle, type AssetSource } from '../../templates/catalog';

export const TRIAL_OUTPUT = { width: 320, height: 180 } as const;
/** 标准画质（2.7）：规则 7、8 要在开了运动模糊时也成立 */
const TRIAL_QUALITY: FrameQuality = { subframes: 8, shutterAngle: 180 };

export type TrialResult = { ok: true; warnings: TrialWarning[]; loadWarnings: string[] } | { ok: false; detail: string };

/** 测试可以调短试运行的看门狗 */
export const trialTimeouts: Partial<WatchdogTimeouts> = {};

function alphaRange(px: Uint8Array): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i]!;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return { min, max };
}

export async function trialRun(bundle: TemplateBundle, assets: AssetSource, locale: string): Promise<TrialResult> {
  const source = sourceFromBundle(bundle, assets);
  const fps = source.manifest.defaultOutput?.fps ?? 60;
  const output = { ...TRIAL_OUTPUT, fps };
  let host: EngineHost | null = null;
  try {
    host = await EngineHost.create({ mode: 'utility', resolveResource: createResolver(() => assets), strictDeterminism: true, timeouts: trialTimeouts });
    const loaded = await host.load({
      manifest: source.manifest,
      code: source.code,
      params: defaultParams(source.params, { locale }),
      output,
      resourceStamp: loadStamp(assets),
      locale,
    });
    const last = frameCount(loaded.duration, fps) - 1;
    const cut = loaded.cutTime === null ? null : Math.min(last, Math.round(loaded.cutTime * fps));
    const probe = cut ?? Math.round(last / 2);

    const firstProbe = await host.renderFrame(probe, TRIAL_QUALITY);
    const first = alphaRange(await host.renderFrame(0, TRIAL_QUALITY));
    const lastRange = alphaRange(await host.renderFrame(last, TRIAL_QUALITY));
    // 确定性自检（2.4）：引擎在 Worker 里把同一帧渲染两次、中间穿插首帧和末帧，逐字节比较（像素不出 Worker）
    const mismatch = await host.checkDeterminism(probe, [0, last], TRIAL_QUALITY);

    const warnings: TrialWarning[] = [];
    if (mismatch) warnings.push('nondeterministic');
    if (first.max > 0) warnings.push('first-frame-visible');
    if (lastRange.max > 0) warnings.push('last-frame-visible');
    if (source.manifest.category === 'transition' && (cut === null || alphaRange(firstProbe).min < 255)) warnings.push('cut-not-opaque');
    if (loaded.warnings.length > 0) warnings.push('load-warnings');
    return { ok: true, warnings, loadWarnings: loaded.warnings };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    host?.dispose();
  }
}
