# 内置模板共用的源码

这里不是模板（没有 `manifest.json`，`pnpm templates:build` 跳过 `_` 开头的目录）。内置模板用相对路径导入这里的文件：

```ts
import { transitionWindows } from '../../_lib/src/timing';
```

esbuild 把用到的函数打进那个模板的单文件产物，产物里仍然没有任何 import（`docs/04-templates.md` 4.9）。

规矩：

- 只放至少两个模板确实用得上的东西，不预先堆。
- 和模板一样，只能从 `@allay/template-sdk` 做类型导入；`THREE` 由调用方从 `ctx.THREE` 传进来。
- 都是纯函数：不读真实时间、不用 `Math.random`、不留跨帧状态（硬性规则 2）。
- 改这里会改变所有用到它的模板的产物。改之前想清楚要不要重新生成那些模板的基准图。
- 每个函数在 `tests/unit/T-TPL-LIB.template-lib.test.ts` 里有测试。

| 文件 | 内容 |
|---|---|
| `src/timing.ts` | 时间余量：转场和叠加层各阶段的起止时刻、阶段进度（`docs/template-authoring.md` 第 5 节） |
| `src/gui.ts` | 界面像素布局：界面像素和设计单位之间的换算、九个停靠位置 |
| `src/particles.ts` | 闭式粒子：按出生时刻和寿命算年龄，带重力和阻力的位移 |
