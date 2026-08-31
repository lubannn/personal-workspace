# Phase 3 Legacy Journal 正式提交前契约

## 1. 当前状态

本切片实现正式写入前的纯代码安全契约，但没有开放生产 Commit：

- `LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED = false`；
- 不调用 GitHub 写入、不创建正式 Journal、不接触 Obsidian；
- 不读取真实 Word 日记或正式 Private 业务数据；
- 所有行为由脱敏 fixture 和内存 canonical 记录验证。

下一切片只有在持久化 checkpoint、原子批次写入和 UI 动作确认全部闭环后，才可以讨论启用正式写入入口。代码启用也不等于获准写入用户的正式 Private 仓库；每个真实批次仍需动作发生时的精确确认。

## 2. Dry Run 身份 v2

仅使用 `source SHA-256 + parser version + mapping version` 不能区分同一文档的不同人工修正结果。Dry Run manifest 已提升为 v2，并增加完整修正链的 `correction_set_sha256`。

`dry_run_id` 现在同时包含：

- 源文件 SHA-256；
- parser version；
- mapping version；
- 完整有序修正链 SHA-256，包括 action、目标日期/时间、理由、记录时间和 supersedes 链。

因此，同一源文件在修正链改变后会得到不同 Dry Run ID、ZIP 文件名和正式导入批次 ID，避免把两个不同解释误判为幂等重试。

## 3. 确定性 Commit Plan

`buildLegacyJournalCommitPlan` 只接受已通过 Dry Run gate 的 preview、精确 branch HEAD、owner、显式日期选择、计划时间和同一 HEAD 下的现有 Entry/Revision/Segment 集合。

安全限制：

- 每批必须显式选择 1–25 个日期；不默认提交整份多年文档；
- 日期必须存在于当前 preview，选择集合去重并按日期规范排序；
- archive error/blocking、未处理 orphan、非法日期或空 Segment 会阻断；
- 计划只生成文件文本与 SHA-256，不调用任何写接口；
- 所有 planned ID 从 Dry Run 身份与日期确定性派生，重试不会生成另一组 ID；
- 同一计划的文件路径必须唯一。

每个日期生成：

1. 一个 `JournalEntry`，指向 Revision 1；
2. 一个 `content_mode = segments` 的不可变 `JournalRevision`，`created_by = legacy_importer`、`change_reason = legacy_import`；
3. 一个或多个不可变 `JournalSegment`，保留时间、确定性顺序和 `legacy_word` source ref；
4. marker codec 物化正文和逐文件 SHA-256。

有时间的 Legacy Segment 使用日记日期、段落时间和 workspace IANA timezone 转成真实 instant；DST 不存在的墙上时间不得进入计划。来源定位集合如果无法在 canonical `source_locator` 安全上限内完整表达，也会阻断而不是截断。

## 4. 幂等与冲突分类

每个日期只有三种状态：

- `pending`：目标日期和全部确定性 ID 均空闲，可进入未来原子写入；
- `already_imported`：Entry、Revision、完整 Segment 集合、物化正文、hash、creator、reason 和 source ref 全部精确一致；不重复写入；
- `conflict`：同日已有任何 Journal、确定性 ID 只存在一部分、批次来源不一致或 artifact 无法安全构造。

计划允许一个批次中同时出现已完成日期和 pending 日期，支持未来按小批次恢复；只要存在 conflict，整个所选批次就不能 Commit。Metadata 或正文被人工修改后不再视为精确重试。

## 5. Checkpoint 契约

`createLegacyJournalImportCheckpoint` 只接受 `commitReady` 的计划、一个 40 位 commit SHA、commit 时间，以及与 planned files 路径完全一致的写入结果。缺文件、多文件、重复路径、未知路径或非法 blob SHA 一律拒绝。

Checkpoint 记录：

- import batch / Dry Run ID；
- parent 与 committed commit SHA；
- 每日 Entry、Revision、Segment ID；
- Revision content SHA-256；
- Entry 写后 blob SHA。

当前函数只定义并验证 checkpoint 结构；尚未把它作为 Private canonical 文件持久化，也没有正式 batch writer。因此生产 Commit 仍保持关闭。

## 6. 回滚预览

回滚是只读 preview，不执行删除：

- 只计划软删除本批创建且仍为 `version = 1` 的 JournalEntry；
- 不删除或改写不可变 Revision/Segment，明确标记为 retained history；
- Entry 当前 Revision、正文 hash、Segment 集合或 source batch 任一变化都会阻断；
- 导入后出现新 Revision/Segment 或 Entry metadata 编辑时，不允许自动回滚；
- 已经 inactive 的 Entry 标为 `already_inactive`，不重复操作；
- 未来执行时必须使用 checkpoint 对应的最新 Entry blob SHA，并在动作前重查 branch HEAD。

## 7. 下一实现边界

正式 Commit writer 仍需同时完成：

1. 在同一 branch snapshot 下读取 Entry/Revision/Segment 与 checkpoint 目录；
2. 用一个 `writeAtomicFiles` commit 写入所选日期的全部 canonical 记录和持久化 checkpoint；
3. 限制单批文件数、正文总字节和 GitHub API payload；
4. branch advance 时 fail closed，不复用旧计划；
5. UI 明确展示日期、文件数、冲突、目标 Private 仓库和不可逆历史边界；
6. 每个真实批次在动作发生时获得用户精确确认；
7. 用脱敏独立 Private 测试仓库完成创建、精确重试、部分恢复、冲突和回滚验收后，再考虑正式数据。
