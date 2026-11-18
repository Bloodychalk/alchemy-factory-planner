# 炼金工厂产线计算器

面向《炼金工厂》（Alchemy Factory）的产线规划项目。

**当前状态：已建立网页工程与 GitHub Pages 发布流程，计算功能尚未接入。**
网页入口：https://bloodychalk.github.io/alchemy-factory-planner/

计划功能：导入 JSON 配方，按个/分钟、个/秒或秒/个设定产量，查看文字清单与图形产线。桌面版本计划使用 Python / pywebview 复用同一套网页资源。

## 本地预览与构建

需要 Python 3.10+，当前静态网页无需安装第三方依赖。

```sh
python3 scripts/build_site.py
python3 scripts/check_site.py
python3 -m http.server 8000 --directory dist --bind 127.0.0.1
```

然后打开 http://127.0.0.1:8000/ 。网页源文件位于 `web/`，不要直接编辑生成的 `dist/`。

## 发布

GitHub 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。更新网页后提交并推送到 `main`，工作流将构建、检查并发布 `dist/`。Pull request 只检查，不部署；也可在 Actions 手动运行 `Publish GitHub Pages`。

```sh
git add web scripts .github README.md docs .gitignore
git commit -m "Update website"
git push origin main
```

## 工程目录

```text
web/                       公开网页源文件，未来接入计算器
scripts/build_site.py      只复制 web/ 到 dist/
scripts/check_site.py      检查入口、相对资源路径和发布边界
.github/workflows/pages.yml  自动检查与 Pages 部署
docs/development.md        网页与桌面版接入约定
research/                  本地参考资料，不纳入 Git 或部署
modification-plan.md       本地详细方案，不纳入 Git 或部署
```

## 参考来源

- [starfi5h/AlchemyFactoryCalculator](https://github.com/starfi5h/AlchemyFactoryCalculator)
- [JoeJoesGit/AlchemyFactoryCalculator](https://github.com/JoeJoesGit/AlchemyFactoryCalculator)
- [Alchemy Factory Codex](https://alchemy-factory-codex.com/production-planner/)

当前公开版本仅包含本项目新建的工程文件和项目介绍页，不包含参考项目的源码、配方、图标或 Wiki 镜像。参考代码及游戏资源的授权需分别核实；不得直接给它们附加新的开源许可证。完整功能的实施方案与源码分析暂保存在本地。

本项目与游戏官方无关联。
