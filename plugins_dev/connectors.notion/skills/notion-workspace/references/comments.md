# 评论

适用 Notion-Version 2026-03-11；核对日期 2026-11-07。
来源：[创建评论](https://developers.notion.com/reference/create-a-comment)、[评论对象](https://developers.notion.com/reference/comment-object)。

使用 comments(blockId) 读取评论列表，按 nextCursor 分页。

create_comment 参数为 body。对页面发表评论示例：

```json
{
  "body": {
    "parent": { "page_id": "页面ID" },
    "rich_text": [{ "type": "text", "text": { "content": "补充说明" } }]
  }
}
```

回复已有讨论使用 discussion_id，且不同时传 parent。discussion_id 来自真实评论读取结果，不是 page_id 或 comment_id。插入评论权限需要在 Notion 集成后台开启；内容写入许可不等于评论许可。

其他评论操作使用 request_write 的 update_comment 或 delete_comment。targetId 为评论 ID；删除不传 body。服务端会检查当前连接是否允许修改该评论，不要通过更换目标绕过拒绝。
