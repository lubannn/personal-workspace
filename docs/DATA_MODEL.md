# Personal Workspace 数据模型设计

> 状态：Phase 0 概念/逻辑模型已批准  
> 版本：0.2  
> 最后更新：2026-08-25  
> 说明：本文件不等同于数据库迁移；字段类型与索引将在 Phase 1 技术设计中落定。

## 1. 建模原则

- 使用稳定、不暴露业务含义的 ID。
- single-user-first 但核心记录带 `owner_id`，为未来轻量多用户保留隔离边界。
- 时间戳使用 UTC，另存业务时区和本地日期语义。
- 核心实体支持乐观并发版本、软删除和审计。
- 外部原始数据、staging 数据与用户确认后的 canonical 数据分离。
- 多值与关系使用关联实体，不把核心查询依赖逗号字符串。
- JSON 仅用于真正可变的配置、原始快照或低查询需求扩展字段。
- Markdown、附件和导出都必须可由清单和哈希验证。

## 1.1 GitHub 文件持久化决策

逻辑实体保持不变，跨设备 canonical persistence 改为 GitHub 私有数据仓库中的开放文件。每个实体文件至少包含 `schema_version`、`id`、`owner_id`、`version`、时间戳和业务字段；Git blob SHA 作为远端乐观并发 token，不替代领域 `version`。

推荐根目录：

```text
workspace.json
data/<entity-type>/<id>.json
journal/<year>/<id>.md
attachments/<owner-id>/<id>/<original-file>
imports/<batch-id>/...
indexes/<projection>.json
trash/<entity-type>/<id>.json
```

索引文件是可重建 projection，不是唯一数据副本。SQLite 可保留为本地搜索缓存和旧版恢复输入，但不得与 GitHub 文件仓库同时作为可写主真源。

## 2. 通用字段约定

除非实体另有说明，核心实体包含：

| 字段 | 含义 |
|---|---|
| `id` | 全局稳定 ID，建议 UUID/ULID |
| `owner_id` | 数据所有者 |
| `created_at` / `updated_at` | UTC 时间戳 |
| `created_by` / `updated_by` | 用户、系统或集成身份 |
| `version` | 乐观锁版本 |
| `deleted_at` | 软删除时间，可为空 |
| `source_type` | manual、import、integration、derived、ai 等 |
| `source_ref` | 可为空的来源记录引用 |

敏感度建议枚举：`private`、`sensitive`、`shareable`。它描述数据处理级别，不直接等价于发布状态。

## 3. 身份、设置与设备

### User

- `id`, `display_name`, `locale`, `timezone`
- `status`, `created_at`, `updated_at`

### UserPreference

- `owner_id`, `key`, `value_json`, `schema_version`
- 唯一约束：`owner_id + key`

### DeviceSession

- `id`, `owner_id`, `device_label`, `platform`
- `session_fingerprint`, `last_seen_at`, `revoked_at`
- 不保存明文会话令牌。

### DashboardLayout

- `id`, `owner_id`, `name`, `is_default`
- `layout_version`, `breakpoint_config_json`
- GitHub canonical 实现使用 `config/dashboard-layout.json`，额外记录文档 `schema_version`、`version` 与 `updated_at`，写入使用 Git blob SHA 并发保护。

### DashboardWidget

- `id`, `layout_id`, `widget_type`
- `position_json`, `settings_json`, `visibility`
- `privacy_mode`, `enabled`

`widget_type` 使用注册表扩展；不存在的插件模块应保留配置并显示可恢复的占位状态。

首个 GitHub-backed 切片把 Widget 的顺序直接编码为数组顺序，并保存 `size`、`enabled`、`privacy_mode` 与可扩展 `settings`。移动端从同一顺序渲染单列，不维护第二份浏览器私有布局。

## 4. Capture、标签与附件

### Capture

- `id`, `owner_id`, `raw_text`, `captured_at`
- `suggested_type`, `confirmed_type`, `status`
- `target_entity_type`, `target_entity_id`
- `client_idempotency_key`

状态：`inbox`、`processing`、`converted`、`archived`、`failed`。

### Tag

- `id`, `owner_id`, `name`, `normalized_name`, `color`
- 唯一约束：`owner_id + normalized_name`

### EntityTag

- `tag_id`, `entity_type`, `entity_id`, `created_at`
- 唯一约束：`tag_id + entity_type + entity_id`

### Attachment

- `id`, `owner_id`, `storage_provider`, `storage_key`
- `original_filename`, `mime_type`, `size_bytes`, `sha256`
- `classification`, `scan_status`, `created_at`, `deleted_at`

### AttachmentLink

- `attachment_id`, `entity_type`, `entity_id`, `purpose`, `sort_order`

附件删除前需确认不存在有效引用；源导入文件适用更严格保留规则。

## 5. Task

### Task

GitHub-backed canonical 路径为 `data/tasks/<task_id>.json`。每个任务是独立开放 JSON 文件，使用通用记录 envelope；浏览器只保存当前页面状态，不使用 LocalStorage 持久化任务正文。

- `id`, `owner_id`, `title`
- `category_id`：工作、生活、人生是初始配置
- `project_id`，可为空
- `parent_task_id`，可为空
- `status`：inbox、todo、in_progress、blocked、done、cancelled、archived
- `priority`：none、low、medium、high、urgent
- `planned_start_at`, `planned_end_at`
- `due_at`, `due_timezone`, `is_due_date_only`
- `estimated_duration_minutes`, `actual_duration_minutes`
- `notes_markdown`
- `completed_at`, `cancelled_at`
- 通用字段

约束：

- `planned_end_at >= planned_start_at`。
- 完成状态应有 `completed_at`；离开完成状态时保留事件历史，但当前字段清空或重置需有明确规则。
- MVP UI 仅创建一层子任务，数据库禁止自引用和循环。
- `actual_duration_minutes` 可由 TimeEntry 汇总，同时允许记录人工覆盖值及覆盖原因。
- Phase 2A 首个切片只开放创建、今日/逾期聚合、完成和恢复；其余已定义字段保持可导出结构，后续按切片开放 UI。

### TaskCategory

- `id`, `owner_id`, `name`, `code`, `sort_order`, `is_system_default`, `archived_at`

### TimeEntry

- `id`, `owner_id`, `task_id`, `project_id`
- `started_at`, `ended_at`, `duration_minutes`
- `entry_method`, `notes`, `source_ref`

## 6. Project 与报告

### Project

- `id`, `owner_id`, `name`, `description_markdown`
- `status`：planned、active、on_hold、completed、cancelled、archived
- `current_phase_id`, `start_date`, `target_date`, `completed_at`
- `progress_mode`：manual、tasks、milestones
- `manual_progress_percent`
- `visibility_classification`
- 通用字段

### ProjectPhase

- `id`, `project_id`, `name`, `description`, `sort_order`
- `started_at`, `completed_at`, `status`

Phase 2 的首个阶段切片把 `status` 保持为向前兼容的非空字符串，创建时写入 `active`；在阶段完成/取消规则正式定义前，不开放其他状态转换。创建阶段与设置 `Project.current_phase_id` 是两个独立、带 Git 历史的动作，避免一次非原子 Contents 写入伪装成完整成功。

### Milestone

- `id`, `project_id`, `title`, `description`
- `target_date`, `status`, `weight`, `completed_at`, `sort_order`

Milestone 使用 `open`、`completed`、`cancelled` 三种状态；只有 `completed` 必须带 `completed_at`，恢复为 `open` 或取消时清空当前完成时间。默认 `weight = 1`。当 Project 明确选择 `progress_mode = milestones` 时，进度按未删除、未取消里程碑的权重计算；既有项目默认继续使用 `tasks`，不会因创建里程碑自动切换口径。

### ProjectNote

- `id`, `project_id`, `title`, `body_markdown`, `note_date`
- 通用字段

ProjectNote 作为 `data/project-notes/<id>.json` 中的独立 canonical 记录保存，正文为开放 Markdown 字段；编辑沿用同路径 blob SHA 冲突保护与领域版本递增。首个切片开放创建、查看和编辑，不提供删除，避免形成无法从界面恢复的半套回收站。

### ProjectFileReference

- canonical 路径：`data/project-file-references/<id>.json`
- `project_id`, `title`, `source_url`, `purpose`, `sort_order`
- 可选附件元数据：`original_filename`, `mime_type`, `size_bytes`, `sha256`

首个切片只接受不含用户名或密码的 HTTPS 外部文件地址。引用是独立版本化 canonical 记录，Project 只通过 `project_id` 建立关系，不内嵌文件正文。开放导出、inspection、restore 与 migration dry run 包含引用记录，并校验其 Project 必须同包存在。

当前切片不上传、代理、缓存或复制外部文件，也不承诺 URL 长期可用；可选大小、MIME 和 SHA-256 是来源元数据，不等同于工作台已下载并重新验证文件。仓库内 `attachments/` 二进制保存需要单独设计 base64 导出、哈希复验、容量限制与原子恢复语义后再开放。

### ActivityEvent

- `id`, `owner_id`, `entity_type`, `entity_id`
- `event_type`, `occurred_at`, `actor_type`, `actor_id`
- `change_summary_json`, `source_ref`, `schema_version`

ActivityEvent 服务于时间线和报告事实；安全审计使用单独的 AuditEvent。

首个 Project Activity 切片把每条事件保存为 `data/activity-events/<id>.json` 中独立的 canonical 记录，并强制保持 `version = 1`、`deleted_at = null`，不提供编辑或删除入口。时间线只从这一版本上线后的用户操作开始追加，不根据 Git 历史回填旧事件；没有 ActivityEvent 不代表对应领域事实不存在。

当前 GitHub Contents 适配器不能把领域记录和 ActivityEvent 合并成同一原子写入，因此顺序固定为“先提交领域记录，再追加 ActivityEvent”。若第二步失败，页面明确提示主操作已成功但时间线缺失；领域记录和 Git 历史仍是事实权威。ActivityEvent 是产品时间线与报告素材，不承担安全审计职责。

### ReportDraft

- `id`, `owner_id`, `report_type`：weekly、monthly、custom
- `audience`：personal、manager
- `period_start`, `period_end`, `timezone`
- `scope_json`, `facts_snapshot_json`
- `content_markdown`, `generation_method`, `ai_run_id`
- `status`：draft、approved、exported、archived
- `created_at`, `updated_at`

保存事实快照，避免后续任务变化导致旧报告不可解释。

## 7. Calendar

### Calendar

- `id`, `owner_id`, `name`, `color`, `timezone`
- `source_type`：internal、external
- `external_account_id`, `read_only`, `archived_at`

### CalendarEvent

- `id`, `calendar_id`, `owner_id`, `title`, `description_markdown`
- `event_type`：event、time_block、reminder
- `start_at`, `end_at`, `timezone`, `all_day`
- `local_start_date`, `local_end_date`
- `location`, `status`
- `linked_entity_type`, `linked_entity_id`
- `external_uid`, `external_etag`, `sync_status`
- `recurrence_rule`, `recurrence_timezone`
- 通用字段

### Reminder

- `id`, `owner_id`, `entity_type`, `entity_id`
- `trigger_at` 或 `offset_minutes`
- `channel`, `status`, `sent_at`

重复事件的实例展开策略在 Phase 1 设计，必须避免无限物化。

内部 Calendar 首个切片使用保留的 `calendar_id = internal-default`，每条事件保存为 `data/calendar-events/<id>.json`。当前只开放单日、非重复、非全天且带明确起止时间的 `event` / `time_block`；时间同时保存 UTC instant、IANA timezone 和本地日期，避免跨设备把墙上时间误当成浏览器本地时区。

CalendarEvent 可以通过 `linked_entity_type = task` 和 `linked_entity_id` 引用 Task，但事件写入是独立 Git 提交，绝不改写 Task 的 DDL、状态或耗时。开放导出会验证引用的 Task 同包存在。日/周/月读取视图都从同一批 canonical 记录按本地日期范围派生，不另存 projection；现已开放带版本递增和旧 blob SHA 冲突保护的编辑、取消/恢复，以及保留原状态的软删除/恢复。永久删除、提醒、重复、全天事件和外部同步在各自规则完成前不开放。

## 8. Journal 与 Obsidian

### JournalEntry

- `id`, `owner_id`, `journal_date`, `timezone`
- `title`, `body_markdown`, `mood`, `weather`
- `entry_kind`：daily、fragment、legacy
- `first_entry_at`, `last_entry_at`
- `sensitivity`, `current_revision_id`
- `obsidian_document_id`, `sync_status`
- 通用字段

### JournalSegment

- `id`, `journal_entry_id`, `local_time`, `occurred_at`
- `body_markdown`, `sort_order`, `source_ref`

它允许保留旧日记中同一天的多个时间片段。新日记可以只用 `body_markdown`，也可使用 segments；渲染规则必须确定且可逆。

### JournalRevision

- `id`, `journal_entry_id`, `revision_number`
- `body_markdown`, `content_sha256`
- `created_at`, `created_by`, `change_reason`

### ObsidianDocument

- `id`, `owner_id`, `vault_id`, `relative_path`
- `frontmatter_schema_version`, `last_workspace_hash`
- `last_vault_hash`, `last_synced_at`, `sync_direction`
- 唯一约束：`vault_id + normalized relative_path`

### SyncConflict

- `id`, `owner_id`, `resource_type`, `resource_id`
- `base_hash`, `workspace_hash`, `external_hash`
- `workspace_snapshot_ref`, `external_snapshot_ref`
- `status`, `resolution`, `resolved_at`

## 9. Learning

### LearningArea

- `id`, `owner_id`, `name`, `description`
- `area_type`, `icon`, `color`, `status`, `settings_json`
- 通用字段

### LearningGoal

- `id`, `learning_area_id`, `title`, `description`
- `target_date`, `status`, `success_criteria_markdown`

### LearningActivity

- `id`, `learning_area_id`, `goal_id`
- `activity_type`, `title`, `occurred_at`, `duration_minutes`
- `quantity`, `unit`, `notes_markdown`
- `linked_task_id`, `source_ref`

### LearningResource

- `id`, `learning_area_id`, `title`, `resource_type`, `url`
- `notes_markdown`, `status`

领域特有字段放入版本化 `details_json` 前，应先确认其查询和报告需求；常用字段应提升为正式列或子实体。

## 10. Habit

### Habit

- `id`, `owner_id`, `name`, `description`
- `schedule_json`, `timezone`
- `tracking_type`：boolean、count、duration、threshold
- `target_json`, `automation_mode`
- `status`, `start_date`, `end_date`

### HabitRule

- `id`, `habit_id`, `rule_type`, `rule_version`
- `config_json`, `active_from`, `active_to`, `enabled`

### HabitCheckIn

- `id`, `habit_id`, `local_date`, `timezone`
- `status`：completed、missed、skipped、unknown
- `value_json`, `entry_method`：manual、automatic、corrected
- `evidence_type`, `evidence_id`
- `rule_id`, `rule_version`, `evaluated_at`
- `confirmed_at`, `correction_reason`
- 唯一约束通常为 `habit_id + local_date`，多次型习惯可改用独立 occurrence。

早睡的 `local_date` 指“该次主要夜间睡眠开始日”还是“醒来日”必须由用户确认后固定；建议 UI 用“某日晚睡眠”，内部同时记录 sleep session 的精确时间。

## 11. Health 与外部数据

### IntegrationAccount

- `id`, `owner_id`, `provider`, `display_name`, `status`
- `scopes_json`, `token_secret_ref`, `connected_at`, `last_sync_at`
- 令牌只保存密钥管理系统引用，不保存到普通配置或日志。

### ExternalRawRecord

- `id`, `integration_account_id`, `record_type`
- `external_record_id`, `source_created_at`, `fetched_at`
- `payload_encrypted_ref`, `payload_sha256`, `schema_version`
- 唯一约束：`integration_account_id + record_type + external_record_id + source version/hash`

### HealthStagingRecord

- `id`, `owner_id`, `raw_record_id`, `health_type`
- `normalized_json`, `classifier_version`, `classification`
- `confidence`, `status`：pending、confirmed、rejected、superseded
- `diagnostics_json`, `reviewed_at`

### SleepSession

- `id`, `owner_id`, `start_at`, `end_at`, `timezone`
- `session_type`：main_sleep、nap、unknown
- `duration_minutes`, `sleep_metrics_json`
- `confirmation_status`, `staging_record_id`
- `user_adjusted`, `adjustment_reason`

### HealthMetric

- `id`, `owner_id`, `metric_type`
- `measured_at`, `local_date`, `timezone`
- `value`, `unit`, `aggregation_period`
- `confirmation_status`, `staging_record_id`

### Workout

- `id`, `owner_id`, `activity_type`
- `start_at`, `end_at`, `timezone`, `duration_minutes`
- `distance`, `distance_unit`, `training_load`
- `metrics_json`, `confirmation_status`, `staging_record_id`

### TrainingRecommendation

- `id`, `owner_id`, `recommendation_date`, `timezone`
- `input_snapshot_json`, `recommendation_markdown`
- `risk_flags_json`, `ai_run_id`, `status`
- `acknowledged_at`, `expires_at`

## 12. 导入、导出与后台任务

### ImportBatch

- `id`, `owner_id`, `import_type`, `source_attachment_id`
- `source_sha256`, `parser_version`, `mapping_version`
- `status`, `started_at`, `previewed_at`, `committed_at`
- `entry_count`, `warning_count`, `error_count`
- `manifest_attachment_id`, `log_attachment_id`

### ImportStagingEntry

- `id`, `batch_id`, `sequence_number`
- `parsed_year`, `parsed_month`, `parsed_day`, `parsed_time`
- `raw_text_ref`, `normalized_markdown`
- `source_locator_json`, `diagnostics_json`
- `deduplication_key`, `status`, `target_journal_entry_id`

### ExportBatch

- `id`, `owner_id`, `scope_json`, `format_set_json`
- `schema_version`, `status`, `requested_at`, `completed_at`
- `manifest_attachment_id`, `archive_attachment_id`, `expires_at`

### BackgroundJob

- `id`, `owner_id`, `job_type`, `payload_ref`
- `status`, `progress_current`, `progress_total`
- `attempt_count`, `max_attempts`, `last_error_code`
- `scheduled_at`, `started_at`, `finished_at`
- `idempotency_key`

## 13. AI、审计与分享

### AIConsent

- `id`, `owner_id`, `capability`, `scope_json`
- `granted_at`, `expires_at`, `revoked_at`
- 面向单次或明确短期授权，不建议用一个永久总开关覆盖全部私人数据。

### AIRun

- `id`, `owner_id`, `capability`, `purpose`
- `provider`, `model`, `policy_version`, `prompt_template_version`
- `context_manifest_json`：对象引用、字段类别、日期范围、哈希
- `redaction_summary_json`, `started_at`, `completed_at`
- `status`, `output_ref`, `user_action`
- 默认不保存完整敏感 prompt；如用户选择保存，应单独加密并设置保留期。

### AuditEvent

- `id`, `owner_id`, `actor_type`, `actor_id`
- `action`, `resource_type`, `resource_id`
- `occurred_at`, `result`, `ip_or_device_hash`
- `metadata_redacted_json`, `retention_class`

### Publication

- `id`, `owner_id`, `source_entity_type`, `source_entity_id`
- `published_snapshot_ref`, `share_slug`, `status`
- `access_mode`：private_link、invite、public（未来）
- `published_at`, `expires_at`, `revoked_at`, `snapshot_sha256`

Publication 指向经过选择和处理的快照；撤销后公开路径不可继续读取 Private Core。

## 14. 主要关系

```text
User
 ├─ DashboardLayout ─ DashboardWidget
 ├─ Task ─┬─ TimeEntry
 │        └─ Subtask(Task)
 ├─ Project ─┬─ ProjectPhase
 │           ├─ Milestone
 │           ├─ Task
 │           ├─ ProjectNote
 │           └─ ActivityEvent
 ├─ Calendar ─ CalendarEvent ─ Reminder
 ├─ JournalEntry ─┬─ JournalSegment
 │                ├─ JournalRevision
 │                └─ ObsidianDocument ─ SyncConflict
 ├─ LearningArea ─┬─ LearningGoal
 │                └─ LearningActivity
 ├─ Habit ─ HabitRule ─ HabitCheckIn
 ├─ IntegrationAccount ─ ExternalRawRecord ─ HealthStagingRecord
 │                                              ├─ SleepSession
 │                                              ├─ HealthMetric
 │                                              └─ Workout
 ├─ ImportBatch ─ ImportStagingEntry
 ├─ AIRun / AIConsent
 └─ Publication
```

## 15. 索引与完整性建议

- 所有主要列表索引 `owner_id + deleted_at + updated_at`。
- Task 索引 `owner_id + status + due_at`、`project_id + status`。
- Journal 唯一/查询策略基于 `owner_id + journal_date + entry_kind`，是否允许同日多篇由产品决定。
- Calendar 按 `owner_id + start_at + end_at` 查询。
- Staging 按 `owner_id + status + health_type` 查询。
- 外部 ID、幂等键、文件哈希在其业务范围内唯一。
- 多态关联需由应用层和定期一致性检查防止悬空引用。
- 全文索引只存必要字段，删除或权限变化后必须及时同步清除。

## 16. 导出映射

- JSON：每类实体单独集合，保留 ID、关系、schema version 和时间语义。
- CSV：按实体输出，复杂 JSON 字段另附 schema 或拆表。
- Markdown：Journal、Project Notes、Reports 和可读摘要。
- Attachments：保留原文件或可选择排除，始终输出 `attachments.csv/json` 清单与 SHA-256。
- Manifest：导出版本、范围、计数、文件哈希、生成时间、时区和缺失项。

## 17. 待确认的数据决策

1. Journal 默认一天一篇还是允许同日多篇独立文档？
2. Journal 正文的最终真源是数据库还是 Vault，双向同步何时启用？
3. 早睡打卡归属入睡日还是醒来日？
4. 实际耗时以 TimeEntry 汇总为准，还是允许无明细直接填写？
5. 原始健康 payload 和 AI 运行记录各自保留多久？
6. 未来分享采用发布快照还是动态镜像；本方案建议快照优先。
