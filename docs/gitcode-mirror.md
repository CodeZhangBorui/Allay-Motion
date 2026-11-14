# GitCode 镜像与发行版同步

GitHub 是源仓库，[GitCode](https://gitcode.com/Mystic-Stars/Allay-Motion) 是单向分发镜像。同步由 GitHub Actions 执行，不依赖开发者电脑或本机 GitCode 登录。

## 一次性设置

1. GitCode 上的 `Mystic-Stars/Allay-Motion` 使用**普通可写仓库**，不要启用 GitCode 的 Pull 镜像：只读镜像仓库可能拒绝创建标签或发行版。不要在 GitCode 手动提交代码或修改标签。
2. 在 GitCode 个人设置的[访问令牌](https://docs.gitcode.com/docs/help/home/user_center/security_management/user_pat/)中新建令牌，授予对该仓库的代码推送和 Release/API 写入权限，并设置合适的有效期。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 中新增 `GITCODE_TOKEN`，值为刚创建的令牌。只保存在 GitHub Secrets，不要提交到仓库或粘贴到公开聊天中。
4. 将这些工作流和脚本提交到 GitHub 默认分支。在 **Actions → 同步到 GitCode → Run workflow** 手动运行一次，并查看运行日志。留空 `tag` 会检查全部已发布版本；填写标签可只补传该版本。首次同步包含全部分支和标签。

如果 GitCode 当前有独立提交、同名标签或受保护分支，推送可能被拒绝；Actions 不会强推或删除 GitCode 的分支、标签。先检查两边差异并处理，再重跑工作流。工作流不会同步 GitHub Issue、PR、仓库设置，也不会自动删除 GitCode 上的历史发行版或附件。

## 自动运行

- 推送任意分支或标签时同步仓库。GitHub 分支或标签删除后，GitCode 的对应引用会保留；需要时手动清理。
- `release` 工作流在推送 `v*` 标签时构建并检查 Windows 安装包。全部附件上传成功后自动正式发布；手动运行该工作流仅构建产物。
- GitHub 上正式发布或编辑 Release 时，以及发版工作流结束后，同步工作流会检查已发布版本，补传安装包、校验文件等附件。同步时会校验 GitHub 下载文件及 GitCode 附件的 SHA-256；草稿不会同步。
- 每天 03:17 UTC（北京时间 11:17）再检查一次，补救被 GitHub 合并的事件或临时网络故障。缺令牌、上传失败或文件内容不一致时 Actions 标记失败。

GitCode 附件上传通过该平台的预签名对象存储地址完成。大安装包的跨境上传可能需要较长时间；失败后可重跑同步，不需要重新构建。已存在且摘要相同的附件会跳过；同名附件摘要不同会报错并保留原文件，核对后可在 GitCode 手动删除该附件再补传。GitCode 创建发行版后才逐个上传附件，上传期间页面可能暂时不完整。

GitHub 的旧草稿不会自动公开；需要发布某个旧草稿时，在 GitHub 手动发布，之后自动同步。GitHub 的 `GITHUB_TOKEN` 产生的发布事件不会触发其他工作流，因此同步同时监听发版工作流完成事件，并有每日兜底。
