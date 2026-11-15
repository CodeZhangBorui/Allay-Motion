import { describe, expect, it } from 'vitest';
import { DownloadTracker, SOUNDS_ESTIMATE_BYTES } from '../../apps/desktop/src/main/resources/download-progress';
import { DOWNLOAD_STAGES, DownloadProgressViewSchema, DownloadStateSchema } from '../../apps/desktop/src/shared/resources';

// T-UX-3 下载原版资源的进度：阶段、字节、速度与剩余时间（docs/06-ui-design.md 6.12）

const MB = 1024 * 1024;

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const statuses = (tr: DownloadTracker) => tr.snapshot().stages.map((s) => s.status);

/** 走一遍完整的成功流程，每一步之后记下分数 */
function fullRun(tr: DownloadTracker, c: ReturnType<typeof clock>, jar = 40 * MB, index = 400_000, sounds = 300_000): number[] {
  const fr: number[] = [];
  const snap = () => fr.push(tr.snapshot().fraction);
  tr.event({ phase: 'manifest', received: 0, total: null });
  snap();
  tr.event({ phase: 'version', received: 0, total: null });
  tr.event({ phase: 'version', received: 900, total: 900, versionId: '1.21.9', plan: { jarBytes: jar, indexBytes: index } });
  snap();
  tr.event({ phase: 'jar', received: 0, total: jar });
  for (let got = 0; got < jar; ) {
    got = Math.min(jar, got + 4 * MB);
    c.advance(250);
    tr.event({ phase: 'jar', received: got, total: jar });
    snap();
  }
  tr.event({ phase: 'index', received: 0, total: index });
  c.advance(50);
  tr.event({ phase: 'index', received: index, total: index });
  snap();
  tr.enter('extract', 'scan');
  snap();
  tr.enter('sounds', 'sounds-list');
  tr.event({ phase: 'object', received: 0, total: null });
  snap();
  tr.event({ phase: 'object', received: 0, total: sounds, items: { done: 0, total: 3 } });
  snap();
  for (let i = 1; i <= 3; i++) {
    c.advance(100);
    tr.event({ phase: 'object', received: Math.round((sounds * i) / 3), total: sounds, items: { done: i, total: 3 } });
    snap();
  }
  tr.enter('finalize', 'stack');
  snap();
  return fr;
}

describe('T-UX-3 下载进度', () => {
  it('阶段按顺序走，各有自己的状态；整体进度只增不减，完成之前不到 100%', () => {
    const c = clock();
    const tr = new DownloadTracker(c.now);
    expect(tr.snapshot().stage).toBe('manifest');
    expect(statuses(tr)).toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
    const fr = fullRun(tr, c);
    for (let i = 1; i < fr.length; i++) expect(fr[i]!, `step ${i}`).toBeGreaterThanOrEqual(fr[i - 1]!);
    expect(Math.max(...fr)).toBeLessThanOrEqual(0.99);
    // 字节下完、进入最后一步时已经过了 90%，不会停在半路
    expect(fr.at(-1)!).toBeGreaterThan(0.9);
    expect(statuses(tr)).toEqual(['done', 'done', 'done', 'done', 'active']);
    tr.complete();
    const done = tr.snapshot();
    expect(done.fraction).toBe(1);
    expect(done.activity).toBe('done');
    expect(statuses(tr)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(done.received).toBe(40 * MB + 400_000 + 300_000);
    expect(done.total).toBe(done.received);
    expect(done.versionId).toBe('1.21.9');
    expect(DownloadProgressViewSchema.safeParse(done).success).toBe(true);
  });

  it('整体按字节算：jar 下了一半时约在一半的位置；已知的总大小随资源索引补上音效', () => {
    const c = clock();
    const tr = new DownloadTracker(c.now);
    tr.event({ phase: 'version', received: 1, total: 1, versionId: 'x', plan: { jarBytes: 40 * MB, indexBytes: MB } });
    tr.event({ phase: 'jar', received: 20 * MB, total: 40 * MB });
    const s = tr.snapshot();
    expect(s.received).toBe(20 * MB);
    expect(s.total).toBe(41 * MB);
    const expected = 0.02 + (0.9 * 20 * MB) / (41 * MB + SOUNDS_ESTIMATE_BYTES);
    expect(s.fraction).toBeCloseTo(expected, 5);
    expect(s.stages[1]).toEqual({ id: 'jar', status: 'active', received: 20 * MB, total: 40 * MB });
  });

  it('音效总量的估计不超过 jar 的 5%：小 jar 下了一半时也在一半左右', () => {
    const tr = new DownloadTracker(clock().now);
    tr.event({ phase: 'version', received: 1, total: 1, plan: { jarBytes: 40_000, indexBytes: 0 } });
    tr.event({ phase: 'jar', received: 20_000, total: 40_000 });
    expect(tr.snapshot().fraction).toBeCloseTo(0.02 + (0.9 * 20_000) / 42_000, 5);
  });

  it('音效比估计的小：分数不往回跳', () => {
    const c = clock();
    const tr = new DownloadTracker(c.now);
    tr.event({ phase: 'version', received: 1, total: 1, plan: { jarBytes: MB, indexBytes: 0 } });
    tr.event({ phase: 'jar', received: MB, total: MB });
    const before = tr.snapshot().fraction;
    tr.enter('sounds');
    tr.event({ phase: 'object', received: 0, total: 10 * MB, items: { done: 0, total: 5 } });
    expect(tr.snapshot().fraction).toBeGreaterThanOrEqual(before);
  });

  it('阶段不回退：更早的阶段的上报不改变当前阶段', () => {
    const tr = new DownloadTracker(clock().now);
    tr.event({ phase: 'jar', received: 10, total: 100 });
    tr.event({ phase: 'manifest', received: 0, total: null });
    expect(tr.snapshot().stage).toBe('jar');
    expect(tr.snapshot().activity).toBe('jar');
  });

  it('已缓存的 jar：算作已收到，不计入速度', () => {
    const c = clock();
    const tr = new DownloadTracker(c.now);
    tr.event({ phase: 'version', received: 1, total: 1, versionId: 'v', plan: { jarBytes: 40 * MB, indexBytes: 0 } });
    tr.event({ phase: 'jar', received: 40 * MB, total: 40 * MB, cached: true });
    const s = tr.snapshot();
    expect(s.activity).toBe('jar-cached');
    expect(s.received).toBe(40 * MB);
    expect(s.bytesPerSecond).toBeNull();
    expect(s.etaSeconds).toBeNull();
  });

  it('速度和剩余时间：按最近 3 秒从网络收到的字节；停住 2 秒后不再显示', () => {
    const c = clock();
    const tr = new DownloadTracker(c.now);
    tr.event({ phase: 'version', received: 1, total: 1, plan: { jarBytes: 40 * MB, indexBytes: 0 } });
    tr.event({ phase: 'jar', received: 0, total: 40 * MB });
    // 数据不够（不到 0.5 秒）时不显示
    c.advance(100);
    tr.event({ phase: 'jar', received: MB, total: 40 * MB });
    expect(tr.snapshot().bytesPerSecond).toBeNull();
    // 每 0.5 秒 1 MB = 2 MB/s
    for (let i = 2; i <= 10; i++) {
      c.advance(500);
      tr.event({ phase: 'jar', received: i * MB, total: 40 * MB });
    }
    const s = tr.snapshot();
    expect(s.bytesPerSecond! / MB).toBeCloseTo(2, 1);
    // 剩下 30 MB 加上音效的估计，约 15.5 秒
    expect(s.etaSeconds!).toBeCloseTo((30 * MB + SOUNDS_ESTIMATE_BYTES) / (2 * MB), 0);
    c.advance(2500);
    expect(tr.snapshot().bytesPerSecond).toBeNull();
    expect(tr.snapshot().etaSeconds).toBeNull();
  });

  it('失败、取消：停在当前阶段，那一步标成 failed / canceled，其余不变', () => {
    const tr = new DownloadTracker(clock().now);
    tr.event({ phase: 'version', received: 1, total: 1, plan: { jarBytes: 100, indexBytes: 10 } });
    tr.event({ phase: 'jar', received: 50, total: 100 });
    tr.stop('failed');
    expect(tr.snapshot().stage).toBe('jar');
    expect(statuses(tr)).toEqual(['done', 'failed', 'pending', 'pending', 'pending']);
    const state = { status: 'failed', error: 'network', progress: tr.snapshot() };
    expect(DownloadStateSchema.safeParse(state).success).toBe(true);

    const t2 = new DownloadTracker(clock().now);
    t2.enter('sounds', 'sounds-list');
    t2.stop('canceled');
    expect(t2.snapshot().stages.map((s) => s.status)).toEqual(['done', 'done', 'done', 'canceled', 'pending']);
  });

  it('不合法的上报被拒绝，进度不变（zod 校验）', () => {
    const tr = new DownloadTracker(clock().now);
    const before = tr.snapshot();
    expect(tr.event({ phase: 'jar', received: -1, total: 10 })).toBe(false);
    expect(tr.event({ phase: 'nope', received: 0, total: 0 })).toBe(false);
    expect(tr.event({ phase: 'jar', received: 0, total: 0, extra: 1 })).toBe(false);
    expect(tr.event('jar')).toBe(false);
    expect(tr.snapshot()).toEqual(before);
  });

  it('渲染进程那边的校验：阶段数量、顺序、取值范围不对都拒绝', () => {
    const good = new DownloadTracker(clock().now).snapshot();
    expect(DownloadStateSchema.safeParse({ status: 'running', progress: good }).success).toBe(true);
    expect(DownloadStateSchema.safeParse({ status: 'running', progress: { ...good, fraction: 1.5 } }).success).toBe(false);
    expect(DownloadStateSchema.safeParse({ status: 'running', progress: { ...good, stages: good.stages.slice(1) } }).success).toBe(false);
    expect(DownloadStateSchema.safeParse({ status: 'running', progress: { ...good, stages: [...good.stages].reverse() } }).success).toBe(false);
    expect(DownloadStateSchema.safeParse({ status: 'running' }).success).toBe(false);
    expect(DownloadStateSchema.safeParse({ status: 'failed', error: 'oops', progress: good }).success).toBe(false);
    expect(DOWNLOAD_STAGES).toEqual(['manifest', 'jar', 'extract', 'sounds', 'finalize']);
  });

  it('没有资源索引的版本：音效阶段按实际收到的结算，最后照样到 1', () => {
    const tr = new DownloadTracker(clock().now);
    tr.event({ phase: 'version', received: 1, total: 1, plan: { jarBytes: 1000, indexBytes: 0 } });
    tr.event({ phase: 'jar', received: 1000, total: 1000 });
    tr.enter('extract', 'scan');
    tr.enter('sounds', 'sounds-list');
    tr.enter('finalize', 'stack');
    const s = tr.snapshot();
    expect(s.total).toBe(1000);
    expect(s.fraction).toBeGreaterThan(0.9);
    tr.complete();
    expect(tr.snapshot().fraction).toBe(1);
  });
});
