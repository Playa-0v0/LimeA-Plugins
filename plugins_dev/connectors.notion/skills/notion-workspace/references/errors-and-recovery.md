# 错误与核对

适用插件 2.1；核对日期 2026-11-07。
来源：[状态码](https://developers.notion.com/reference/status-codes)、[连接能力](https://developers.notion.com/reference/capabilities)。

| 错误                                                 | 意义与处理                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| plugin-tool-invalid-input / connection-invalid-write | 本地参数校验失败，请求尚未发出；按工具定义纠正字段，不把它解释成未授权 |
| connection-write-rejected                            | Notion 明确拒绝请求格式；重新核对对应操作的参数，不盲试其他路径        |
| connection-capability-denied                         | 服务端未允许该能力；提示用户检查集成能力或页面共享范围                 |
| connection-object-unavailable                        | 对象不存在或当前连接不可访问；核对 ID 和共享范围                       |
| connection-reauthorization-required                  | 账号授权失效，需要重新连接                                             |
| connection-rate-limited                              | 服务端限流；稍后再尝试，不高频循环                                     |
| connection-write-in-progress                         | 当前操作未发送，其他写入仍在执行或等待核对                             |
| connection-write-unknown                             | 操作可能已经生效；先读取目标核对，不能自动重新执行                     |

审批拒绝不是参数问题，不要换工具继续同一写入。完全访问下不再额外要求用户批准普通写入。

写入结果未知时，宿主保留记录，用户可在插件详情核对并解除阻断。描述已确认的事实，不把“没有收到结果”说成“没有写进去”。目标不唯一或无法证明结果时保持未知。

分页读取出现截断或不完整标记时缩小读取范围、按页继续；插件返回文本不是所有附件和所有属性的完整副本。
