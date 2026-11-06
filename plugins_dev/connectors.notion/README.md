# Notion 只读插件

在 LimeA 中搜索已共享的 Notion（笔记协作平台）页面，读取页面属性与内容块。需要支持插件接口版本 10 的新版 LimeA；旧版主程序必须先升级。

## 使用

1. 在插件市场安装并启用「Notion 只读」，或在开发时导入本目录的 `dist`。
2. 在「设置 → 插件」点击 Notion 的名称或「打开插件」，进入独立页面，点击「连接 Notion」。在浏览器中选择工作区，并选择共享给 LimeA 的页面。
3. 回到 LimeA，单独点击「允许插件使用」。从下一次发送消息开始，模型可调用这三个只读工具。

本插件的介绍、登录操作和连接状态均在独立页面内；不会打开旧设置弹窗。管理菜单提供停用、更新和移除。页面可以在清单 `page.illustration` 中声明可选包内插图；没有时不留空白。启用即信任插件代码；宿主提供的连接能力是受限接口，原生插件执行环境本身不是安全沙箱。

1.2.0 加入品牌图标、圆角横幅与分区列表。通用线条图标使用宿主的 `context.controls`，不额外打包图标库；先检查 `controls.icons`，旧宿主不提供时保留文字与按钮。横幅与品牌图标随包附带，运行时无需访问图片网站。更新插件后按宿主提示重启，并重新允许使用当前连接。

1.3.0 使用宿主支持的 `toolPresentation` 声明工具调用品牌：聊天中显示「Notion 图标 · Notion · 搜索页面 / 读取页面信息 / 读取页面内容」。需要更新后的 LimeA；图标加载、折叠详情、状态、耗时和权限仍由宿主管理。

## 能力与范围

| 工具       | 输入                                 | 返回                                 |
| ---------- | ------------------------------------ | ------------------------------------ |
| `search`   | 可选 `query`、`cursor`、`pageSize`   | 最多 20 个页面摘要与下一页游标       |
| `page`     | `pageId`                             | 页面标题、链接及受支持的属性         |
| `children` | `blockId`、可选 `cursor`、`pageSize` | 最多 50 个直接子块的文本与下一页游标 |

搜索只匹配页面标题，不进行正文全文搜索。只能看到你在 Notion 中共享给集成的页面；空结果不代表工作区中没有其他内容。内容块的 `hasChildren` 表示可继续用该块的 ID（标识）读取子块。附件仅返回可用说明文字，不下载文件，不自动访问外部链接。暂不支持数据源查询、写入、评论和自动同步。

插件携带 Notion 官方 SDK（软件开发工具包），自行实现读取与结果整理；SDK 的请求交给宿主受限代理校验端点并注入凭据。插件不能取得访问令牌、刷新令牌，也不能绕过已批准读取范围。每个工具执行最多调用 16 次读取。输入、单次响应和结果页均有限额；投影结果超过 24,000 字节会明确报错，可用较小的 `pageSize` 与同一 `cursor` 重试分页读取。单块文本超过 8,000 字符时返回 `textTruncated: true`，不能当作完整正文。读取响应作为外部数据交给模型，不应被当作宿主指令。

账号授权、插件许可、当前运行绑定分别校验。停用、更新、卸载或重新安装插件会使旧许可失效；重新允许后，旧任务也不会自动获得新增权限。断开连接先关闭本地访问，再尝试远程撤销；结果不明时可在 Notion 的连接设置中手动移除 LimeA。

Notion 集成应在服务方设置中仅开启需要的读取能力。插件清单中的 `notion-read` 是宿主的能力集合，不是服务方已验证的权限证明。

## 开发

使用 Node.js（JavaScript 运行时）24 或更高版本。构建复用 esbuild（模块打包工具），将官方 SDK 和 Zod（数据校验库）一起打包，运行时无需另装依赖：

```sh
npm --prefix plugins_dev/connectors.notion ci
npm --prefix plugins_dev/connectors.notion test
npm --prefix plugins_dev/connectors.notion run build
npm run pack:plugin -- plugins_dev/connectors.notion/dist entries/connectors.notion.json
npm test
npm run check
```

连接协议和凭据生命周期由 LimeA 宿主维护，参见主仓库的 [OAuth 网关文档](https://github.com/Playa-LimeA/LimeA/blob/master/docs/oauth-gateway.md)。本插件无需配置客户端密钥。

## 授权

代码采用 [MIT 许可证](LICENSE)。随包附带官方 SDK 与 Zod 的许可证，见 `THIRD-PARTY-NOTICES.txt`。Notion 品牌图标来自官网，横幅由项目提供；图片和品牌商标不属于本插件的 MIT 授权范围。Notion 名称与标志归 Notion Labs, Inc. 所有，本插件由 Playa 独立开发。
