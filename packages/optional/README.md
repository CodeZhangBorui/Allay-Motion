# 可选模块

这里放可以整块拆除的可选模块（docs/code-editing-and-mcp-plan.md 第 3 节）：将来的内嵌代码编辑器（`code-editor/`）和 MCP（`mcp/`）。**现在这里没有任何模块**，这是有意的：P1 内嵌编辑器和 MCP 都还没决定做（H-CODE-EDITOR、H-MCP）。

约定：

- 每个模块一个目录 `packages/optional/<名字>/`，自己的 `package.json`（包名 `@allay/optional-<名字>`）、测试、文案、依赖都在里面。
- 入口 `src/index.ts` 只导出 `activate(host: EditorHost): Disposable`（类型在 `@allay/host-api`）。
- **依赖方向**（`eslint.config.js` 强制，T-DEV-4 有故意违规的夹具）：
  - 主程序的任何包、应用、脚本、测试都不得引用 `packages/optional/**`（包名或相对路径都不行）；
  - 可选模块只能引用 `@allay/host-api`，不能引用主程序的其他包，也不能用相对路径够到它们。
- 主程序用按目录的惰性发现加载模块（`import.meta.glob`，MD-b 接线）：目录不存在就是空表。删掉一个模块的目录、刷新 lockfile 即可拆除，主程序不需要改。
- 这个目录为空或整个被删掉时，`pnpm install`、`pnpm check` 照常通过。
