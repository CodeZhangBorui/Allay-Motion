// 复核 docs/06-ui-design.md 6.2 的对比度表。改了任何色值之后运行：node docs/reference/contrast-check.mjs
const themes = {
  dark: {
    background: '#19181C', 'surface-1': '#242328', 'surface-2': '#33323A', 'surface-3': '#3D3C45', well: '#121115',
    border: '#4A4852', 'input-border': '#737080',
    foreground: '#ECE7DF', 'fg-muted': '#AFA9A1', 'fg-subtle': '#7E7972',
    primary: '#43D3EA', 'primary-hover': '#6ADDEF', 'primary-active': '#2FBFD6', 'primary-foreground': '#141216',
    'primary-text': '#43D3EA', ring: '#43D3EA', success: '#2FB36B', warning: '#E3A22C', danger: '#EC6146', amethyst: '#9B6FE0',
  },
  light: {
    background: '#E9E3D8', 'surface-1': '#F4EFE6', 'surface-2': '#FBF6EC', 'surface-3': '#F0E9DD', well: '#DAD3C6',
    border: '#A39B8E', 'input-border': '#857D71',
    foreground: '#27231F', 'fg-muted': '#5E574F', 'fg-subtle': '#776F65',
    primary: '#43D3EA', 'primary-hover': '#6ADDEF', 'primary-active': '#2FBFD6', 'primary-foreground': '#141216',
    'primary-text': '#08627A', ring: '#0E7F99', success: '#1B7843', warning: '#94600F', danger: '#B8321F', amethyst: '#7A4FC4',
  },
};

// [前景, 背景, 最低要求]。3.0 用于非文字的界面元素和瞬时状态，4.5 用于正文。
// 文字可能出现在面板（surface-1）、凸起面（surface-2、悬停时 surface-3）、凹槽（well）和窗口底色上。
const pairs = [
  ['foreground', 'surface-1', 4.5], ['foreground', 'background', 4.5], ['foreground', 'surface-2', 4.5], ['foreground', 'surface-3', 4.5], ['foreground', 'well', 4.5],
  ['fg-muted', 'surface-1', 4.5], ['fg-muted', 'background', 4.5], ['fg-muted', 'surface-2', 4.5], ['fg-muted', 'well', 4.5],
  ['fg-muted', 'surface-3', 3.0],
  ['fg-subtle', 'surface-1', 3.0], ['fg-subtle', 'well', 3.0],
  ['primary-foreground', 'primary', 4.5], ['primary-foreground', 'primary-hover', 4.5], ['primary-foreground', 'primary-active', 4.5],
  ['primary-text', 'surface-1', 4.5], ['primary-text', 'background', 4.5], ['primary-text', 'surface-2', 4.5], ['primary-text', 'well', 4.5],
  ['ring', 'surface-1', 3.0], ['ring', 'background', 3.0], ['ring', 'well', 3.0], ['ring', 'surface-2', 3.0],
  ['input-border', 'surface-1', 3.0], ['input-border', 'background', 3.0],
  ['success', 'surface-1', 4.5], ['warning', 'surface-1', 4.5], ['danger', 'surface-1', 4.5], ['danger', 'background', 4.5],
  ['amethyst', 'surface-1', 3.0],
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
