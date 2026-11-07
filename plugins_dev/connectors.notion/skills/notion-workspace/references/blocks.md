# 内容块

适用 Notion-Version 2026-03-11；核对日期 2026-11-07。
来源：[追加子块](https://developers.notion.com/reference/patch-block-children)、[更新块](https://developers.notion.com/reference/update-a-block)。

append_blocks 接收 blockId 和 children。页面 ID 也可作为父块 ID。示例：

```json
{
  "blockId": "目标页面或块ID",
  "children": [
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "本次学习总结" } }] }
    }
  ]
}
```

方法与路径由插件确定；不要手填 POST，追加子块的官方方法是 PATCH。工具中也无需填写 PATCH。

children 最多 100 个；单个 text.content 最多 2000 字符；整个写入请求体须在插件 24000 字节限制内。较长内容分成合理段落，不能在失败后不加判断地重新提交整个批次。

更新已有块使用 request_write：operation=update_block，targetId=块ID，body 为对应块类型的字段。先读该块，确认实际类型；例如段落 body 包含 paragraph.rich_text。删除块使用 operation=trash_block、targetId，不提供 body。

children 只返回一层。需要下层内容时，使用结果中 hasChildren 的块 ID 继续读取；分页要传 nextCursor。不要把一个列表页当作完整页面。
