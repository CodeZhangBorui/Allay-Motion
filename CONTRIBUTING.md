# 参与贡献 / Contributing

## 许可与贡献者许可协议

本项目以 GPL-3.0-only 授权，同时由版权人另行提供商业授权（见 [README 的“许可”一节](README.md#许可--license)）。为了能继续这样做：

- **外部贡献只有在贡献者同意贡献者许可协议（CLA）之后才会被合并。** 协议的要点是：你保留自己贡献的版权，同时授权版权人在 GPL-3.0 之外以其他条款（包括商业授权）再授权你的贡献。
- 现在没有配置自动签署 CLA 的机器人；协议文本和签署方式由版权人在 PR 里告知。没有同意之前，PR 不会被合并。
- 许可范围同 README：贡献里不要放 Minecraft 的任何文件（贴图、音效、模型、字体、语言文件、jar）或从它们派生的内容，也不要放第三方资源包；这些不在 GPL-3.0 和商业授权的范围内，仓库也不接收（见 `AGENTS.md` 硬性规则 1 和 `ASSETS_PROVENANCE.json`）。

## 动手之前

- 读 `AGENTS.md`：硬性规则、里程碑的做法、代码约定。
- 每个二进制素材都要登记来源（`ASSETS_PROVENANCE.json`）；新依赖的许可要在允许列表里（`pnpm check:licenses`）。
- 提交信息用 Conventional Commits 的格式。

## 提交改动的流程

- **外部贡献者**：从自己的 fork 发 PR。PR 上的 CI 会在 Windows 上跑 `pnpm check` 和 `pnpm check:removable`（门禁），在 macOS 上编译 FFmpeg、跑导出测试并打包检查；通过、并同意 CLA 之后由维护者合并。
- **维护者**（不开 PR）：推工作分支（`claude/…`），等 CI 在这个提交上通过，再把同一个提交快进推到 `main`（`git push origin <提交>:main`）。不在 `main` 上直接提交未经 CI 的改动；`main` 上的 push 发现提交已经通过会跳过重跑。

---

**English**: This project is GPL-3.0-only and the copyright holder also offers commercial licenses. External contributions are merged only after the contributor agrees to a Contributor License Agreement that lets the copyright holder relicense the contribution outside the GPL (including commercially); you keep your copyright. No CLA bot is configured yet — the agreement text and how to sign it are provided in the PR. External contributors open PRs from forks; CI runs `pnpm check` and `pnpm check:removable` on Windows (the gate) and a macOS build-and-package job. Maintainers push a work branch, wait for CI to pass on that commit, then fast-forward `main` to the same commit without a PR. Do not contribute any Minecraft files or content derived from them, or third-party resource packs; they are outside both licenses.
