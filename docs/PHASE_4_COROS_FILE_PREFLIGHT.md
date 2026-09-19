# Phase 4 COROS FIT/TCX 本地预检

## 目标

在不连接 COROS 账号、不上传原文件、不写 Private GitHub 的前提下，验证用户主动选择的单个 `.fit` 或 `.tcx` 活动文件是否具备进入后续确定性 mapping 的基本结构。

## 当前能力

- 文件只在当前浏览器读取；最大 64 MiB；
- 计算 SHA-256，并保留安全文件名、字节数和可信时的修改时间；
- FIT：校验头部、声明长度、可选 header/file CRC、definition/data message 边界，统计 Activity、Session 与 Record 消息；
- TCX：拒绝 `DOCTYPE` / `ENTITY`，要求 `TrainingCenterDatabase` 根元素，统计 Activity、Lap、Trackpoint、运动类型和时间范围；
- 诊断明确区分 warning 与 blocking；
- 预检结果固定为 `localOnly: true`、`sourceModified: false`、`commitEnabled: false`。

## 未开放

- 不解析或保存完整 GPS 轨迹；
- 不生成 `ExternalRawRecord`、Health/Activity staging 或 canonical 记录；
- 不做批量导入、后台扫描或目录遍历；
- 不连接 COROS MCP、Partner API 或任何第三方服务；
- 不把结构可读误报为字段已完整映射。

## 下一切片

1. 定义活动 canonical 与 staging 字段映射；
2. 用脱敏 FIT/TCX fixtures 覆盖跑步、骑行、无轨迹活动和重复文件；
3. 基于 `source sha256 + parser version + source activity identity` 生成稳定批次身份；
4. 先展示 mapping/dedup dry run，再单独设计 Private 写入与动作时确认。
