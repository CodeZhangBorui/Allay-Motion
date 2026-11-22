// T-GAL-8：模板条目的内容哈希（TemplateEntry.contentHash；docs/decisions.md“模板库撑到一百个模板”）。
// 模板库的封面缓存键里有它：id 和版本不变、内容变了（应用更新了内置模板、开发模式里改了用户模板、派生模板的基模板变了）时它会变。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashTemplateDir, hashTemplateFiles } from '../../apps/desktop/src/main/templates/dev-watcher';
import type { TemplateService } from '../../apps/desktop/src/main/templates/service';
import { CONTENT_HASH_RE } from '../../apps/desktop/src/shared/templates';
import { BASE_CODE, basePackage, buildBuiltins, derivedPackage, makeService, writePackage } from './helpers/template-fixtures';

let root: string;
let svc: TemplateService;

async function install(file: string, pkg: Record<string, Uint8Array | string>): Promise<void> {
  const r = await svc.stage(writePackage(join(root, 'in', file), pkg));
  if (!('ok' in r) || !r.ok) throw new Error(JSON.stringify(r));
  const c = await svc.commit(r.stagingId, { warnings: [] });
  if (!c.ok) throw new Error(JSON.stringify(c));
}

const hashOf = (id: string) => svc.list().find((e) => e.id === id)!.contentHash;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'allay-gal8-'));
  await buildBuiltins(join(root, 'builtin'));
  svc = await makeService(join(root, 'user'), join(root, 'builtin'));
  await install('base.allaytpl', basePackage());
  await install('derived.allaytpl', derivedPackage());
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('T-GAL-8 模板条目的内容哈希', () => {
  it('每个条目都有，是 16 位十六进制；重启后不变', async () => {
    const entries = svc.list();
    expect(entries.length).toBeGreaterThan(3);
    for (const e of entries) expect(e.contentHash, e.id).toMatch(CONTENT_HASH_RE);
    const again = await makeService(join(root, 'user'), join(root, 'builtin'));
    expect(again.list().map((e) => [e.id, e.contentHash])).toEqual(entries.map((e) => [e.id, e.contentHash]));
  });

  it('同样的文件放在包里和放在文件夹里，哈希一样（内置模板和用户模板同一种算法）', async () => {
    const dir = svc.userTemplateDir('user.test.base', '1.2.0')!;
    const pkg = basePackage();
    const files = Object.entries(pkg).map(([p, d]) => [p, typeof d === 'string' ? new TextEncoder().encode(d) : d] as const);
    expect(hashTemplateFiles(files)).toBe(await hashTemplateDir(dir));
    expect(hashOf('user.test.base')).toBe((await hashTemplateDir(dir))!.slice(0, 16));
    // 包里别的文件（说明文档之类）不算模板内容
    expect(hashTemplateFiles([...files, ['README.md', new Uint8Array([1])] as const])).toBe(hashTemplateFiles(files));
  });

  it('派生模板的哈希把基模板的也算进去：基模板换了内容（版本不变），派生模板的也变', async () => {
    const derived = hashOf('user.test.derived');
    expect(derived).not.toBe((await hashTemplateDir(svc.userTemplateDir('user.test.derived', '1.0.0')!))!.slice(0, 16));
    const base = hashOf('user.test.base');
    await install('base2.allaytpl', basePackage({}, { 'template.js': `${BASE_CODE}\n// changed\n` }));
    expect(hashOf('user.test.base')).not.toBe(base);
    expect(hashOf('user.test.derived')).not.toBe(derived);
  });

  it('开发模式里在外面改了文件：刷新后哈希跟着变', async () => {
    const before = hashOf('user.test.base');
    writeFileSync(join(svc.userTemplateDir('user.test.base', '1.2.0')!, 'template.js'), `${BASE_CODE}\n// edited outside\n`);
    const entry = await svc.refreshUser('user.test.base', '1.2.0');
    expect(entry?.contentHash).toMatch(CONTENT_HASH_RE);
    expect(entry?.contentHash).not.toBe(before);
  });
});
