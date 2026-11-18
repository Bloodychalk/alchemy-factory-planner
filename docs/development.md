# 后续开发接入说明

## 网页与桌面版共用资源

公开网页源文件统一放在 `web/`；构建脚本只复制此目录到 `dist/`。原有参考快照保留在 `research/`，不要对其直接开发，也不要将整个工作区复制到发布目录。

现有方案仍以 JavaScript 规则引擎与画布为计算核心，Python 负责 pywebview 桌面窗口、文件及打包。建议在获得所需授权后，将确认可发布的页面、样式和脚本按原结构放入 `web/`。不要为了部署 GitHub Pages 引入第二套规则引擎或前端框架。

GitHub Pages 只能托管静态文件，不能执行 Python、启动 FastAPI 或提供本地文件系统桥。浏览器版本的计算需在 JavaScript / Web Worker 内执行；JSON 导入使用文件选择与 JSON.parse，导出使用 Blob 下载。桌面版才调用 Python bridge，并等待 `pywebviewready`。通过统一的平台适配层区分功能，不允许网页初始化时无条件访问 `window.pywebview.api`。

Wiki 同步受浏览器 CORS 限制，首版网页使用已核验且获准发布的本地数据或用户手动导入。Python 桌面版可沿用计划中的同步功能，不向公开网站嵌入代理密钥。

## GitHub Pages 路径

站点位于 `https://bloodychalk.github.io/alchemy-factory-planner/`，不是域名根目录。

- HTML/CSS/图标使用 `./js/...`、`./img/...` 等相对路径，避免 `/js/...`。
- fetch 与 Worker URL 应相对页面或脚本构造，验收时必须测试 `/alchemy-factory-planner/` 子目录。
- 初版用单页加 URL query/hash 保存导航；History 路由直接刷新可能 404。
- 文件名大小写必须一致；本地 macOS 可打开的路径不一定能在 Linux 工作流与 Pages 上打开。
- 使用本地 HTTP 服务验收，不能只测试 `file://`。
- GitHub Pages 的 localStorage 随 origin 隔离而非按项目路径隔离；给键加入项目名和 schemaVersion，避免与同账号其他 Pages 项目冲突。更换域名/浏览器不会自动迁移存档，应提供显式 JSON 导入导出。

## 计算与数据约定

继续遵循本地 modification-plan.md，不因网页部署改变产品目标。

- 引擎内部统一每分钟速率；输入个/秒乘 60，秒/个取 60/x，拒绝零、负数和非有限值。
- 以英文规范键保存数据，中文用于显示。副产物、燃料/肥料内耗与最终净交付量分别核对。
- 文字简介与图形取同一份结构化结果，切换视图不重复追加节点。
- Web Worker 中禁止依赖 DOM 或隐式 window；保留取消、超时与错误诊断。
- 先修复已记录的数据库导入 switch 贯穿、自供不可行静默关闭和中文改键问题。
- 桌面桥仅向打包的本地资源开放；外部链接交系统浏览器打开。

## 发布边界与版本控制

`research/` 和 `modification-plan.md` 被根 .gitignore 忽略，原文件仍在磁盘。GitHub 参考仓库缺少明确 LICENSE，Wiki 资源也没有获得整体再分发授权；确认各项授权后再逐项引入，保留来源、版本、版权与必要说明。不要直接给上游代码声明 MIT。

部署产物只包含 `web/`。不要把个人目录、密钥、原始网页快照、Python 虚拟环境或桌面构建包放入其中。日后增加文件请先检查 `git diff --cached --stat`。

GitHub 工作流没有自建 token，只用 GitHub 提供的短期 GITHUB_TOKEN 和 Pages OIDC。PR 只运行构建检查，发布限 main 推送和手动执行。Pages Source 必须选 GitHub Actions。

## 验收

当前基础检查：构建成功、HTML 引用存在、资源没有根路径依赖、输出没有本地研究材料；人工检查桌面和窄屏布局。新增 JS/Worker 后应增加对应资源路径、控制台错误、JSON 导入失败保留旧数据和木材 60/min 等真实回归场景。静态检查不能代替产线计算正确性验证。

Python 桌面包按平台分别构建与验证。Pages 发布成功不代表 Windows/macOS 桌面打包已通过。
