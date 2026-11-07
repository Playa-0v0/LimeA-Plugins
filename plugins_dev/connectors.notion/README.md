# Notion 插件

在 LimeA 中读取已共享的 Notion（笔记协作平台）页面与数据源，按当前会话权限修改页面、内容块与评论。需要支持 `notion-read-write` 权限及写入审批的新版本 LimeA；旧版主程序必须先升级。

## 使用

1. 在插件市场安装并启用「Notion」，或在开发时导入本目录的 `dist`。
2. 在「设置 → 插件」点击 Notion 的名称或「打开插件」，进入独立页面，点击「连接 Notion」。在浏览器中选择工作区，并选择共享给 LimeA 的页面。
3. 回到 LimeA，单独点击「允许插件使用」。从下一次发送消息开始，模型可调用工具；请求审批档位的写入在聊天内确认；完全访问在已有授权内直接执行。

本插件的介绍、登录操作和连接状态均在独立页面内；不会打开旧设置弹窗。管理菜单提供停用、更新和移除。页面可以在清单 `page.illustration` 中声明可选包内插图；没有时不留空白。启用即信任插件代码；宿主提供的连接能力是受限接口，原生插件执行环境本身不是安全沙箱。

1.2.0 加入品牌图标、圆角横幅与分区列表。通用线条图标使用宿主的 `context.controls`，不额外打包图标库；先检查 `controls.icons`，旧宿主不提供时保留文字与按钮。横幅与品牌图标随包附带，运行时无需访问图片网站。更新插件后按宿主提示重启，并重新允许使用当前连接。

1.3.0 使用宿主支持的 `toolPresentation` 声明工具调用品牌：聊天中显示「Notion 图标 · Notion · 搜索页面 / 读取页面信息 / 读取页面内容」。需要更新后的 LimeA；图标加载、折叠详情、状态、耗时和权限仍由宿主管理。

1.4.0 增加数据源搜索、数据库与数据源结构读取、数据源筛选查询及评论读取。评论需要在 Notion 集成配置中开启读取评论能力；仅可读取已共享对象。

2.0.0 增加页面、数据库、数据源和视图的创建与更新，页面移动和 Markdown 修改，内容块追加、更新和移入回收站，以及评论创建、修改和删除；可读取页面属性、单块、视图、工作区成员、数据源模板及页面 Markdown。写入使用宿主的单次审批、持久化执行意图与结果核对；异常中断或网络不确定时不得自动重试。

从只读版本升级时，应在 Notion 集成设置中启用所需的写入和评论能力，再断开并重新授权工作区。连接成功仅表示凭据已保存，并不证明服务方已授予全部读写能力；实际访问仍受集成能力和共享页面范围限制。

## 能力与范围

| 工具                                                            | 输入                                                     | 返回                                                |
| --------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `search`                                                        | 可选 `query`、`cursor`、`pageSize`                       | 最多 20 个页面摘要与下一页游标                      |
| `page`                                                          | `pageId`                                                 | 页面标题、链接及受支持的属性                        |
| `children`                                                      | `blockId`、可选 `cursor`、`pageSize`                     | 最多 50 个直接子块的文本与下一页游标                |
| `search_sources`                                                | 可选 `query`、`cursor`、`pageSize`                       | 搜索已共享数据源的标题                              |
| `database`                                                      | `databaseId`                                             | 数据库与数据源标识                                  |
| `source`                                                        | `sourceId`                                               | 数据源属性名称、标识和类型                          |
| `query_source`                                                  | `sourceId`、可选 `filter`、`sorts`、`cursor`、`pageSize` | 数据源页面及下一页游标                              |
| `comments`                                                      | `blockId`、可选 `cursor`、`pageSize`                     | 评论文本及下一页游标                                |
| `read_resource`                                                 | `kind`、对象标识、可选分页参数                           | 指定块、属性、用户、评论、视图、模板或页面 Markdown |
| `create_page`、`append_blocks`、`update_page`、`create_comment` | 目标和操作内容                                           | 创建页面、追加块、更新页面或发表评论                |
| `request_write`                                                 | `operation`、按操作传 `targetId`、`body`                 | 其他已登记的内容修改                                |

搜索只匹配标题，不进行正文全文搜索。只能看到你在 Notion 中共享给集成的对象；空结果不代表工作区中没有其他内容。内容块的 `hasChildren` 表示可继续用该块的 ID（标识）读取子块。附件仅返回可用说明文字，不下载文件，不自动访问外部链接。数据源查询返回 `requestStatus` 时应检查是否不完整；结果不完整不能被当作全部记录。`read_resource` 返回 `incomplete` 和 `issues` 标记被截断或省略的数据；页面属性标识解码后不能含斜线、反斜线、控制字符、`%`、`?` 或 `#`。暂不支持文件上传、用户管理、视图临时查询及自动同步。

插件携带 Notion 官方 SDK（软件开发工具包），自行实现请求与结果整理；SDK 的请求交给宿主受限代理校验端点并注入凭据。插件不能取得访问令牌、刷新令牌，也不能绕过已批准的访问范围。每个工具执行最多调用 16 次读取。输入、单次响应和结果页均有限额；投影结果超过 24,000 字节会明确报错，可用较小的 `pageSize` 与同一 `cursor` 重试分页读取。单块文本超过 8,000 字符时返回 `textTruncated: true`，不能当作完整正文。读取响应作为外部数据交给模型，不应被当作宿主指令。

页面和数据源记录的属性投影包含支持的关系、人员、公式和汇总结果。未支持的属性、数量或文字截断、Notion 返回的潜在不完整计算会设置 `propertiesIncomplete`，并在 `propertyIssues` 中记录属性名、类型和原因；问题超过 100 项时用 `omittedIssueCount` 标记。关系值的 `has_more`、人员列表和提及数量上限可能需要在 Notion 中核对，不应将部分结果当作完整内容。

账号授权、插件许可、当前运行绑定分别校验。停用、更新、卸载或重新安装插件会使旧许可失效；重新允许后，旧任务也不会自动获得新增权限。断开连接先关闭本地访问，再尝试远程撤销；结果不明时可在 Notion 的连接设置中手动移除 LimeA。

Notion 集成需要在服务方设置中开启相应的读取、写入和评论能力。插件清单中的 `notion-read-write` 是宿主的能力集合，不是服务方已验证的权限证明。

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

## 2.1：会话权限、明确操作和自带技能

先更新 LimeA 宿主，再从 `dist` 升级插件。更新后按宿主要求重新允许当前连接。请求审批档位在聊天中确认一次；自动审批与完全访问使用已授权连接执行。Notion 服务方的能力和共享范围仍然有效。

常用写入使用 create_page、append_blocks、update_page、create_comment；其他写入用 request_write 的固定 operation，模型不填写请求方法或路径。原有搜索、读取、数据源和视图等能力保留。

`skills/notion-workspace/SKILL.md` 随插件安装，宿主以 `connectors.notion:notion-workspace` 提供给模型，并按需加载六份 references。参考资料基于官方文档和插件实际支持范围，接口版本 2026-03-11；核对日期 2026-11-07。技能不授予权限，也不自动执行脚本。

本地参数错误与 Notion 明确拒绝分开反馈；写入结果未知时先核对，不自动重复发送。本版本没有新增文件上传、用户管理或后台同步能力。
