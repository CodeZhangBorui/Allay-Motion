import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findViolations, isLicenseAllowed } from '../../scripts/check-licenses';
import { checkFiles, findUnusedEntries, ProvenanceSchema, verifyGenerated, type ProvenanceEntry } from '../../scripts/check-provenance';

describe('check-licenses（9.8）', () => {
  it.each([
    ['MIT', 'x', true],
    ['ISC', 'x', true],
    ['Apache-2.0', 'x', true],
    ['BSD-3-Clause', 'x', true],
    ['0BSD', 'x', true],
    ['Zlib', 'x', true],
    ['CC0-1.0', 'x', true],
    ['(MIT OR Apache-2.0)', 'x', true],
    ['MIT AND ISC', 'x', true],
    ['GPL-3.0-only', 'x', false],
    ['AGPL-3.0', 'x', false],
    ['SSPL-1.0', 'x', false],
    ['LGPL-2.1', 'x', false],
    ['MIT AND GPL-2.0', 'x', false],
    ['(GPL-2.0 OR MIT)', 'x', true],
    ['UNKNOWN', 'x', false],
    ['', 'x', false],
    ['SEE LICENSE IN LICENSE.md', 'x', false],
    ['OFL-1.1', '@fontsource-variable/inter', true],
    ['OFL-1.1', 'some-lib', false],
    ['BUSL-1.1', 'x', false],
  ])('%s（%s）→ %s', (license, name, allowed) => {
    expect(isLicenseAllowed(license, name)).toBe(allowed);
  });

  it('点名禁止 GSAP 和 Theatre.js，不管许可写的是什么', () => {
    const v = findViolations([
      { name: 'gsap', version: '3.0.0', license: 'MIT' },
      { name: '@theatre/studio', version: '0.7.0', license: 'MIT' },
      { name: 'react', version: '19.0.0', license: 'MIT' },
    ]);
    expect(v.map((x) => x.name)).toEqual(['gsap', '@theatre/studio']);
  });
});

describe('check-provenance（9.6）', () => {
  const entries: ProvenanceEntry[] = ProvenanceSchema.parse([
    { path: 'resources/builtin-pack/**', origin: 'generated', generator: 'scripts/gen-builtin-pack.ts', license: '项目自有' },
    { path: 'packages/ui/assets/fonts/Inter*.woff2', origin: 'third-party', source: 'https://github.com/rsms/inter', author: 'Rasmus Andersson', license: 'OFL-1.1' },
    { path: 'docs/review/**/*.png', origin: 'original', author: 'project', license: '项目自有' },
  ]);

  it('登记过的文件通过；非二进制文件不需要登记', () => {
    expect(
      checkFiles(
        [
          'resources/builtin-pack/assets/minecraft/textures/block/stone.png',
          'packages/ui/assets/fonts/InterVariable.woff2',
          'docs/review/M0/dark.png',
          'src/index.ts',
          'README.md',
        ],
        entries,
      ),
    ).toEqual([]);
  });

  it('没登记的图片、音频、字体、压缩包都失败', () => {
    const problems = checkFiles(['a/logo.png', 'b/click.ogg', 'c/font.ttf', 'd/pack.zip', 'e/x.WEBP'], entries);
    expect(problems.map((p) => p.path)).toEqual(['a/logo.png', 'b/click.ogg', 'c/font.ttf', 'd/pack.zip', 'e/x.WEBP']);
  });

  it('拒绝 .jar，即使有登记', () => {
    const e = ProvenanceSchema.parse([{ path: '**', origin: 'original', author: 'x', license: 'x' }]);
    expect(checkFiles(['libs/client.jar'], e)).toHaveLength(1);
  });

  it('assets/minecraft/ 只能在内置包或夹具目录下', () => {
    const e = ProvenanceSchema.parse([{ path: '**', origin: 'original', author: 'x', license: 'x' }]);
    expect(checkFiles(['packages/x/assets/minecraft/textures/block/dirt.png'], e)).toHaveLength(1);
    expect(checkFiles(['packages/x/assets/minecraft/lang/en_us.json'], e)).toHaveLength(1);
    expect(checkFiles(['tests/fixtures/fake-pack/assets/minecraft/textures/block/dirt.png'], e)).toEqual([]);
  });

  it('内置包里的文件必须是生成的', () => {
    const e = ProvenanceSchema.parse([{ path: 'resources/builtin-pack/**', origin: 'original', author: 'x', license: 'x' }]);
    expect(checkFiles(['resources/builtin-pack/assets/minecraft/textures/block/dirt.png'], e)).toHaveLength(1);
  });

  it('rendered（渲染基准图）只能覆盖测试夹具目录，生成命令必须是 pnpm 脚本（docs/decisions.md M3）', () => {
    const e = ProvenanceSchema.parse([{ path: '**/*.png', origin: 'rendered', generator: 'pnpm templates:baselines', license: 'x' }]);
    expect(checkFiles(['tests/fixtures/baselines/t/16x9-p0.png'], e)).toEqual([]);
    expect(checkFiles(['docs/review/M3/x.png'], e)).toHaveLength(1);
    expect(ProvenanceSchema.safeParse([{ path: 'x', origin: 'rendered', generator: 'node evil.js', license: 'x' }]).success).toBe(false);
  });

  it('vanilla-derived（悦灵的烘焙产物）只能在 packages/mascot/generated/ 下，要写明游戏版本和批准日期（docs/decisions.md M8）', () => {
    const base = { origin: 'vanilla-derived', generator: 'pnpm mascot:bake', source: 'allay.png', gameVersion: '1.21.1', approvedBy: 'u', approvedOn: '2026-11-13', license: 'x' };
    const e = ProvenanceSchema.parse([{ path: '**/*.png', ...base }]);
    expect(checkFiles(['packages/mascot/generated/allay-288.png'], e)).toEqual([]);
    expect(checkFiles(['docs/review/M5a/allay.png'], e)).toHaveLength(1);
    expect(checkFiles(['resources/builtin-pack/assets/minecraft/textures/entity/allay/allay.png'], e)).toHaveLength(1);
    expect(ProvenanceSchema.safeParse([{ path: 'x', ...base, approvedOn: 'yesterday' }]).success).toBe(false);
    expect(ProvenanceSchema.safeParse([{ path: 'x', ...base, gameVersion: undefined }]).success).toBe(false);
  });

  it('不覆盖任何文件的记录被报出来', () => {
    expect(findUnusedEntries(['docs/review/M0/dark.png'], entries).map((e) => e.path)).toEqual([
      'resources/builtin-pack/**',
      'packages/ui/assets/fonts/Inter*.woff2',
    ]);
  });

  it('记录格式不对时拒绝', () => {
    expect(ProvenanceSchema.safeParse([{ path: 'x', origin: 'third-party', license: 'MIT' }]).success).toBe(false);
    expect(ProvenanceSchema.safeParse([{ path: 'x', origin: 'downloaded', license: 'MIT' }]).success).toBe(false);
  });

  describe('重新生成后逐字节比对', () => {
    let root: string;
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    function write(base: string, rel: string, data: string): void {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      writeFileSync(join(base, rel), data);
    }

    it('与生成器产物相同：通过；被替换成别的内容：失败；生成器没产出：失败', () => {
      root = mkdtempSync(join(tmpdir(), 'allay-prov-'));
      const files = [
        'resources/builtin-pack/assets/minecraft/textures/block/stone.png',
        'resources/builtin-pack/assets/minecraft/textures/block/dirt.png',
        'resources/builtin-pack/assets/minecraft/textures/block/sand.png',
      ];
      write(root, files[0]!, 'generated-stone');
      write(root, files[1]!, 'copied-from-the-game');
      write(root, files[2]!, 'stray');
      const problems = verifyGenerated(root, files, entries, (_generator, out) => {
        write(out, files[0]!, 'generated-stone');
        write(out, files[1]!, 'generated-dirt');
      });
      expect(problems.map((p) => p.path)).toEqual([files[1], files[2]]);
    });
  });
});
