// T-FNT：字体（docs/decisions.md“2026-11 反馈：原版动画还原与字体”）。
// - T-FNT-1 字体定义：unihex 提供器、filter（uniform / jp 选项按游戏默认关）。
// - T-FNT-2 Unifont 的 .hex 解析：宽度按墨迹、size_overrides、前进宽度 floor(列数 / 2) + 1、先出现的码位胜出。
// - T-FNT-3 主进程从资源栈里的 zip 读出 unihex 字形表（内存里解开，不写盘）；不安全的条目名整个拒绝。
// - T-FNT-4 用户导入字体：按文件头认格式、复制进应用数据目录、按内容哈希命名；不认识的文件、目录外的 ID 被拒绝。
// 所有字形数据都是测试里手写的几行 .hex（不是 Unifont 的原文），字体文件是只有文件头的假数据。
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFontJson, parseUnihex, resolveFontProviders } from '../../packages/assets/src/index';
import { readHexEntries, sniffFontFormat, UserFontStore } from '../../apps/desktop/src/main/resources/fonts';
import { createLogger } from '../../apps/desktop/src/main/logger';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { DownloadError, type VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { buildZip, writeFiles } from './helpers/resource-fixtures';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-fnt-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 8 列宽的“A”形状：第 1–6 列有墨迹 */
const HEX_A = '0041:0000000018242442427E424242420000';
/** 16 列宽、墨迹在第 2–12 列（3FF8 = 0011 1111 1111 1000） */
const HEX_WIDE = `4E2D:${'0100'.repeat(3)}3FF8${'2108'.repeat(6)}3FF8${'0100'.repeat(5)}`;
/** 全空的字形 */
const HEX_EMPTY = `3000:${'0000'.repeat(16)}`;

describe('T-FNT-1 字体定义里的 unihex 和 filter', () => {
  it('unihex 提供器记下 zip 路径和覆盖；要求 uniform / jp 打开的提供器和 reference 跳过', async () => {
    const files: Record<string, string> = {
      'assets/minecraft/font/default.json': JSON.stringify({
        providers: [
          { type: 'reference', id: 'minecraft:include/default', filter: { uniform: false } },
          { type: 'reference', id: 'minecraft:include/forced', filter: { uniform: true } },
          { type: 'reference', id: 'minecraft:include/unifont' },
        ],
      }),
      'assets/minecraft/font/include/default.json': JSON.stringify({ providers: [{ type: 'bitmap', file: 'minecraft:font/ascii.png', ascent: 7, chars: ['A'] }] }),
      'assets/minecraft/font/include/forced.json': JSON.stringify({ providers: [{ type: 'bitmap', file: 'minecraft:font/forced.png', ascent: 7, chars: ['B'] }] }),
      'assets/minecraft/font/include/unifont.json': JSON.stringify({
        providers: [
          { type: 'unihex', hex_file: 'minecraft:font/unifont.zip', size_overrides: [{ from: '、', to: 'ヿ', left: 0, right: 15 }] },
          { type: 'unihex', hex_file: 'minecraft:font/unifont_jp.zip', filter: { jp: true } },
        ],
      }),
    };
    const r = await resolveFontProviders('minecraft:default', async (p) => (files[p] ? [parseFontJson(files[p])] : null));
    expect(r.providers).toEqual([
      expect.objectContaining({ type: 'bitmap', file: 'assets/minecraft/textures/font/ascii.png' }),
      { type: 'unihex', file: 'assets/minecraft/font/unifont.zip', overrides: [{ from: 0x3001, to: 0x30ff, left: 0, right: 15 }] },
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('hex_file 不是 zip、缺字段的 unihex 记为无效', () => {
    const f = parseFontJson(JSON.stringify({ providers: [{ type: 'unihex', hex_file: 'minecraft:font/x.hex' }, { type: 'unihex' }] }));
    expect(f.providers).toEqual([]);
    expect(f.skipped).toEqual(['unihex(invalid)', 'unihex(invalid)']);
  });
});

describe('T-FNT-2 Unifont 的 .hex 解析', () => {
  const at = (t: ReturnType<typeof parseUnihex>, cp: number) => {
    const k = t.codepoints.indexOf(cp);
    return k < 0 ? null : Array.from(t.metrics.subarray(k * 5, k * 5 + 5));
  };

  it('宽度按墨迹，前进宽度存成 2 × (floor(列数 / 2) + 1)，度量是半个字体像素', () => {
    const t = parseUnihex([`${HEX_A}\n${HEX_WIDE}\n${HEX_EMPTY}\n`]);
    expect(t.oversample).toBe(2);
    expect(t.ascent).toBe(14);
    expect(t.descent).toBe(2);
    // [前进, 宽, 高, x 偏移, y 偏移]
    expect(at(t, 0x41)).toEqual([8, 6, 16, 0, -2]);
    expect(at(t, 0x4e2d)).toEqual([2 * (Math.floor(11 / 2) + 1), 11, 16, 0, -2]);
    expect(at(t, 0x3000)).toEqual([2, 0, 16, 0, -2]);
  });

  it('size_overrides 指定左右列；位图从左边界开始裁', () => {
    const t = parseUnihex([HEX_WIDE], [{ from: 0x4e00, to: 0x4eff, left: 0, right: 15 }]);
    expect(at(t, 0x4e2d)).toEqual([18, 16, 16, 0, -2]);
    // 第 3 行是 3FF8：0011 1111 1111 1000，按 16 列存 2 字节
    const k = t.codepoints.indexOf(0x4e2d);
    const off = t.offsets[k]!;
    expect([t.bits[off + 3 * 2], t.bits[off + 3 * 2 + 1]]).toEqual([0x3f, 0xf8]);
  });

  it('同一码位先出现的胜出；格式不对的行跳过', () => {
    const t = parseUnihex([`${HEX_A}\nnot a line\n0042:XYZ\n0043:00`, `0041:${'FF'.repeat(16)}`]);
    expect(Array.from(t.codepoints)).toEqual([0x41]);
    expect(at(t, 0x41)?.[1]).toBe(6);
  });
});

function fakeDownloader(): VanillaDownloader {
  return {
    findCached: async () => null,
    listCached: async () => [],
    downloadLatest: async () => {
      throw new DownloadError('offline in tests', 'network');
    },
    fetchObject: async () => {
      throw new Error('no network in tests');
    },
    fetchSoundObjects: async (_install: unknown, ids: readonly string[]) => ({ fetched: 0, missing: [...ids] }),
  } as unknown as VanillaDownloader;
}

describe('T-FNT-3 主进程读出 unihex 字形表', () => {
  it('从资源包里的 zip 解出全部 .hex，按 stamp 缓存', async () => {
    const log = createLogger(null, false);
    const userData = join(dir, 'userData');
    const settings = new SettingsStore(join(userData, 'settings.json'), log);
    await settings.load();
    const svc = new ResourceService({
      userDataDir: userData,
      builtinDir: join(dir, 'no-builtin'),
      settings,
      log,
      gameEnv: { platform: 'win32', appData: join(dir, 'appdata'), home: join(dir, 'appdata') },
      downloader: fakeDownloader(),
      onChanged: () => undefined,
    });
    await svc.init();
    const pack = join(dir, 'pack');
    writeFiles(pack, {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 46, description: 'fonts' } }),
      'assets/minecraft/font/default.json': JSON.stringify({ providers: [{ type: 'unihex', hex_file: 'minecraft:font/unifont.zip', size_overrides: [] }] }),
      'assets/minecraft/font/unifont.zip': buildZip([
        { name: 'readme.txt', data: 'ignored' },
        { name: 'a.hex', data: `${HEX_A}\n`, method: 'deflate' },
        { name: 'b.hex', data: `${HEX_WIDE}\n0041:${'FF'.repeat(16)}\n` },
      ]),
    });
    await svc.addPackFromPath(pack);
    const def = await svc.fontProviders('minecraft:default');
    expect(def?.providers).toEqual([{ type: 'unihex', file: 'assets/minecraft/font/unifont.zip', overrides: [] }]);
    const t = await svc.unihexTables('assets/minecraft/font/unifont.zip', []);
    expect(Array.from(t?.codepoints ?? [])).toEqual([0x41, 0x4e2d]);
    // 先出现的 a.hex 里的 A 胜出（宽 6）
    expect(t?.metrics[1]).toBe(6);
    expect(await svc.unihexTables('assets/minecraft/font/none.zip', [])).toBeNull();
    svc.close();
  });

  it('条目名不安全的 zip 整个拒绝', async () => {
    await expect(readHexEntries(buildZip([{ name: '../evil.hex', data: HEX_A }]))).rejects.toThrow();
    await expect(readHexEntries(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('T-FNT-4 用户导入的字体', () => {
  const TTF_HEAD = new Uint8Array([0, 1, 0, 0, 0, 10, 0, 0]);

  it('按文件头认格式', () => {
    expect(sniffFontFormat(TTF_HEAD, '.ttf')).toBe('ttf');
    expect(sniffFontFormat(new TextEncoder().encode('OTTO'), '.otf')).toBe('otf');
    expect(sniffFontFormat(new TextEncoder().encode('wOFF'), '.woff')).toBe('woff');
    expect(sniffFontFormat(new TextEncoder().encode('wOF2'), '.woff2')).toBe('woff2');
    expect(sniffFontFormat(new TextEncoder().encode('STAR'), '.bdf')).toBe('bdf');
    expect(sniffFontFormat(new TextEncoder().encode('PK\u0003\u0004'), '.ttf')).toBeNull();
  });

  it('复制进 fonts/，ID 是内容哈希；同一文件导入两次只有一条；删除后读不到', async () => {
    const userData = join(dir, 'userData');
    const store = new UserFontStore(userData);
    const src = join(dir, 'My Font.ttf');
    writeFileSync(src, Buffer.concat([Buffer.from(TTF_HEAD), Buffer.alloc(64, 7)]));
    const a = await store.importFile(src);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.font.id).toMatch(/^user:[0-9a-f]{32}$/);
    expect(a.font).toMatchObject({ name: 'My Font.ttf', format: 'ttf' });
    const again = await store.importFile(src);
    expect(again.ok && again.font.id).toBe(a.font.id);
    expect(await store.list()).toHaveLength(1);
    // 应用数据目录里只有字体文件和索引，没有临时文件
    expect(readdirSync(join(userData, 'fonts')).sort()).toEqual([`${a.font.id.slice(5)}.ttf`, 'index.json']);
    // 重新打开（新实例）也能读到
    const reopened = new UserFontStore(userData);
    const data = await reopened.read(a.font.id);
    expect(data?.kind).toBe('vector');
    await reopened.remove(a.font.id);
    expect(await reopened.read(a.font.id)).toBeNull();
    expect(await reopened.list()).toEqual([]);
  });

  it('不认识的文件、扩展名不在白名单的被拒绝；格式不对的 ID 读不到', async () => {
    const store = new UserFontStore(join(dir, 'userData'));
    const fake = join(dir, 'fake.ttf');
    writeFileSync(fake, 'not a font at all');
    expect(await store.importFile(fake)).toEqual({ ok: false, error: 'unsupported' });
    const exe = join(dir, 'x.exe');
    writeFileSync(exe, Buffer.from(TTF_HEAD));
    expect(await store.importFile(exe)).toEqual({ ok: false, error: 'unsupported' });
    expect(await store.importFile(join(dir, 'missing.ttf'))).toEqual({ ok: false, error: 'unreadable' });
    expect(await store.read('user:../../etc/passwd')).toBeNull();
    expect(await store.read('minecraft:default')).toBeNull();
  });
});
