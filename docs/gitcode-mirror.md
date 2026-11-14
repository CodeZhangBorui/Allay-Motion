# GitCode 镜像与发行版同步

GitHub 是源仓库，[GitCode](https://gitcode.com/Mystic-Stars/Allay-Motion) 是单向分发镜像。同步由 GitHub Actions 执行，不依赖开发者电脑或本机 GitCode 登录。

## 一次性设置

1. GitCode 上的 `Mystic-Stars/Allay-Motion` 使用**普通可写仓库**，不要启用 GitCode 的 Pull 镜像：只读镜像仓库可能拒绝创建标签或发行版。不要在 GitCode 手动提交代码或修改标签。
2. 在 GitCode 个人设置的[访问令牌](https://docs.gitcode.com/docs/help/home/user_center/security_management/user_pat/)中新建令牌，授予对该仓库的代码推送和 Release/API 写入权限，并设置合适的有效期。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 中新增 `GITCODE_TOKEN`，值为刚创建的令牌。只保存在 GitHub Secrets，不要提交到仓库或粘贴到公开聊天中。
4. 将这些工作流和脚本提交到 GitHub 默认分支。在 **Actions → 同步到 GitCode → Run workflow** 手动运行一次，并查看运行日志。留空 `tag` 会检查全部已发布版本；填写标签可只补传该版本。首次同步包含全部分支和标签。

如果 GitHub 分支被重写，工作流只在确认 GitCode 分支原提交存在于 GitHub 时，用 `--force-with-lease` 跟随更新；来源不明的独立提交、同名标签冲突或受保护分支可能被拒绝，先检查两边差异并处理，再重跑工作流。工作流不会删除 GitCode 的分支、标签、历史发行版或附件，也不会同步 Issue、PR 和仓库设置。分支同步失败时仍会尝试同步标签和发行版；标签同步失败时不会同步发行版，以免版本指向错误提交。

## 自动运行

- 工作流分两个作业，各自排队：“同步分支和标签”几十秒就完；“同步发行版和附件”可能要几个小时（最长 360 分钟）。附件上传再慢也不会挡住分支和标签的同步。
- 推送任意分支或标签时同步仓库。GitHub 分支或标签删除后，GitCode 的对应引用会保留；需要时手动清理。
- `release` 工作流在推送 `v*` 标签时构建并检查 Windows（x64）和 macOS（arm64、x64）的安装包，三份都成功、全部附件上传成功后自动正式发布；手动运行该工作流仅构建产物。
- GitHub 上正式发布或编辑 Release 时，以及发版工作流结束后，同步工作流会检查已发布版本，补传安装包、校验文件等附件。同步时会校验 GitHub 下载文件及 GitCode 附件的 SHA-256；草稿不会同步。
- 每天 03:17 UTC（北京时间 11:17）再检查一次，补救被 GitHub 合并的事件或临时网络故障。缺令牌、上传失败或文件内容不一致时 Actions 标记失败。

GitCode 附件上传通过该平台的预签名对象存储地址完成。从 GitHub 的机器跨境上传很慢（2026-11-14 v0.1.1 的第一个 148 MB 安装包传了 50 分钟还没传完），所以：

- **先传最新正式版**，其余版本从新到旧；新版本发布（发版工作流结束、Release 发布或编辑）时会打断正在进行的补传，重新从最新版本开始，普通推送和每日检查不打断；同一个版本里先传 `SHA256SUMS.txt`，再传应用内自动更新要用的 `*-setup.exe` 和 `*.dmg`，最后传 `*-mac.zip`。发行版本身仍按旧版本在前、最新正式版最后的顺序创建，“最新版本”的标记不受影响。
- 同时上传 3 个附件（`GITCODE_UPLOAD_CONCURRENCY`）。
- 一次上传 5 分钟没有任何进度就放弃，先确认附件没有登记，再换新的上传地址重试，每个附件最多试 3 次。
- 日志里每分钟记一次每个附件的上传进度和平均速度，传完记用时。
- 一个版本的附件失败不影响其他版本；最后有没传完的就把运行标记为失败，重跑或等每日检查接着补传，不需要重新构建。

GitCode 上某个版本还缺安装包或 `SHA256SUMS.txt` 时，应用内的自动更新会改从 GitHub 下载（`docs/decisions.md`“自动更新”）。已存在且摘要相同的附件会跳过；同名附件摘要不同会报错并保留原文件，核对后可在 GitCode 手动删除该附件再补传。GitCode 创建发行版后才逐个上传附件，上传期间页面可能暂时不完整。

GitHub 的旧草稿不会自动公开；需要发布某个旧草稿时，在 GitHub 手动发布，之后自动同步。GitHub 的 `GITHUB_TOKEN` 产生的发布事件不会触发其他工作流，因此同步同时监听发版工作流完成事件，并有每日兜底。
