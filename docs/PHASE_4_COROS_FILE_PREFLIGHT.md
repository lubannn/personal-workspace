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
- 明示最小数据策略与未来动作时确认文案；当前 parser 不接受拟议 Workout staging，协议和提交能力保持关闭；
- 诊断明确区分 warning 与 blocking；
- 预检、mapping 和 staging plan 结果固定为 `localOnly: true`、`sourceModified: false`、`protocolAccepted: false`、`commitEnabled: false`。

## 未开放

- 不解析或保存完整 GPS 轨迹；
- 不生成 `ExternalRawRecord`、Health/Activity staging 或 canonical 记录；`pending` 仅描述候选目标形状；
- 不做批量导入、后台扫描或目录遍历；
- 不连接 COROS MCP、Partner API 或任何第三方服务；
- 不把结构可读误报为字段已完整映射。

## 下一切片

1. 同步扩展 Health staging parser、collection、portable export/inspection/restore/migration 和 UI 审核，使拟议 envelope 成为正式协议；
2. 为 staging 写入增加独立的动作时精确确认、create-only 幂等提交与冲突处理；
3. 注册 canonical `workout` 与 `data/workouts/`，并以单个 Git commit 同时确认 staging 和创建 Workout；
4. staging 审核通过后才生成 canonical Workout；禁止自动确认或从未审核候选驱动 Habit/Recommendation。
