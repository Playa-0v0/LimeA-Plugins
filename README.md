# LimeA 插件市场

LimeA「设置 → 插件市场」从本仓库的 `main` 分支读取 `catalog.json`。仓库只分发插件安装包和目录资料，插件源代码独立维护。

## 使用

在 LimeA 中打开插件市场，选择插件并安装，再到「管理插件」启用。启用即信任插件代码；声明的权限用于说明用途，不是沙箱。更新保持原有启用状态，重启 LimeA 后生效。

首个条目为「鲨鱼咬牙」，在支持面板插件的 LimeA 中启用后，从 Chat 模式右侧「小游戏」打开。

## 上架

需要 Node.js 24 或更高版本。首次运行 `npm ci`，随后：

```powershell
# 在插件自身仓库构建，得到独立的 dist 目录
npm run pack:plugin -- ../limea-shark-game-plugin/dist entries/games.shark.json
npm run check
```

打包工具读取 dist 根目录的 `limea.plugin.json`，生成带版本号的 ZIP 安装包、图标和 SHA-256（内容校验摘要），更新 `catalog.json`。条目资料包含 `author`、`description`、`category` 和可选的 `icon`（相对 dist 的图片路径）。分类可选 `games`、`appearance`、`tools`、`other`。

检查生成的清单、代码来源、第三方许可证和安装包后，将 `catalog.json`、`packages/`、`icons/`、`entries/` 的改动发布到 main。应用刷新市场即可发现新版。已发布版本不能替换内容，修改时提升版本号。卸架时移除清单条目，已安装副本仍保留在用户机器上。

每个安装包应包含完整构建产物（根目录清单、入口及声明的资源），不包含 node_modules、私钥或本机配置。宿主限制压缩包和展开内容各 32 MiB、最多 5000 项。包内的第三方许可证应保留。

## 目录格式

详见 `catalog.json`。宿主只从本仓库下载相对路径资源，安装前核验内容摘要及插件标识、名称、版本、宿主版本范围和能力声明。目录不存在时显示空市场；网络错误会提示刷新。安装不自动执行新插件。

本仓库的 MIT 许可证适用于目录与发布脚本。插件及其模型、美术资源按各自授权分发；打包不会改变原有权利归属。鲨鱼包保留 Three.js 的许可证，模型由项目提供。
