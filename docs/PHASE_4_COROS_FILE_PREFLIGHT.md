# Phase 4 COROS FIT/TCX 预检与 Workout 暂存

## 目标

在不连接 COROS 账号、不上传原文件的前提下，验证用户主动选择的单个 `.fit` 或 `.tcx` 活动文件是否具备进入后续确定性 mapping 的基本结构。预检本身不写入 Private；用户可以另行确认创建 Workout 暂存摘要。

## 当前能力

- 文件只在当前浏览器读取；最大 64 MiB；
- 计算 SHA-256，并保留安全文件名、字节数和可信时的修改时间；
- FIT：校验头部、声明长度、可选 header/file CRC、definition/data message 边界，统计 Activity、Session 与 Record 消息；
- FIT：通过 Garmin 官方 JavaScript SDK 读取 Session 摘要，并保留 elapsed time 与排除暂停的 timer time；
- TCX：拒绝 `DOCTYPE` / `ENTITY`，要求 `TrainingCenterDatabase` 根元素，统计 Activity、Lap、Trackpoint、运动类型和时间范围；
- 将每个活动映射为只读 `Workout` 候选，统一运动类型、时间、时长、米制距离、热量、心率、步频/踏频与功率摘要；
- `import key = SHA-256(source sha256 + parser version + source activity identity)`；批次身份额外包含 mapping version 与排序后的活动身份；
- 展示字段映射与 warning/blocking 诊断；重复写入以远端稳定路径为准；
- 为每个非重复候选生成稳定的 `health_staging_record` create-only envelope 计划、目标路径和 payload SHA-256；
- Workout staging 已成为正式 `health_staging_record` 变体，parser、collection、portable export/inspection/restore/migration 与审核 UI 均可处理；
- 暂存写入前读取 Private 仓库 HEAD 上的目标路径，逐项跳过相同记录、拒绝不同记录；对新记录展示路径与摘要并要求当次精确确认，以单次非强制 Git commit 创建，不覆盖旧记录；
- 正式 Workout 确认前在同一个 HEAD 核实暂存 blob 未变化、状态仍为 pending、owner 与稳定 ID 匹配，且目标 `data/workouts/` 路径尚不存在；
- portable 导出与检查已识别 canonical Workout 文件，并要求正式记录和已确认暂存记录双向匹配；缺任一方、owner/来源哈希/活动摘要不一致都会阻断检查与恢复计划。旧导出包没有 Workout 计数字段时仍可读取；
- 工作台只展示与已确认暂存记录匹配的正式 Workout；孤立或不匹配的记录不会显示；
- 每条 pending Workout staging 可查看、拒绝或逐条确认，但不可更正来源内容。点击确认会重新核对远端、展示精确清单并要求当次确认；随后通过单个非强制 Git commit 同时更新 staging 与创建 canonical Workout。未确认、拒绝或并发冲突时不写入；
- 合成 TCX 已通过离线全链路回归：本地预检、暂存提交、重复跳过、逐条确认、双文件原子提交、portable 检查和恢复计划；测试同时确认文件名与 GPS 坐标不会进入正式数据；
- 诊断明确区分 warning 与 blocking；
- 预检与 mapping 结果固定为 `localOnly: true`、`sourceModified: false`、`commitEnabled: false`；staging plan 只是本地提案，标记 `protocolAccepted: true`，仍固定 `commitEnabled: false`。写入必须通过独立的动作时确认流程。

## 未开放

- 不解析或保存完整 GPS 轨迹；
- 不生成 `ExternalRawRecord` 或其他 Health/Activity staging；预检不会自动提交 `pending` 或 canonical Workout 记录；
- 不做批量导入、后台扫描或目录遍历；
- 不连接 COROS MCP、Partner API 或任何第三方服务；
- 不把结构可读误报为字段已完整映射。

## 下一切片

1. 使用用户自行选择的真实 FIT/TCX 文件，在部署后的页面做人工验收：先只看预检，再逐项确认暂存、重复选择、拒绝/确认与导出/恢复 dry run；真实 Private 写入必须在每次动作时由用户确认；
2. 保持“staging 审核通过后才生成 canonical Workout”的边界；禁止从未审核候选自动驱动 Habit/Recommendation。
