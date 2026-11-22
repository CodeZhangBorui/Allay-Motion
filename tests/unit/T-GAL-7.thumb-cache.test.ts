// T-GAL-7：缩略图缓存的总量上限（apps/desktop/src/main/thumb-cache.ts；docs/decisions.md“模板库撑到一百个模板”）。
// 超过上限时按最近用到的先后删掉最久没用的，删到上限的 80%；读到一次算用到一次；重启后按文件的修改时间认出先后；
// 换了 stamp 旧目录整个删掉。PNG 是测试时生成的纯色色块。
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_CACHE_BYTES, ThumbCache } from '../../apps/desktop/src/main/thumb-cache';
import { MAX_THUMB_BYTES } from '../../apps/desktop/src/shared/resources';
import { solidPng } from './helpers/resource-fixtures';

const STAMP = '0123456789abcdef';
const OTHER = 'fedcba9876543210';

/** 一张约 size 字节的“PNG”：真的 PNG 头（缓存只看文件头）加填充 */
function pngOf(size: number): Uint8Array {
  const head = solidPng('#336699');
  const out = new Uint8Array(Math.max(size, head.byteLength));
  out.set(head);
  return out;
}

let dir: string;
let clock: number;
const now = () => clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-gal7-'));
  clock = 1_700_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const files = () => readdirSync(join(dir, 'cache', 'thumbs', STAMP)).sort();

describe('T-GAL-7 缩略图缓存的总量上限', () => {
  it('上限是总量（不是单个文件），单个文件另有 8 MB 的上限', async () => {
    expect(MAX_CACHE_BYTES).toBeGreaterThan(MAX_THUMB_BYTES * 8);
    const cache = new ThumbCache(dir);
    expect((await cache.usage()).limit).toBe(MAX_CACHE_BYTES);
  });

  it('超过上限：删掉最久没用的，删到 80%；刚写入的不删', async () => {
    const cache = new ThumbCache(dir, 1000, now);
    for (const k of ['a', 'b', 'c', 'd']) {
      clock += 1000;
      expect(await cache.put(STAMP, k, pngOf(300))).toBe(true);
    }
    // 第四张写进去时 1200 > 1000：从最久没用的删起，删到 800 以下 → a、b 被删
    expect(files()).toEqual(['c.png', 'd.png']);
    expect((await cache.usage()).bytes).toBe(600);
  });

  it('读到一次算用到：最近读过的留下', async () => {
    const cache = new ThumbCache(dir, 1000, now);
    for (const k of ['a', 'b', 'c']) {
      clock += 1000;
      await cache.put(STAMP, k, pngOf(300));
    }
    clock += 1000;
    expect(await cache.get(STAMP, 'a')).not.toBeNull();
    clock += 1000;
    await cache.put(STAMP, 'd', pngOf(300));
    expect(files()).toEqual(['a.png', 'd.png']);
  });

  it('重启后按文件的修改时间认出谁最久没用；上次留下的临时文件顺手删掉', async () => {
    const stampDir = join(dir, 'cache', 'thumbs', STAMP);
    const first = new ThumbCache(dir, 1000, now);
    await first.put(STAMP, 'old', pngOf(400));
    await first.put(STAMP, 'new', pngOf(400));
    utimesSync(join(stampDir, 'old.png'), new Date(1_000_000), new Date(1_000_000));
    utimesSync(join(stampDir, 'new.png'), new Date(9_000_000), new Date(9_000_000));
    writeFileSync(join(stampDir, '.abcdef.tmp'), 'x');
    const second = new ThumbCache(dir, 1000, now);
    await second.put(STAMP, 'more', pngOf(400));
    expect(files()).toEqual(['more.png', 'new.png']);
  });

  it('换了 stamp：旧目录整个删掉，新目录从零算', async () => {
    const cache = new ThumbCache(dir, 1000, now);
    await cache.put(STAMP, 'a', pngOf(900));
    await cache.put(OTHER, 'b', pngOf(900));
    expect(existsSync(join(dir, 'cache', 'thumbs', STAMP))).toBe(false);
    expect(readdirSync(join(dir, 'cache', 'thumbs', OTHER))).toEqual(['b.png']);
    expect(await cache.get(OTHER, 'b')).not.toBeNull();
  });

  it('同一个键再写一遍：按新大小算，不重复计数', async () => {
    const cache = new ThumbCache(dir, 1000, now);
    for (let i = 0; i < 10; i++) await cache.put(STAMP, 'same', pngOf(400));
    await cache.put(STAMP, 'other', pngOf(400));
    expect(files()).toEqual(['other.png', 'same.png']);
  });

  it('并发写入不丢账：写完总量不超过上限', async () => {
    const cache = new ThumbCache(dir, 2000, now);
    await Promise.all(Array.from({ length: 20 }, (_, i) => cache.put(STAMP, `k${i}`, pngOf(300))));
    const usage = await cache.usage();
    expect(usage.bytes).toBeLessThanOrEqual(2000);
    expect(usage.files).toBe(files().length);
  });

  it('不是 PNG 的拒绝；清空之后从头算', async () => {
    const cache = new ThumbCache(dir, 1000, now);
    expect(await cache.put(STAMP, 'x', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false);
    await cache.put(STAMP, 'a', pngOf(900));
    await cache.clear();
    await cache.put(STAMP, 'b', pngOf(900));
    expect(files()).toEqual(['b.png']);
  });
});
