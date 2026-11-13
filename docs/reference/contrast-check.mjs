// 复核 docs/06-ui-design.md 6.2 的对比度表。改了任何色值之后运行：node docs/reference/contrast-check.mjs
const themes = {
  dark: {
    background: '#0B0F13', 'surface-1': '#14171D', 'surface-2': '#1C2127', 'surface-3': '#252B32',
    border: '#2D333B', 'border-strong': '#474E57', 'input-border': '#5C646E',
    foreground: '#F2F4F6', 'fg-muted': '#9EA5AE', 'fg-subtle': '#7A8189',
    primary: '#2072D5', 'primary-hover': '#2E80E0', 'primary-active': '#1665C8', 'primary-foreground': '#FAFCFE',
    'primary-text': '#60AAF3', ring: '#52CFF3', success: '#52CD7D', warning: '#F8BD40', danger: '#F4514F', amethyst: '#B98CEA',
  },
  light: {
    background: '#F5F7F9', 'surface-1': '#FFFFFF', 'surface-2': '#EDF0F4', 'surface-3': '#E3E7EC',
    border: '#DADEE3', 'border-strong': '#B9BEC6', 'input-border': '#81878F',
    foreground: '#141B24', 'fg-muted': '#565E69', 'fg-subtle': '#737B85',
    primary: '#0D6AD7', 'primary-hover': '#085DC7', 'primary-active': '#0052B4', 'primary-foreground': '#FAFCFE',
    'primary-text': '#0D6AD7', ring: '#257DA9', success: '#078543', warning: '#A2650A', danger: '#D4212D', amethyst: '#925AC9',
  },
};

// [前景, 背景, 最低要求]。3.0 用于非文字的界面元素和瞬时状态，4.5 用于正文。
const pairs = [
  ['foreground', 'surface-1', 4.5], ['foreground', 'background', 4.5], ['foreground', 'surface-2', 4.5],
  ['fg-muted', 'surface-1', 4.5], ['fg-muted', 'background', 4.5], ['fg-muted', 'surface-2', 4.5],
  ['fg-subtle', 'surface-1', 3.0],
  ['primary-foreground', 'primary', 4.5], ['primary-foreground', 'primary-hover', 3.0], ['primary-foreground', 'primary-active', 4.5],
  ['primary-text', 'surface-1', 4.5], ['primary-text', 'background', 4.5],
  ['ring', 'surface-1', 3.0], ['ring', 'background', 3.0],
  ['input-border', 'surface-1', 3.0],
  ['success', 'surface-1', 4.5], ['warning', 'surface-1', 4.5], ['danger', 'surface-1', 4.5], ['amethyst', 'surface-1', 4.5],
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
