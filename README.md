# 炼金工厂产线计算器

[在线使用](https://bloodychalk.github.io/alchemy-factory-planner/) · [使用说明](docs/user-guide.md) · [开发说明](docs/development.md)

仅维护网页版。支持 JSON 配方导入导出、三种产量单位、原料与燃料/肥料配平、文字清单、总览/逐台详细流程图以及方案保存恢复。计算与图形复用参考引擎和画布。

首次使用需联网取得经 SHA-256 校验的参考文件，之后在浏览器缓存。计算在 Web Worker 内完成。推荐是有界搜索，不保证全局最优；概率配方按长期平均处理。

## 本地运行

```sh
python3 scripts/build_site.py
python3 scripts/check_site.py
python3 -m http.server 8000 --directory dist --bind 127.0.0.1
```

打开 http://127.0.0.1:8000/ 。不需要安装桌面程序或 Python 运行时来使用在线版。

## 开发检查

Python 仅用于构建、参考数据缓存和 Wiki 数据转换，不属于客户端运行环境。

```sh
uv sync
uv run python -m data_tools
node --test tests/planning.test.js
uv run python -m unittest discover -s tests -p 'test_*.py'
```

## 来源与发布边界

参考项目：[starfi5h/AlchemyFactoryCalculator](https://github.com/starfi5h/AlchemyFactoryCalculator)，上游 [JoeJoesGit/AlchemyFactoryCalculator](https://github.com/JoeJoesGit/AlchemyFactoryCalculator)；Wiki：[Alchemy Factory Codex](https://alchemy-factory-codex.com/production-planner/)。固定提交和文件校验值保存在 `web/upstream.json`。本仓库只发布原创界面和适配器及参考清单，不再分发上游源码、整份数据库、游戏图标或 Wiki 镜像。作者归属保留在这里，未给上游代码附加新的许可证。

`research/`、缓存和个人存档不发布；Pages 只发布 `web/`。

逐台详细模式的支持范围、规则不足时的处理及第三方图形库许可见 [详细规划说明](docs/detailed-planning.md)。
