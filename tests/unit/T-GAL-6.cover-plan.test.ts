// T-GAL-6：封面的调度和键（apps/desktop/src/renderer/features/gallery/cover-plan.ts、covers-key.ts；
// docs/decisions.md“模板库撑到一百个模板”）。哪些该生成、先做哪个、滚过去的撤掉；缓存键里有内容哈希和语言。
import { describe, expect, it } from 'vitest';
import { CoverPlan } from '../../apps/desktop/src/renderer/features/gallery/cover-plan';
import { coverDiskKey, coverFrame } from '../../apps/desktop/src/renderer/features/gallery/covers-key';

describe('T-GAL-6 封面调度：只做可见范围附近的，先可见后附近，悬停预览最先；滚过去的撤掉', () => {
  it('先后：悬停预览 > 可见（从上到下）> 附近 > 官网的 ensure', () => {
    const plan = new CoverPlan();
    plan.addBackground(['w']);
    plan.setView([
      { key: 'n1', lane: 'near' },
      { key: 'v1', lane: 'visible' },
      { key: 'v2', lane: 'visible' },
      { key: 'n2', lane: 'near' },
    ]);
    plan.setHover('h');
    expect(plan.queue().map((j) => `${j.kind}:${j.key}:${j.lane}`)).toEqual(['sheet:h:hover', 'cover:v1:visible', 'cover:v2:visible', 'cover:n1:near', 'cover:n2:near', 'cover:w:background', 'sheet:w:background']);
  });
  it('整批替换：不在新一批里的不会再被选中；已经有了的跳过', () => {
    const plan = new CoverPlan();
    plan.setView(['a', 'b', 'c', 'd'].map((key) => ({ key, lane: 'visible' as const })));
    expect(plan.next()?.key).toBe('a');
    // 快速滚过去：a、b 出了范围
    plan.setView(['c', 'd', 'e'].map((key) => ({ key, lane: 'visible' as const })));
    expect(plan.wanted('cover', 'a')).toBe(false);
    expect(plan.queue().map((j) => j.key)).toEqual(['c', 'd', 'e']);
    // c 已经有了
    expect(plan.next((j) => j.key !== 'c')?.key).toBe('d');
    plan.setView([]);
    expect(plan.next()).toBeNull();
  });
  it('悬停预览只在悬停时要；移开就不要了（正在做的据此停下）', () => {
    const plan = new CoverPlan();
    plan.setView([{ key: 'a', lane: 'visible' }]);
    expect(plan.wanted('sheet', 'a')).toBe(false);
    plan.setHover('a');
    expect(plan.wanted('sheet', 'a')).toBe(true);
    expect(plan.next()).toEqual({ kind: 'sheet', key: 'a', lane: 'hover' });
    plan.setHover(null);
    expect(plan.wanted('sheet', 'a')).toBe(false);
    // 悬停的卡片的封面也算有人要（滚出范围的卡片上仍停着指针时）
    plan.setView([]);
    plan.setHover('a');
    expect(plan.wanted('cover', 'a')).toBe(true);
  });
  it('官网的 ensure：封面和悬停预览都要，一直要（资源栈变了重画）', () => {
    const plan = new CoverPlan();
    plan.addBackground(['x', 'y', 'x']);
    expect(plan.queue().map((j) => `${j.kind}:${j.key}`)).toEqual(['cover:x', 'sheet:x', 'cover:y', 'sheet:y']);
    plan.setView([]);
    expect(plan.wanted('sheet', 'y')).toBe(true);
  });
});

describe('T-GAL-6 封面的键和取帧', () => {
  it('封面的磁盘缓存键里有 id、版本、哈希、语言，不超过 200 字、只有安全字符', () => {
    const k = coverDiskKey({ id: 'allay.builtin.block-wipe', version: '1.0.0', contentHash: '0123456789abcdef' }, 'zh-CN');
    expect(k).toBe('cover2_allay.builtin.block-wipe_1.0.0_0123456789abcdef_zh-cn');
    const long = coverDiskKey({ id: `user.${'x'.repeat(300)}.y`, version: '1.0.0-beta.1+build.5', contentHash: 'not a hash' }, 'en');
    expect(`${long}~sheet`.length).toBeLessThanOrEqual(200);
    expect(`${long}~sheet`).toMatch(/^[a-z0-9_.~-]{1,200}$/);
    expect(long).toContain('_nohash_');
    expect(coverDiskKey({ id: 'a.b.c', version: '1.0.0', contentHash: '0123456789abcdef' }, 'en')).not.toBe(coverDiskKey({ id: 'a.b.c', version: '1.0.0', contentHash: '0123456789abcdee' }, 'en'));
  });
  it('封面取剪辑点那一帧；没有剪辑点取前 4 秒的中间一帧；越界钳到范围里', () => {
    expect(coverFrame(0.55, 66)).toBe(17);
    expect(coverFrame(null, 120)).toBe(60);
    expect(coverFrame(9, 120)).toBe(119);
    expect(coverFrame(-1, 10)).toBe(0);
  });
});
