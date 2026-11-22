// 061 穿云 allay.builtin.cloud-pass 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/cloud-pass.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（镜头的路线、白掉的程度）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { approach, CLOUD_HEIGHT, DIRECTIONS, FOG_END, FOV, leave, PITCH, startDistance, whiteout } from '../../packages/templates/cloud-pass/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/cloud-pass/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];
const def = (key: string): ParamDef => defs.find((p) => p.key === key)!;
const range = (key: string): [number, number] => {
  const p = def(key);
  if (p.type !== 'duration') throw new Error(key);
  return [p.min, p.max];
};

describe('T-TPL-C061 穿云', () => {
  it('T-TPL-C061-1 manifest 合法，默认参数清洗后不变；转场、分组 particles、三段时间线；方向只有往上、往下', () => {
    expect(manifest.id).toBe('allay.builtin.cloud-pass');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('particles');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    const dir = def('direction');
    expect(dir.type === 'enum' ? dir.options.map((x) => x.value) : []).toEqual([...DIRECTIONS]);
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C061-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C061-3 起止的距离：最陡的视线碰到云层也比雾的终点远（首末帧看不到云）', () => {
    const steepest = ((PITCH + FOV / 2) * Math.PI) / 180;
    const d = startDistance();
    // 从云层中间往下 d 格；视线到云层底的距离 = (d − 半厚) / sin(仰角)
    expect((d - CLOUD_HEIGHT / 2) / Math.sin(steepest)).toBeGreaterThan(FOG_END);
  });

  it('T-TPL-C061-4 镜头的路线：进入从 −D 到云层中间、越近越慢，退出从中间到 +D；白掉在正中为 1、离开云层以后为 0', () => {
    const D = 200;
    const m = CLOUD_HEIGHT / 2;
    expect(approach(0, D, m)).toBe(m - D);
    expect(approach(1, D, m)).toBe(m);
    expect(leave(0, D, m)).toBe(m);
    expect(leave(1, D, m)).toBe(m + D);
    // 越近越慢：后一半走的路比前一半短得多
    expect(approach(1, D, m) - approach(0.5, D, m)).toBeLessThan((approach(0.5, D, m) - approach(0, D, m)) / 4);
    expect(whiteout(0, m)).toBe(1);
    expect(whiteout(m + 1.5, m)).toBe(0);
    expect(whiteout(-(m + 2), m)).toBe(0);
    expect(whiteout(1, m)).toBeGreaterThan(0);
    expect(whiteout(1, m)).toBeLessThan(1);
  });
});
