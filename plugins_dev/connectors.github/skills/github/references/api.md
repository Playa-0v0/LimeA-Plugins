# GitHub REST 接口参考

使用当前官方 API 语义。read 接收 `{path, query?}`，query 的值为字符串。write 接收 `{method, path, body?}`。owner/repo 用真实仓库名替换。路径段需 URI 编码。每页 1 至 30 条，通过 page 翻页，绝不直接把返回的任意链接作为令牌目的地址。

目录读取在插件内按 page/per_page 分页，data 只返回名称、路径、类型、sha、大小和网页地址；使用 directory.nextPage 继续读取。directory.totalCount 是本次服务端返回的条目数；mayBeIncomplete 为 true 表示达到 GitHub 单目录 1000 项上限，不能宣称目录已全部读取。文件内容保持完整，单文件超过工具输出预算时明确失败。

| 目标 | 方法与路径 | 参数要点 |
| --- | --- | --- |
| 当前账号 | GET /user | 无 |
| 已安装账号 | GET /user/installations | page、per_page |
| 安装中的仓库 | GET /user/installations/INSTALLATION_ID/repositories | page、per_page |
| 搜索仓库、议题、代码、提交 | GET /search/repositories、/search/issues、/search/code、/search/commits | q，例如 repo:owner/repo is:issue is:open |
| 仓库信息 | GET /repos/owner/repo | 确认 default_branch |
| 目录与文件 | GET /repos/owner/repo/contents/path | ref 可指定分支。文件 content 可能是 base64，sha 是更新依据 |
| 议题、拉取请求列表 | GET /repos/owner/repo/issues、/repos/owner/repo/pulls | state、page、per_page。issues 可能同时包含拉取请求 |
| 议题详情与评论 | GET /repos/owner/repo/issues/NUMBER、/issues/NUMBER/comments | 仓库前缀同上 |
| 拉取请求详情、改动、提交、审查 | GET /repos/owner/repo/pulls/NUMBER 及 /files、/commits、/reviews、/comments | 按需分别查询 |
| 创建议题 | POST /repos/owner/repo/issues | title、body，可选 labels、assignees |
| 修改议题 | PATCH /repos/owner/repo/issues/NUMBER | title、body、state、labels、assignees |
| 发表评论 | POST /repos/owner/repo/issues/NUMBER/comments | body。拉取请求的普通评论也用此路径 |
| 创建拉取请求 | POST /repos/owner/repo/pulls | title、head、base、body，可选 draft |
| 修改拉取请求 | PATCH /repos/owner/repo/pulls/NUMBER | title、body、state、base |
| 提交审查 | POST /repos/owner/repo/pulls/NUMBER/reviews | body、event（COMMENT、APPROVE、REQUEST_CHANGES） |
| 合并拉取请求 | PUT /repos/owner/repo/pulls/NUMBER/merge | sha、merge_method。按用户明确选择合并 |
| 创建或更新文件 | PUT /repos/owner/repo/contents/path | message、content（base64）、branch，更新时必须带 sha |
| 删除文件 | DELETE /repos/owner/repo/contents/path | message、sha、branch。明确核对用户要求 |
| 创建分支 | POST /repos/owner/repo/git/refs | ref 如 refs/heads/feature-name，sha 为基础提交 |
| 读取分支和提交 | GET /repos/owner/repo/branches、/commits，或各自 /NAME、/SHA | 使用 GitHub 返回的真实引用 |
| 查看发布 | GET /repos/owner/repo/releases，或 /releases/latest | 读取已有发布以避免重复 |
| 创建发布 | POST /repos/owner/repo/releases | tag_name、target_commitish、name、body、draft、prerelease |
| 修改发布 | PATCH /repos/owner/repo/releases/ID | 按官方字段修改 |
| 工作流及运行 | GET /repos/owner/repo/actions/workflows、/actions/runs、/actions/runs/ID/jobs | 返回运行及步骤状态，尚不下载日志 |
| 触发工作流 | POST /repos/owner/repo/actions/workflows/WORKFLOW_ID/dispatches | ref、inputs，需工作流支持 workflow_dispatch |
| 重跑或取消 | POST /repos/owner/repo/actions/runs/ID/rerun 或 /cancel | 请求成功表示已接受，再读取运行核对 |
| 创建仓库 | POST /user/repos 或 /orgs/OWNER/repos | name、description、private、auto_init，需要用户明确要求 |

[GitHub REST 官方文档](https://docs.github.com/en/rest) · [文件接口](https://docs.github.com/en/rest/repos/contents) · [拉取请求](https://docs.github.com/en/rest/pulls/pulls) · [自动化运行](https://docs.github.com/en/rest/actions/workflow-runs)
