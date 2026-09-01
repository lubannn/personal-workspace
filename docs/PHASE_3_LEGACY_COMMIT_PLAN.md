# Phase 3 Legacy Journal 正式提交前契约

## 1. 当前状态

当前已实现正式写入前的安全契约、canonical checkpoint 和低层原子 writer，但没有开放生产 Commit：

- `LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED = false`；
- 正式 PWA 没有导入写入入口，不创建正式 Journal、不接触 Obsidian；
- 不读取真实 Word 日记或正式 Private 业务数据；
- 所有行为由脱敏 fixture 和内存 canonical 记录验证。

低层 writer 只由脱敏内存 adapter 测试覆盖。下一切片只有在 UI 动作确认、脱敏 Private 演练和恢复边界全部闭环后，才可以讨论启用正式写入入口。代码启用也不等于获准写入用户的正式 Private 仓库；每个真实批次仍需动作发生时的精确确认。

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

运行时 Checkpoint 记录：

- import batch / Dry Run ID；
- parent 与 committed commit SHA；
- 每日 Entry、Revision、Segment ID；
- Revision content SHA-256；
- Entry 写后 blob SHA。

持久化的 `JournalImportCheckpoint` 位于 `data/journal-import-checkpoints/<id>.json`，与全部本批 Entry/Revision/Segment 通过同一个 `writeAtomicFiles` commit 创建。它保存 source/correction/plan SHA-256、精确 parent HEAD、日期、实体 ID 和 planned file SHA-256。它不保存包含自身的 commit SHA，避免 commit 内容与 commit SHA 形成循环引用；实际 resulting commit SHA 由 writer 返回，Git 历史可定位包含该记录的 commit。

Checkpoint 是 create-only canonical 实体，已进入 collection loading、portable export、inspection、隔离 restore 和 migration dry run。inspection 会验证其 owner、路径、引用实体、日期、Revision hash、Segment 来源批次和 planned file 集合。

## 6. 原子批次 Writer

`writeLegacyJournalBatchAtomically` 会重新读取精确 branch snapshot，并在该 commit ref 下加载 Entry、Revision、Segment 与 Checkpoint collection。它会重算每个 planned file 的 SHA-256、解析所有 canonical artifact、验证 owner/日期/ID/关系与远端空闲状态，并执行以下 fail-closed gate：

- plan HEAD 与当前 HEAD 不一致时停止；
- 远端出现同日 active Entry、任一 planned ID 或 checkpoint ID 时停止；
- 单批最多 249 个业务文件，加一个 checkpoint 后最多 250 个原子文件；
- 单批 UTF-8 payload 最多 10 MiB；
- ref 更新冲突时不执行第二次或降级的部分写入。

全部业务记录与 checkpoint 只调用一次 `writeAtomicFiles`。运行时结果返回 commit/tree SHA、业务 blob SHA 和 checkpoint blob SHA。`LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED` 仍为 `false`，PWA 没有调用此 writer。

## 7. 回滚预览

回滚是只读 preview，不执行删除：

- 只计划软删除本批创建且仍为 `version = 1` 的 JournalEntry；
- 不删除或改写不可变 Revision/Segment，明确标记为 retained history；
- Entry 当前 Revision、正文 hash、Segment 集合或 source batch 任一变化都会阻断；
- 导入后出现新 Revision/Segment 或 Entry metadata 编辑时，不允许自动回滚；
- 已经 inactive 的 Entry 标为 `already_inactive`，不重复操作；
- 未来执行时必须使用 checkpoint 对应的最新 Entry blob SHA，并在动作前重查 branch HEAD。

## 8. 下一实现边界

生产入口仍需同时完成：

1. UI 明确展示日期、文件数、字节数、冲突、目标 Private 仓库和不可逆 Git 历史边界；
2. 使用完整仓库名与精确日期范围进行动作确认，且每个真实批次在动作发生时获得用户确认；
3. 网络结果不确定时先只读重载 checkpoint/实体状态，禁止盲目重试；
4. 用脱敏独立 Private 测试仓库完成创建、精确重试、部分恢复、并发冲突和回滚验收；
5. 上述验收完成后，才能单独评审是否把生产 gate 改为 true；正式业务数据仍需逐批确认。
