# 内置模板共用的源码

这里不是模板（没有 `manifest.json`，`pnpm templates:build` 跳过 `_` 开头的目录）。内置模板用相对路径导入这里的文件：

```ts
import { transitionWindows } from '../../_lib/src/timing';
```

esbuild 把用到的函数打进那个模板的单文件产物，产物里仍然没有任何 import（`docs/04-templates.md` 4.9）。

规矩：

- 只放至少两个模板确实用得上的东西，不预先堆。
- 和模板一样，只能从 `@allay/template-sdk` 做类型导入；`THREE` 只从调用方传进来的 `ctx` 里拿（`ctx.THREE`）。
- 不读真实时间、不用 `Math.random`、不留跨帧状态（硬性规则 2）。除了 `gui-kit` 里建场景对象的几个函数（`createGui`、`quads`、`richText`：在 `setup` 里用，`update(t)` 里只按 `t` 改它们给的句柄），都是纯函数。
- 改这里会改变所有用到它的模板的产物。改之前想清楚要不要重新生成那些模板的基准图。
- 每个函数在 `tests/unit/T-TPL-LIB.template-lib.test.ts` 里有测试。

| 文件 | 内容 |
|---|---|
| `src/timing.ts` | 时间余量：转场和叠加层各阶段的起止时刻、阶段进度（`docs/template-authoring.md` 第 5 节） |
| `src/gui.ts` | 界面像素布局：界面像素和设计单位之间的换算、九个停靠位置 |
| `src/particles.ts` | 闭式粒子：按出生时刻和寿命算年龄，带重力和阻力的位移 |
| `src/gui-kit.ts` | 界面类模板的小工具：参数读取、按“新路径 → 旧路径”试可选贴图、界面坐标系里摆对象和文字、成批的矩形（纯色或贴图的一块，一次绘制）、带 § 或 & 格式码的一行多色文字（`docs/templates/batch-1.md`） |
| `src/fade.ts` | 整体淡入淡出：进入阶段从 0 升到 1、退出阶段降回 0 的不透明度 |
| `src/bar.ts` | 进度条：进度贴图按像素裁切时露出几个像素（两种取整）、界面宽度放不下一条栏时整体缩小 |
| `src/cues.ts` | 音效：同一种声音最多 12 个 cue，多了按时刻均匀抽样 |
