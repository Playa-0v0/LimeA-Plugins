# 其他操作

适用 Notion-Version 2026-03-11；核对日期 2026-11-07。
来源：[官方接口目录](https://developers.notion.com/reference/intro)、[视图](https://developers.notion.com/reference/view)、[用户](https://developers.notion.com/reference/user)。

read_resource 的 kind 及必填参数以当前工具定义为准，可读取单块、页面属性分页、页面 Markdown、工作区成员、数据库视图和数据源模板等。成员信息取决于连接实际授权，不能据此管理用户。

request_write 的其他 operation：

| 操作                                             | targetId    | body |
| ------------------------------------------------ | ----------- | ---- |
| create_database、create_data_source、create_view | 不传        | 必填 |
| update_database、update_data_source、update_view | 目标对象 ID | 必填 |
| delete_view                                      | 视图 ID     | 不传 |
| move_page、update_markdown                       | 页面 ID     | 必填 |

只使用工具已经开放的操作；官方有接口不代表插件已支持。当前不提供文件上传、后台自动同步、用户管理和异步任务轮询。不要要求用户提供密钥，不要通过命令或浏览器私自补一个绕过宿主的写入通道。
