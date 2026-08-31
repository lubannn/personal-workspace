# Phase 3A Journal Core 首切片

## 1. 当前范围

首切片把日记作为 `data/journal-entries/<id>.json` 中的 Private canonical 记录接入正式 PWA：

- `entry_kind` 固定为 `daily`，同一 workspace 本地日期只允许一条未删除记录；
- 保存日期、IANA timezone、可选标题/心情/天气和 Markdown 正文；
- `sensitivity = restricted`，正文不进入 Public 仓库、Worker 日志或 AI；
- 创建使用新 ID 和 create-only 路径；编辑递增 record version，并携带最后读取的 blob SHA；
- 删除是可恢复软删除；若同日已有另一条 active daily，恢复会明确拒绝；
- Dashboard “最近日记”只显示有界纯文本摘要；完整正文只在 Journal 区域读取；
- 单篇 Markdown 下载只在当前浏览器生成，保留 canonical ID、日期、时区和 record version；
- JournalEntry 进入开放 JSON export、manifest、inspection、隔离 restore 和 migration dry run。

## 2. 真源与 Obsidian 边界

首版唯一真源是用户控制的 Private GitHub 数据仓库中的 canonical JSON。Markdown 是可读、可迁移的派生文件，不是第二套可写真源。

以下能力明确没有开放：

- 不连接、枚举、扫描或写入真实 Obsidian Vault；
- 不从 Vault 反向覆盖 Workspace；
- 不声称 `sync_status = not_configured` 的记录已经同步；
- 不创建 JournalSegment、JournalRevision 或 SyncConflict；当前修订历史由 record version、blob SHA 和 Git 历史提供；
- 不处理 Legacy Word、不调用 AI、不创建公开分享。

正式连接 Vault 前仍需用户选择 Vault 和子目录，并用无私人内容的文件验证路径、权限、编码、原子替换与冲突语义。

## 3. 时间与唯一性语义

`journal_date` 是用户明确选择的 workspace 本地日期；`created_at` / `first_entry_at` 是首次保存发生的真实 instant，`updated_at` / `last_entry_at` 是最近修订保存的真实 instant。编辑不允许悄悄移动日期，也不伪造旧日记的发生时刻。

唯一性由应用和 export inspection 双重检查：

- 新建前检查当前已加载的 active daily；
- 恢复前检查同日 active daily；
- portable inspection 拒绝同包中的重复 active daily；
- GitHub create-only 路径与旧 blob SHA 仍负责跨设备并发保护。

## 4. 隐私与失败语义

- GitHub API 或网络失败时不做本地“假保存”；页面保留正文并展示错误。
- SHA 冲突不自动覆盖，用户刷新后再决定如何合并。
- 软删除不是擦除；旧正文仍可能存在于 Git 历史和用户已下载的导出中。
- Markdown 下载文件由用户自行安全保管。
- 当前没有正式 Private Journal 写入验收数据；上线后的只读 UI 验收不能替代用户确认后的真实生命周期回归。

## 5. 日期浏览与浏览器内搜索

Journal 列表支持月份前后浏览、回到本月、查看全部日期，以及可与月份组合的关键词搜索。搜索只覆盖 `journal_date`、标题、Markdown 正文、心情和天气；多个以空白分隔的关键词使用 AND 语义，并做 NFKC 与大小写归一化。

当前没有持久化搜索 projection：筛选结果直接从本次已加载的 canonical JournalEntry 在浏览器内派生，不保存到 GitHub、LocalStorage、Worker 或第三方服务。这保证断开连接会随 collection 一起清空，刷新、软删除、恢复或权限变化后会从新的可见记录重新计算，也避免索引文件残留正文。将来若数据量要求引入持久化 projection，必须先定义删除清理、权限收缩、重建和加密/泄露边界。
