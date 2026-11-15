# GitCode 镜像与发行版同步

GitHub 是源仓库，[GitCode](https://gitcode.com/Mystic-Stars/Allay-Motion) 是单向分发镜像。同步分两边做，都不依赖开发者电脑或本机 GitCode 登录：

| 在哪里运行 | 文件 | 做什么 |
|---|---|---|
| GitHub Actions | `.github/workflows/gitcode-mirror.yml`、`scripts/sync-gitcode-release.mjs` | 推送分支和标签；在 GitCode 上建好发行版，同步名称、说明和“最新版本”标记 |
| GitCode 流水线 | `.gitcode/workflows/pull-release-assets.yml`、`scripts/pull-github-release-assets.mjs` | 从 GitHub 的公开下载地址拉取安装包和 `SHA256SUMS.txt`，传成 GitCode 发行版的附件 |

附件改由 GitCode 那边拉取，是因为从 GitHub 的机器跨境上传太慢：2026-11-14 v0.1.1 的第一个 148 MB 安装包传了 50 分钟还没传完。GitCode 流水线的文件放在仓库里，随 GitHub Actions 的代码同步来到 GitCode；GitHub 不运行 `.gitcode/` 下的文件。

## 一次性设置

1. GitCode 上的 `Mystic-Stars/Allay-Motion` 使用**普通可写仓库**，不要启用 GitCode 的 Pull 镜像：只读镜像仓库可能拒绝创建标签或发行版。不要在 GitCode 手动提交代码或修改标签。
2. 在 GitCode 个人设置的[访问令牌](https://docs.gitcode.com/docs/help/home/user_center/security_management/user_pat/)中新建令牌，授予对该仓库的代码推送和 Release/API 写入权限，并设置合适的有效期。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 中新增 `GITCODE_TOKEN`，值为刚创建的令牌。只保存在 GitHub Secrets，不要提交到仓库或粘贴到公开聊天中。
4. 将这些工作流和脚本提交到 GitHub 默认分支。在 **Actions → 同步到 GitCode → Run workflow** 手动运行一次，并查看运行日志。留空 `tag` 会检查全部已发布版本；填写标签可只处理该版本。首次同步包含全部分支和标签。
5. **GitCode 流水线**：GitCode（AtomGit）的代码化流水线目前要[申请内测名额](https://docs.gitcode.com/docs/help/home/org_project/pipeline/quick-start)。开通后，在 GitCode 仓库的“流水线”（Actions）页面确认出现“从 GitHub 拉取发行版附件”，手动运行一次看日志。
   - 令牌：默认用流水线自动生成的 `ATOMGIT_TOKEN`（工作流里声明了 `repository: write`、`project: write`）。如果日志里获取上传地址或上传失败（HTTP 401/403），在 GitCode 仓库的 **项目设置 → 密钥与变量 → 仓库密钥** 里新建 `GITCODE_TOKEN`（同第 2 步的个人令牌），之后优先用它。
   - 流水线没开通或用不了时，可以在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 里新建变量 `GITCODE_ASSETS_FROM`，值为 `github`，退回旧做法：附件由 GitHub Actions 上传（慢）。**两边不要同时开**，否则可能传出重复的附件。

如果 GitHub 分支被重写，工作流只在确认 GitCode 分支原提交存在于 GitHub 时，用 `--force-with-lease` 跟随更新；来源不明的独立提交、同名标签冲突或受保护分支可能被拒绝，先检查两边差异并处理，再重跑工作流。工作流不会删除 GitCode 的分支、标签、历史发行版或附件，也不会同步 Issue、PR 和仓库设置。分支同步失败时仍会尝试同步标签和发行版；标签同步失败时不会同步发行版，以免版本指向错误提交。

## 自动运行

**GitHub Actions**

- 两个作业各自排队：“同步分支和标签”几十秒就完；“同步发行版信息”只调几个 API，也很快。
- 推送任意分支或标签时同步仓库。GitHub 分支或标签删除后，GitCode 的对应引用会保留；需要时手动清理。
- `release` 工作流在推送 `v*` 标签时构建并检查 Windows（x64）和 macOS（arm64、x64）的安装包，三份都成功、全部附件上传成功后自动正式发布；手动运行该工作流仅构建产物。
- GitHub 上正式发布或编辑 Release 时，以及发版工作流结束后，在 GitCode 上建好或更新发行版；草稿不会同步。每天 03:17 UTC（北京时间 11:17）再检查一次。GitHub 的 `GITHUB_TOKEN` 产生的发布事件不会触发其他工作流，因此同时监听发版工作流完成事件。

**GitCode 流水线**

- 推送 `v*` 标签（GitHub Actions 同步标签）时启动，等 GitHub 上的发版构建完成并发布、GitCode 上的发行版建好（最多等 2 小时，每分钟看一次），然后补附件。
- 每小时（UTC+8 的第 7 分钟）检查最近 20 个发行版，补上缺的附件；也可以手动运行，填标签只补这个版本。同一时刻只跑一个，后来的排队。
- 要传哪些文件、每个文件的 SHA-256 以 GitHub 上同一版本的 `SHA256SUMS.txt` 为准（它本身也传上去）。只用 `github.com/<仓库>/releases/download/` 的公开地址，不调 GitHub API（共享机器的 IP 容易撞上未登录的限流）。下载后核对 SHA-256，对不上就重试，最多 3 次。
- 先传 `SHA256SUMS.txt`，再传自动更新要用的 `*-setup.exe` 和 `*.dmg`，最后传 `*-mac.zip`；同时处理 3 个（`PULL_CONCURRENCY`）。下载和上传 5 分钟没有进度就重试；上传失败时先确认附件没有登记过再重试，避免重复附件。日志里每分钟记一次下载、上传的进度和平均速度。
- 一个版本失败不影响其他版本；最后有没补齐的就把运行标记为失败，下次运行接着补，不需要重新构建。

已存在且摘要相同的附件会跳过；同名附件摘要不同会报错并保留原文件，核对后可在 GitCode 手动删除该附件再补传。GitCode 上某个版本还缺安装包或 `SHA256SUMS.txt` 时，应用内的自动更新会改从 GitHub 下载（`docs/decisions.md`“自动更新”）。

GitHub 的旧草稿不会自动公开；需要发布某个旧草稿时，在 GitHub 手动发布，之后自动同步。
