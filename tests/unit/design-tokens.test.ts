import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_CHROME_COLORS } from '../../apps/desktop/src/shared/theme-colors';

// 6.2 的设计变量原样写进了 packages/ui 的 globals.css；主进程用到的几个颜色和它一致。

const ROOT = resolve(import.meta.dirname, '../..');
const css = readFileSync(resolve(ROOT, 'packages/ui/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n');
const spec = readFileSync(resolve(ROOT, 'docs/06-ui-design.md'), 'utf8').replace(/\r\n/g, '\n');

function block(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim().toUpperCase();
  return vars;
}

describe('6.2 设计变量', () => {
  const specDark = block(spec, ":root, [data-theme='dark'] {");
  const specLight = block(spec, "[data-theme='light'] {");
  const cssDark = block(css, ":root,\n[data-theme='dark'] {");
  const cssLight = block(css, "[data-theme='light'] {");

  it('规格里的变量完整解析出来了', () => {
    expect(Object.keys(specDark).length).toBe(33);
    expect(Object.keys(specLight).length).toBe(33);
    expect(Object.keys(specLight).sort()).toEqual(Object.keys(specDark).sort());
  });
  it('深色主题与规格逐项一致', () => {
    for (const [k, v] of Object.entries(specDark)) expect(cssDark[k], k).toBe(v);
  });
  it('浅色主题与规格逐项一致', () => {
    for (const [k, v] of Object.entries(specLight)) expect(cssLight[k], k).toBe(v);
  });
  it('动效变量', () => {
    for (const v of [
      '--dur-1: 60ms',
      '--dur-2: 120ms',
      '--dur-3: 120ms',
      '--dur-4: 400ms',
      '--ease-step: steps(3, end)',
      '--ease-out: cubic-bezier(.2, .8, .2, 1)',
      '--ease-in-out: cubic-bezier(.45, .05, .2, 1)',
    ]) {
      expect(css).toContain(v);
    }
  });
  it('shadcn 变量的映射', () => {
    for (const v of [
      '--card: var(--surface-1)',
      '--popover: var(--surface-1)',
      '--muted: var(--surface-2)',
      '--muted-foreground: var(--fg-muted)',
      '--secondary: var(--surface-2)',
      '--accent: var(--surface-3)',
      '--destructive: var(--danger)',
      '--input: var(--input-border)',
    ]) {
      expect(css).toContain(v);
    }
  });
  it('主进程的窗口颜色与设计变量一致', () => {
    expect(THEME_CHROME_COLORS.dark).toEqual({
      background: specDark['--background'],
      titleBar: specDark['--surface-1'],
      titleBarSymbol: specDark['--foreground'],
    });
    expect(THEME_CHROME_COLORS.light).toEqual({
      background: specLight['--background'],
      titleBar: specLight['--surface-1'],
      titleBarSymbol: specLight['--foreground'],
    });
  });
  it('“方块工作台”：圆角全为 0，没有模糊、渐变和柔光', () => {
    for (const m of css.matchAll(/--radius-[\w-]+:\s*([^;]+);/g)) expect(m[1]!.trim()).toBe('0px');
    expect(css).toContain('border-radius: 0 !important');
    expect(css).toContain('backdrop-filter: none !important');
    // 所有 box-shadow 都是零模糊的硬边：形如 x y 0 0 颜色
    for (const m of css.matchAll(/(?:^|[;{\s])box-shadow:([^;]+);/g)) {
      for (const part of m[1]!.split(/,(?![^(]*\))/)) {
        const t = part.trim().replace(/^inset\s+/, '');
        if (t.startsWith('var(')) continue;
        // 第三个长度（模糊半径）必须是 0；扩展半径可以有
        expect(t, part).toMatch(/^-?\d+(px)? -?\d+(px)? 0( -?\d+(px)?)? /);
      }
    }
    expect(css).not.toMatch(/(linear|radial)-gradient/);
    expect(css).not.toMatch(/blur\(/);
  });
  it('像素字只用 12、24 两个名义字号，字体文件随包', () => {
    expect(css).toContain('--px-12: 12px');
    expect(css).toContain('--px-24: 24px');
    expect(css).toContain('ark-pixel-12px-proportional-zh_hans.otf.woff2');
    expect(css).not.toMatch(/url\(["']?data:/);
  });
});
