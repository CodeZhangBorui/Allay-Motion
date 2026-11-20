# 可选模块

这里放可以整块拆除的可选模块（docs/code-editing-and-mcp-plan.md 第 3 节）。

| 目录 | 内容 | 状态 |
|---|---|---|
| `code-editor/` | 应用内的模板代码编辑器（CodeMirror 6）：“模板代码”停靠面板、动画代码视图 | 2026-11 起有（H-CODE-EDITOR 用户要求做），随开发模式启用 |
| `mcp/` | MCP | 没有：H-MCP 未批准，不写任何代码 |

约定：

- 每个模块一个目录 `packages/optional/<名字>/`，自己的 `package.json`（包名 `@allay/optional-<名字>`）、测试、文案、依赖都在里面。
- 入口 `src/index.ts` 只导出 `activate(host: EditorHost): Disposable`（类型在 `@allay/host-api`）。
- **依赖方向**（`eslint.config.js` 强制，T-DEV-4 有故意违规的夹具）：
  - 主程序的任何包、应用、脚本、测试都不得引用 `packages/optional/**`（包名或相对路径都不行）；
  - 可选模块只能引用 `@allay/host-api`，不能引用主程序的其他包，也不能用相对路径够到它们。
- 主程序用按目录的惰性发现加载模块（`import.meta.glob`）：目录不存在就是空表。**模块只在开发模式打开时启用**（设置“开发”页里可以单独关掉）。
- **拆除**：删掉模块的目录、刷新 lockfile（`pnpm install`），主程序不需要改。这个目录为空或整个被删掉时，`pnpm install`、`pnpm check` 照常通过（`pnpm check:removable`）。
