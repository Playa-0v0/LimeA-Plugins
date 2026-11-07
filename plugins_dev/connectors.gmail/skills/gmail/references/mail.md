# 邮件操作

- search_messages 使用 Gmail 搜索语法，例如 `in:inbox is:unread`、`from:alex@example.com newer_than:7d`、`in:sent subject:(Weekly update)`。每次取 1 至 10 条；下一页使用返回的 pageToken。
- get_message 使用 messageId。get_thread 使用 threadId，后续传回 nextOffset 阅读下一组邮件。正文按纯文本处理，附件仅列元数据。
- list_labels 返回当前邮箱标签。change_message 支持 mark_read、mark_unread、star、unstar、archive、move_to_inbox。trash_message 将邮件移入回收站。
- create_draft 与 send_message 都使用 `{to: ["alex@example.com"], subject: "主题", text: "正文"}`。发送以参数中的完整内容为准。已有草稿可在 Gmail 中打开和发送。
- Gmail 返回权限错误时请用户检查当前账号和 LimeA 连接。授权过期时使用插件连接页重新授权。

[Google 搜索和筛选邮件](https://developers.google.com/workspace/gmail/api/guides/filtering) · [发送邮件](https://developers.google.com/workspace/gmail/api/guides/sending) · [处理草稿](https://developers.google.com/workspace/gmail/api/guides/drafts) · [修改标签](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify)
