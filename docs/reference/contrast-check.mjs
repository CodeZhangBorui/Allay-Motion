// 复核 docs/06-ui-design.md 6.2 的对比度表。改了任何色值之后运行：node docs/reference/contrast-check.mjs
const themes = {
  dark: {
    background: '#0D0D0E', 'surface-1': '#1A1A1B', 'surface-2': '#202021', well: '#131314', control: '#28282A', 'control-hi': '#333336', viewer: '#121213',
    foreground: '#F0F0F1', 'fg-muted': '#A2A2A6', 'fg-subtle': '#8B8B91', 'fg-faint': '#6D6D72',
    primary: '#3CB7F4', 'primary-hover': '#5CC4F6', 'primary-press': '#34A5DD', 'primary-foreground': '#04212F', 'primary-text': '#3CB7F4', ring: '#3CB7F4',
    mark: '#F2A93B', 'stage-enter': '#2B6C9B', 'stage-hold': '#47474B', 'stage-exit': '#6652A6', 'stage-foreground': '#F0F0F1', cue: '#49B382',
    success: '#4CC38A', warning: '#E8C547', danger: '#F26B6B', amethyst: '#9B85E8',
  },
  light: {
    background: '#DCDCDF', 'surface-1': '#F2F2F3', 'surface-2': '#F8F8F9', well: '#E7E7E9', control: '#E3E3E6', 'control-hi': '#D6D6DA', viewer: '#E9E9EB',
    foreground: '#1B1B1D', 'fg-muted': '#46464C', 'fg-subtle': '#5C5C62', 'fg-faint': '#7B7B81',
    primary: '#0B6AA6', 'primary-hover': '#0A5F95', 'primary-press': '#095788', 'primary-foreground': '#FFFFFF', 'primary-text': '#095C90', ring: '#0B6AA6',
    mark: '#9A5800', 'stage-enter': '#2B6C9B', 'stage-hold': '#6B6B70', 'stage-exit': '#6652A6', 'stage-foreground': '#FFFFFF', cue: '#278556',
    success: '#1D7A4E', warning: '#806200', danger: '#C2362F', amethyst: '#6F55C8',
  },
};

// [前景, 背景, 最低要求]。3.0 用于非文字的界面元素（图标、焦点环、标记），4.5 用于文字。
// 文字可能出现在：底色（顶栏、状态栏）、面板、次级面（弹层）、控件、控件高亮（选中的分段）、预览面板。
// fg-faint 只给图标和装饰，不做文字。
const pairs = [
  ['foreground', 'background', 4.5], ['foreground', 'surface-1', 4.5], ['foreground', 'surface-2', 4.5], ['foreground', 'control', 4.5], ['foreground', 'control-hi', 4.5],
  ['fg-muted', 'background', 4.5], ['fg-muted', 'surface-1', 4.5], ['fg-muted', 'surface-2', 4.5], ['fg-muted', 'control', 4.5], ['fg-muted', 'well', 4.5],
  ['fg-subtle', 'background', 4.5], ['fg-subtle', 'surface-1', 4.5], ['fg-subtle', 'surface-2', 4.5], ['fg-subtle', 'viewer', 4.5], ['fg-subtle', 'well', 4.5],
  ['fg-faint', 'surface-1', 3.0], ['fg-faint', 'background', 3.0],
  ['primary-foreground', 'primary', 4.5], ['primary-foreground', 'primary-hover', 4.5], ['primary-foreground', 'primary-press', 4.5],
  ['primary-text', 'surface-1', 4.5], ['primary-text', 'background', 4.5],
  ['ring', 'surface-1', 3.0], ['ring', 'background', 3.0], ['ring', 'surface-2', 3.0],
  ['mark', 'surface-1', 3.0], ['mark', 'well', 4.5],
  ['stage-foreground', 'stage-enter', 4.5], ['stage-foreground', 'stage-hold', 4.5], ['stage-foreground', 'stage-exit', 4.5],
  ['cue', 'well', 3.0],
  ['success', 'surface-1', 4.5], ['warning', 'surface-1', 4.5], ['danger', 'surface-1', 4.5], ['danger', 'surface-2', 4.5], ['amethyst', 'surface-1', 4.5],
];

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n== ${name} ==`);
  for (const [fg, bg, min] of pairs) {
    const c = contrast(t[fg], t[bg]);
    // 允许 0.02 的取整误差
    const ok = c + 0.02 >= min;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${`${fg} / ${bg}`.padEnd(38)} ${c.toFixed(2).padStart(6)}  (>= ${min})`);
  }
}
if (failed) { console.error(`\n${failed} 项不达标`); process.exit(1); }
console.log('\n全部达标');
