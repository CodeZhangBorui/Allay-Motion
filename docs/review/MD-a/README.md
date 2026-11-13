# MD-a 评审说明

**做了什么**（细节见 `docs/decisions.md` 的“MD-a”）

- 结构化诊断（H5）：`TemplateDiagnostic`（template-sdk 的 protocol.ts）；引擎的装载、setup、update 失败带诊断，位置从 Blob 模块的栈帧取；宿主装载前用 acorn 预检语法（带位置）；看门狗、开发构建的拦截、新的 `checkDeterminism` 双渲自检各有自己的 kind。错误的 name、message 保持原样。
- 确定性静态规则（H12）：`analyzeTemplateCode`，并入安装校验的 `nondeterministic` 警告；内置模板构建时也查。
- `pnpm templates:api`（H8）：自包含的 `template-api.d.ts`、`template-api.json`、`docs/template-authoring.md`。
- 主进程（H10）：用户模板目录的监视（防抖、内容哈希、忽略临时文件、自己写入不报）、复制内置模板、写类型定义和 jsconfig、打开文件夹；IPC、preload、测试钩子。
- `packages/host-api`（只有类型）、`packages/optional/`（空）、两条依赖方向规则和违规夹具；`import.meta.glob` 实验。

**和方案不同的地方**：引擎多了 `checkDeterminism`；d.ts 里的 `ctx.THREE` 是手写的最小类型面（与真实 three 的兼容由测试核对）；`runtime.ts` 缺的成员说明放在生成脚本旁（本任务不能改 runtime.ts）；静态规则的结果并进现有的 `nondeterministic` 警告，不新增警告种类（界面不用加字）；监视事件多一个 `valid`。

**没验证的**：真实 VS Code 里打开复制出的模板文件夹的补全体验（只用编译器 API 按同样的配置检查过）；`shell.openPath` 真的打开资源管理器（测试里是假的）；`import.meta.glob` 在 electron-vite 里的同样写法；“删掉 packages/optional 跑完整 pnpm check”只手工跑了 install、typecheck、lint 和相关单元测试。

**留给 MD-b 的接线点**

- 诊断：`diagnosticOf(error)` 从任何引擎、宿主、预检错误上取出 `TemplateDiagnostic`；`EngineHost.load` 的结果带 `diagnostics`（规则提示）；`EngineHost.checkDeterminism` 可替换 `trial.ts` 里的自比较。错误浮层按 `kind`、`code`、`line`/`column` 显示（文案两种语言）。
- 监视：`window.allay.templates.onChanged(change)`，`change.hash` 即内容版本；收到后 `templates.read` 重新取代码，走热重载管线（H9）。
- 入口：`templates.copyBuiltin`、`templates.writeDevFiles`、`templates.openFolder`，失败时是枚举的 `error`。
- 测试钩子：`copyBuiltinTemplate`、`writeTemplateDevFiles`、`templateChanges(clear)`。
- 可选模块：`@allay/host-api` 的 `EditorHost`；惰性发现按实验的写法接在渲染进程。
- 验收：T-DEV-1；T-DEV-2 的界面部分。
