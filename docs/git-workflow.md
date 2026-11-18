# 在这台 Mac 上使用 GitHub

Git 用于版本管理，GitHub CLI（`gh`）提供 GitHub 登录与仓库管理。登录凭据通过 macOS 钥匙串保存，不需要把 token 写进仓库或 shell 配置文件。同一个 macOS 用户账户的终端、VS Code 和 Codex 可以使用同一份 Git 认证配置。

## 查看状态

```sh
gh auth status
git status
git remote -v
```

`gh auth status` 应显示登录到预期的 GitHub 账户。`git config user.name` 和 `git config user.email` 是提交署名，和 GitHub 登录认证是两件事。

## 提交与推送

在仓库目录中，先检查改动，只暂存需要提交的文件：

```sh
git status
git diff
git add web/index.html web/styles.css
git diff --cached
git commit -m "Update calculator page"
git pull --ff-only
git push
```

首次推送新分支时使用 `git push -u origin 分支名`。如果 `pull --ff-only` 报告分叉，先检查两端提交，按具体情况合并或变基，不要直接强制推送。

本项目 `main` 已跟踪 `origin/main`。更新 `web/`、构建脚本或发布工作流并推送到 `main` 后，会触发 GitHub Pages；仅修改开发说明不会重新部署网页。

## 克隆其他仓库

```sh
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
```

优先复制 HTTPS 地址。私有仓库要求当前 GitHub 账户本身拥有访问权限；组织启用 SSO 时，可能还需额外授权。网页中的登录状态和命令行认证相互独立。

本机已为 `github.com` 配置地址转换：常见的 `git@github.com:...` 和 `ssh://git@github.com/...` 地址会通过 HTTPS 使用同一份登录，已有 GitHub 仓库一般无需手动修改 remote。这项设置不影响 Gitee 的 SSH 连接。

## 其他常用命令

```sh
gh repo view --web
gh run list
gh auth setup-git --hostname github.com
```

若用户主动撤销登录或凭据失效，可重新执行：

```sh
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git --hostname github.com
```

不要运行 `gh auth token` 来排查普通推送问题，也不要将 token、私钥、`.env` 或个人数据提交到仓库。此项目的本地 `research/` 和 `modification-plan.md` 继续排除在版本控制与发布产物之外。
