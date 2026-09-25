# Phase 4 COROS FIT/TCX 本地预检

## 目标

在不连接 COROS 账号、不上传原文件、不写 Private GitHub 的前提下，验证用户主动选择的单个 `.fit` 或 `.tcx` 活动文件是否具备进入后续确定性 mapping 的基本结构。

## 当前能力

- 文件只在当前浏览器读取；最大 64 MiB；
- 计算 SHA-256，并保留安全文件名、字节数和可信时的修改时间；
- FIT：校验头部、声明长度、可选 header/file CRC、definition/data message 边界，统计 Activity、Session 与 Record 消息；
- FIT：通过 Garmin 官方 JavaScript SDK 读取 Session 摘要，并保留 elapsed time 与排除暂停的 timer time；
- TCX：拒绝 `DOCTYPE` / `ENTITY`，要求 `TrainingCenterDatabase` 根元素，统计 Activity、Lap、Trackpoint、运动类型和时间范围；
- 将每个活动映射为只读 `Workout` 候选，统一运动类型、时间、时长、米制距离、热量、心率、步频/踏频与功率摘要；
- `import key = SHA-256(source sha256 + parser version + source activity identity)`；批次身份额外包含 mapping version 与排序后的活动身份；
- 在当前浏览器会话识别重复活动，展示字段映射与 warning/blocking 诊断；
- 为每个非重复候选生成稳定的 `health_staging_record` create-only envelope 计划、目标路径和 payload SHA-256；
- Workout staging 已成为正式 `health_staging_record` 变体，parser、collection、portable export/inspection/restore/migration 与审核 UI 均可处理；
- 明示最小数据策略与未来动作时确认文案；已存在的 Workout staging 可查看或拒绝，但不能更正或确认；
- 诊断明确区分 warning 与 blocking；
- 预检与 mapping 结果固定为 `localOnly: true`、`sourceModified: false`、`commitEnabled: false`；staging plan 标记 `protocolAccepted: true`，但仍固定 `commitEnabled: false`。

## 未开放

- 不解析或保存完整 GPS 轨迹；
- 不生成 `ExternalRawRecord`、Health/Activity staging 或 canonical 记录；`pending` 是已注册的目标形状，但当前预检不会提交它；
- 不做批量导入、后台扫描或目录遍历；
- 不连接 COROS MCP、Partner API 或任何第三方服务；
- 不把结构可读误报为字段已完整映射。

## 下一切片

1. 为 staging 写入增加独立的动作时精确确认、create-only 幂等提交与冲突处理；
2. 注册 canonical `workout` 与 `data/workouts/`，并以单个 Git commit 同时确认 staging 和创建 Workout；
3. staging 审核通过后才生成 canonical Workout；禁止自动确认或从未审核候选驱动 Habit/Recommendation。
