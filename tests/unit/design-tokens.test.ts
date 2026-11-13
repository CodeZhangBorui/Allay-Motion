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
    expect(Object.keys(specDark).length).toBe(25);
    expect(Object.keys(specLight).length).toBe(25);
  });
  it('深色主题与规格逐项一致', () => {
    for (const [k, v] of Object.entries(specDark)) expect(cssDark[k], k).toBe(v);
  });
  it('浅色主题与规格逐项一致', () => {
    for (const [k, v] of Object.entries(specLight)) expect(cssLight[k], k).toBe(v);
  });
  it('动效变量', () => {
    for (const v of [
      '--dur-1: 90ms',
      '--dur-2: 160ms',
      '--dur-3: 240ms',
      '--dur-4: 400ms',
      '--ease-out: cubic-bezier(.2, .8, .2, 1)',
      '--ease-in-out: cubic-bezier(.45, .05, .2, 1)',
    ]) {
      expect(css).toContain(v);
    }
  });
  it('shadcn 变量的映射', () => {
    for (const v of [
      '--card: var(--surface-1)',
      '--popover: var(--surface-2)',
      '--muted: var(--surface-2)',
      '--muted-foreground: var(--fg-muted)',
      '--secondary: var(--surface-3)',
      '--accent: var(--surface-3)',
      '--destructive: var(--danger)',
      '--input: var(--border-strong)',
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
});
