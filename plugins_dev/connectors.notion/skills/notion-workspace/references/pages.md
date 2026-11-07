# 页面

适用插件 2.1，Notion-Version 2026-03-11；核对日期 2026-11-07。
来源：[创建页面](https://developers.notion.com/reference/post-page)、[更新页面](https://developers.notion.com/reference/patch-page)。以下是插件适配示例，不是完整官方接口说明。

create_page 的参数是 body。例如在已有页面下创建子页面：

```json
{
  "body": {
    "parent": { "page_id": "已有页面ID" },
    "properties": {
      "title": { "type": "title", "title": [{ "type": "text", "text": { "content": "学习记录" } }] }
    }
  }
}
```

父对象是页面时，只使用 title 属性。父对象是数据源时，先用 source 取得真实属性名称及类型；parent 使用 data_source_id，properties 按实际字段构造。不要猜测字段必然叫 Name 或 Status。

update_page 接收 pageId 和 body，只提交需要改动的字段。将页面移入回收站使用 body.in_trash=true；恢复使用 false。正文追加用 append_blocks，不是修改 properties。

其他操作通过 request_write：move_page 传 targetId 和目标 parent；update_markdown 传 targetId 与当前接口要求的 body。更新 Markdown 前先通过 read_resource 的 markdown 读取现有内容，按该版本规则构造修改，不假定整页替换总是正确。只支持同步请求，不能设 allow_async=true。

此插件不提供文件上传。外部图片和附件仍受宿主目标及大小限制。模板可能在创建返回后继续异步展开；返回页面 ID 不代表模板内容已经全部生成，应读取核对，不要重新创建页面。
