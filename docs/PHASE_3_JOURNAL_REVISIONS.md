# Phase 3A Journal Segment / Revision 契约

## 1. 状态与边界

当前代码已增加 JournalSegment / JournalRevision canonical 读取、collection loading、完整 portability，以及单 Git commit 原子事务引擎。生产开关 `JOURNAL_REVISION_WRITES_ENABLED` 仍固定为 `false`，现有 Journal 编辑 UI 尚未调用事务，因此本切片不会触发 Private 写入。当前已发布记录继续使用 `JournalEntry.body_markdown`，且 `current_revision_id = null` 是合法兼容状态。

本切片明确不做：

- 不迁移或重写既有 JournalEntry；
- 不创建正式 JournalSegment、JournalRevision 或测试日记；canonical 支持只用本地 fixture 验证；
- 不连接或写入 Obsidian Vault；
- 不解析真实 Legacy Word；
- 不把正文、segment marker 或 source locator 写入 Public 数据、日志、搜索 projection 或第三方服务。

## 2. 不可变记录

JournalSegment 和 JournalRevision 都是 create-only 快照。应用不得原地修改或删除历史 Segment/Revision；软删除 JournalEntry 也不擦除历史。内容变更必须创建新的 Revision，必要时创建新的 Segment，然后由 JournalEntry 指向新的 current revision。

canonical 路径分别是 `data/journal-segments/<id>.json` 和 `data/journal-revisions/<id>.json`。两类记录都必须保持 `version = 1`、`deleted_at = null`、`updated_at = created_at`；任何原地更新或软删除都会被解析器拒绝。

JournalSegment 字段：

- `id`, `journal_entry_id`
- `local_time`、`occurred_at`：二者同时为空，或使用有效本地 `HH:mm` 与带偏移 instant；父记录日期/时区一致性在 canonical entity 校验层检查
- `body_markdown`, `sort_order`
- `source_ref`：仅允许 `legacy_word + import_batch_id + source_locator`，不得保存绝对文件路径

JournalRevision 字段：

- `id`, `journal_entry_id`, `revision_number`
- `content_mode`：`body` 或 `segments`
- `body_markdown`：该 revision 的完整确定性物化正文，用于兼容读取、搜索、导出和恢复
- `segment_ids`：`segments` 模式下按渲染顺序保存；`body` 模式为空
- `content_sha256`
- `created_at`, `created_by`, `change_reason`

`change_reason` 只允许 `initial_create`、`manual_edit`、`segment_restructure`、`legacy_import`、`legacy_import_correction`、`sync_conflict_resolution`、`schema_migration`。restore 只改变生命周期状态而不改变正文，不伪装成内容 revision。

## 3. 原子推进

`journal-revision-transactions.ts` 已把一次内容保存实现为同一个 Git Data API commit：

1. 校验当前分支 HEAD、JournalEntry blob SHA 与旧 `current_revision_id`；
2. create-only 写入新 Segment（如有）和新 Revision；
3. 将 JournalEntry 的 `body_markdown` 更新为同一 revision 的物化正文，递增 record version，并推进 `current_revision_id`；
4. 只用一个 tree/commit 更新分支引用。

事务先取得 branch HEAD/root tree，再按该 commit SHA 一致读取 Entry 与 Revision 基线；不会把来自两个不同 HEAD 的目录和文件拼成一个判断。底层写入返回每个新 blob SHA，并用旧 HEAD 作为唯一 parent、`force = false` 推进 branch ref。若其他设备先推进 HEAD，GitHub 拒绝非 fast-forward 更新；blob/tree/commit 即使已经创建也保持不可达，不会出现可见半套状态。

新建 Journal 会在同一 commit 中创建 JournalEntry 与 revision 1。旧 `current_revision_id = null` 记录第一次修改正文时，会先以 `migration/schema_migration` 保存旧正文 baseline，再以 `owner/manual_edit` 保存新正文并推进指针；两个 Revision 与更新后的 Entry 同 commit 可见。仅修改标题、心情或天气时只原子更新 Entry，不创建内容相同的冗余 Revision。

任一步校验失败都不得推进分支引用。事务会拒绝旧 blob SHA、旧 pointer、重复 ID/序号、路径错位、owner 错位、hash 篡改、物化正文不一致和非最新 current pointer。并发冲突必须停止并要求重新读取，不能自动覆盖。

## 4. 可逆 Markdown codec

`journal-segment-codec.ts` 提供纯函数契约证明：

- 文档根 marker 固定为 `pw-journal-segments:v1`；每段使用 `pw-journal-segment:v1` metadata marker 和精确 end marker；
- metadata 使用 UTF-8 JSON 的 base64url 编码，键和值由 codec 规范化，输出不依赖输入数组顺序；
- 每段显示 `## HH:mm` 或 `## 未记录时间`，但时间与顺序的权威值来自 marker；
- 正文中所有可能被误判为保留 marker 的行会增加一个转义反斜杠，解析时只移除 codec 增加的那一个；
- CRLF 规范化为 LF，正文首尾空白按 canonical body 规则归一化；
- 重复 ID、重复 sort order、父记录不匹配、篡改标题、非法时间/来源和序列化顺序变化都必须拒绝。

该 Markdown 是受限数据的可迁移派生物，不是公开格式，也不是第二个可写真源。任意 `parse(render(segments))` 必须得到规范化后的同一组 segments；`render(parse(markdown))` 必须得到同一 canonical 文档。

## 5. 兼容读取与搜索

- `current_revision_id = null`：继续读取 JournalEntry 的 `body_markdown`，不强制迁移；
- `content_mode = body`：Revision 的物化正文等于 JournalEntry `body_markdown`；
- `content_mode = segments`：由 segments 确定性渲染，结果必须同时写入 Revision 与 JournalEntry 的物化正文；
- 月份浏览和关键词搜索始终读取 JournalEntry 的当前物化字段，不按列表查询 fan-out 所有 Revision/Segment；
- 导出、inspection、隔离 restore 和 migration dry run 必须与 canonical entity 支持在同一发布切片启用，不能先开放写入再补可移植性。

当前 inspection 已同时验证 owner、路径、父 JournalEntry、唯一 ID、同父记录 sort order / revision number、Segment 顺序与引用、物化正文 SHA-256、`current_revision_id`、最新 revision 和 JournalEntry 当前正文一致性。旧 export v1 若不含 Segment/Revision 计数字段仍保持可读。

## 6. 后续启用顺序

1. 已完成：增加 JournalSegment/JournalRevision canonical entity、路径、collection loading、校验和 portability 支持；
2. 已完成：增加精确 commit 基线读取、单 commit Revision 原子推进、旧正文 baseline，以及并发/篡改/半套状态测试；生产开关保持关闭；
3. 下一步：代码审查与发布后，单独启用 Journal UI 的原子创建/编辑路径，并保持生命周期操作不伪造内容 Revision；
4. 用脱敏 fixture 验证 Legacy Word preview，禁止接触真实原件；
5. 再定义 Obsidian frontmatter、原子写入、hash/conflict 和单向导出；
6. 经过明确授权后，才用正式 Private 数据执行创建、编辑、冲突、导出和恢复验收。
