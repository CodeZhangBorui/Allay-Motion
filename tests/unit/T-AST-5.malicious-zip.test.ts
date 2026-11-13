import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importZipPack, openZip, openZipPack, ZipRejectedError } from '../../apps/desktop/src/main/resources';
import { buildZip, packMcmeta, solidPng, tex, writeZip } from './helpers/resource-fixtures';

// T-AST-5：含 ../ 条目的恶意 zip 被拒绝，应用数据目录外没有新文件。

let sandbox: string;
let userData: string;

function listAll(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      out.push(relative(sandbox, p).replace(/\\/g, '/') + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'allay-t-ast-5-'));
  userData = join(sandbox, 'app', 'userData');
  mkdirSync(userData, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const MALICIOUS: [string, string][] = [
  ['../ 穿越', '../evil.txt'],
  ['多级 ../', 'assets/../../../evil.txt'],
  ['绝对路径', '/evil.txt'],
  ['盘符', 'C:/evil.txt'],
  ['反斜杠穿越', '..\\evil.txt'],
];

describe('T-AST-5 恶意 zip', () => {
  it.each(MALICIOUS)('%s（%s）：整个包被拒绝，应用数据目录内外都没有新文件', async (_label, name) => {
    const src = join(sandbox, 'downloads', 'evil.zip');
    writeZip(src, [
      { name: 'pack.mcmeta', data: packMcmeta('evil') },
      { name: tex('stone'), data: solidPng('#ff00ff') },
      { name, data: 'pwned' },
    ]);
    const before = listAll(sandbox);
    await expect(importZipPack(src, userData)).rejects.toBeInstanceOf(ZipRejectedError);
    // 除了 userData/packs/ 这个目录本身，文件树和导入前一模一样
    const strip = (list: string[]) => list.filter((p) => !p.startsWith('app/userData/packs/'));
    expect(strip(listAll(sandbox))).toEqual(strip(before));
    // packs/ 里没有任何文件（临时文件也删了）
    const packs = join(userData, 'packs');
    if (existsSync(packs)) expect(readdirSync(packs)).toEqual([]);
    expect(existsSync(join(sandbox, 'evil.txt'))).toBe(false);
    expect(existsSync(join(sandbox, 'app', 'evil.txt'))).toBe(false);
    // 直接打开也被拒绝
    await expect(openZipPack(src, 'pack:evil')).rejects.toBeInstanceOf(ZipRejectedError);
  });

  it('正常的包：复制到 packs/<sha256>.zip，重复导入不再复制', async () => {
    const src = join(sandbox, 'good.zip');
    writeZip(src, [{ name: 'pack.mcmeta', data: packMcmeta('good') }, { name: tex('stone'), data: solidPng('#ff00ff') }]);
    const first = await importZipPack(src, userData);
    expect(first.file).toMatch(/^[0-9a-f]{64}\.zip$/);
    expect(first.existed).toBe(false);
    expect(statSync(first.path).size).toBe(statSync(src).size);
    const again = await importZipPack(src, userData);
    expect(again.existed).toBe(true);
    expect(readdirSync(join(userData, 'packs'))).toEqual([first.file]);
  });

  it('不是 zip 的文件被拒绝', async () => {
    const src = join(sandbox, 'fake.zip');
    writeFileSync(src, 'definitely not a zip');
    await expect(importZipPack(src, userData)).rejects.toBeInstanceOf(ZipRejectedError);
    expect(readdirSync(join(userData, 'packs'))).toEqual([]);
  });

  it('解压炸弹：声明超过 64 MB 的条目跳过并报告，其余照常', async () => {
    const big = new Uint8Array(64 * 1024 * 1024 + 1);
    const src = join(sandbox, 'bomb.zip');
    writeFileSync(src, buildZip([{ name: tex('stone'), data: solidPng('#00ffff') }, { name: tex('dirt'), data: big, method: 'deflate' }]));
    expect(statSync(src).size).toBeLessThan(1024 * 1024);
    const zip = await openZip(src);
    try {
      expect(zip.has(tex('stone'))).toBe(true);
      expect(zip.has(tex('dirt'))).toBe(false);
      expect(zip.warnings.join('\n')).toContain('dirt.png');
    } finally {
      zip.close();
    }
  });

  it('谎报大小的条目：按实际解压出的字节截断，读取失败而不是撑爆内存', async () => {
    const src = join(sandbox, 'liar.zip');
    writeFileSync(src, buildZip([{ name: tex('dirt'), data: new Uint8Array(4096), method: 'deflate', declaredSize: 10 }]));
    const zip = await openZip(src, { maxEntryBytes: 1024 });
    try {
      expect(zip.has(tex('dirt'))).toBe(true);
      await expect(zip.read(tex('dirt'))).rejects.toThrow();
    } finally {
      zip.close();
    }
  });
});
