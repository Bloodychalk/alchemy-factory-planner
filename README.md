# 炼金工厂产线计算器

选择产物和目标净产量，自动推荐包含原料、燃料、肥料和副产物回收的产线。文字清单与可拖动的流程图使用同一份配平结果。

[在线使用](https://bloodychalk.github.io/alchemy-factory-planner/) · [使用说明](docs/user-guide.md) · [验证记录](docs/verification.md) · [开发说明](docs/development.md)

当前实现包括 JSON 导入导出、每分钟/每秒/秒每个单位、研究等级、指定目标配方、催化剂与悖论投入配置、自动比较路线、方案保存和 Python 桌面宿主。计算复用 starfi5h 的规则引擎，图形复用其现有画布与自动布局；没有重新开发一套节点框架。

## 使用

网页首次使用需要联网准备固定版本参考资料，准备后会缓存。展开“研究等级与生产设置”可指定配方、燃料、肥料、催化剂和设备参数。自动推荐默认包含燃料及肥料自产链，目标是扣除这些内耗后的净交付量。

桌面版本首次运行会在本机准备参考资料并尝试 Wiki 校准；之后缓存和存档保存在用户数据目录，可离线计算。网页受 Wiki CORS 限制，可导入桌面导出的 Wiki 校准 JSON。

推荐采用限时、有界候选搜索，依次比较采购支出、整数机器数量、热耗和剩余副产物；结果经过物料、热量和营养守恒复核，不声称已证明全局最优。概率配方使用长期平均产量，游戏中需要缓冲库存。实际加工热耗和整数设备安装容量分别列出。

## 本地开发

需要 Python 3.12+、[uv](https://docs.astral.sh/uv/)；运行计算测试还需要 Node.js 22+。

```sh
uv sync --group build --python 3.12
uv run alchemy-planner
```

仅运行网页：

```sh
python3 scripts/build_site.py
python3 scripts/check_site.py
python3 -m http.server 8000 --directory dist --bind 127.0.0.1
```

打开 http://127.0.0.1:8000/ 。网页和桌面共用 `web/`，Python 只负责本机资源缓存、文件保存、Wiki 同步与窗口。

## 测试与打包

```sh
uv run python -m desktop.main --prepare
node --test tests/planning.test.js
uv run python -m unittest discover -s tests -p 'test_*.py'
uv run python scripts/build_desktop.py
```

构建输出位于 `desktop-dist/`。Windows 和 macOS 必须在对应系统构建；仓库的 **Build desktop applications** 工作流提供 Windows x64、Apple Silicon Mac、Intel Mac 三种任务。程序包含 Python，不要求使用者自行安装。Windows 需要 Microsoft WebView2 Runtime；缺少时按使用说明安装。

## 数据与来源

- 参考代码：[starfi5h/AlchemyFactoryCalculator](https://github.com/starfi5h/AlchemyFactoryCalculator)，上游为 [JoeJoesGit/AlchemyFactoryCalculator](https://github.com/JoeJoesGit/AlchemyFactoryCalculator)。固定提交及 SHA-256 清单在 `web/upstream.json`。
- Wiki：[Alchemy Factory Codex](https://alchemy-factory-codex.com/production-planner/)。Python 校准器保留来源和差异记录，不按数字 ID 直接合并物品。
- 本仓库及发布包仅包含新编写的界面、适配器、宿主和第三方资源的校验清单，不包含上游源码、整份配方库、游戏图标或 Wiki 镜像。参考文件在使用者本机从其原地址获取并校验，保留作者归属。此结构不代表已经取得第三方代码或游戏资源的再分发授权，不给上游代码附加新的许可证。
- `research/`、缓存、存档和桌面生成物均不纳入 Git 或 Pages。自动部署只发布 `web/`。

本项目与游戏官方无关联。
