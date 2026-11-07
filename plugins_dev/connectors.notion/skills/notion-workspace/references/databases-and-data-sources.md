# 数据库与数据源

适用 Notion-Version 2026-03-11；核对日期 2026-11-07。
来源：[查询数据源](https://developers.notion.com/reference/query-a-data-source)、[数据源](https://developers.notion.com/reference/data-source)。

数据库和数据源是不同对象。database(databaseId) 用于取得容器信息和数据源；source(sourceId) 读取具体字段。查询记录用 query_source，而不是旧版数据库查询路径。

query_source 接收 sourceId、filter、sorts、cursor、pageSize。例如已确认存在复选框字段 Done 后，可用 filter={"property":"Done","checkbox":{"equals":false}}。不同类型对应不同筛选字段，先读取属性定义；sorts 在本插件最多 10 项。

新增行就是 create_page：parent.data_source_id 指向数据源，properties 按其真实字段构造。更新行使用 update_page。不要使用数据库 ID 充当数据源 ID。

创建/修改结构使用 request_write：create_database、update_database、create_data_source、update_data_source；更新操作必须带 targetId。body 使用对应接口的当前版本结构，仅修改用户要求的字段。

propertiesIncomplete、propertyIssues、truncated 或遗漏数量意味着结果不完整。关联、人员、公式、汇总等属性可能需要分页或进一步读取，不能把缺失当作空值，更不能用缺失字段覆盖远程数据。
