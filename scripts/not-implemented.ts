// 1.10 表里此时还没有内容的命令：明确说明尚未实现，以成功退出，不假装做了什么。
const [command = '(unknown)', milestone = '后续里程碑'] = process.argv.slice(2);
console.log(`[${command}] 尚未实现于 M0：将在 ${milestone} 实现（见 docs/08-milestones.md）。本次没有执行任何检查或生成。`);
