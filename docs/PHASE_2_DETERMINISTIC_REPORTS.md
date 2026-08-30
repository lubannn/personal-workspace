# Phase 2 确定性周报/月报首切片

## 1. 当前范围

首切片在正式 PWA 的当前浏览器内，从已经读取的 Private canonical 记录生成周报/月报事实预览和 CSV：

- 周报按 workspace IANA timezone 的周一至周日；月报按自然月；
- 已完成 Task 以 `completed_at` 在 workspace timezone 的本地日期归属周期；
- 已完成 Milestone 与 Project Activity 同样按各自事实时间归属；
- Calendar 只纳入周期内、未删除且状态为 `confirmed` 的记录；
- Project 显示当前进度快照，并明确来源是手工、Task 事实或 Milestone 权重；
- 每条预览事实保留 canonical ID，CSV 进一步保留 source entity 和 canonical path。

这不是 AI 总结。排序、过滤、计数、时区换算、分钟汇总和 CSV 字段均由纯确定性逻辑完成。

## 2. CSV 契约

CSV 使用 UTF-8 BOM 与 CRLF，面向 Excel 等表格工具。每行包含：

`report_type, period_start, period_end, timezone, fact_type, source_entity, source_id, source_path, project_id, occurred_on, title, status, value, details`

所有单元格均使用双引号并转义内部双引号；以 `=`, `+`, `-`, `@` 开头的值会增加前导单引号，防止表格公式注入。复杂正文不会被塞入 CSV；`details` 只保存短的确定性关联或进度来源。

## 3. 隐私与失败语义

- 生成和下载只在当前浏览器执行；Worker、AI 服务和 Public 代码仓库不接收 Private 正文。
- 当前不创建 `ReportDraft`，不写回 Private GitHub，因此预览是当前 canonical 状态的即时视图，不是永久事实快照。
- 下载失败不改变任何 canonical 记录，也不影响 GitHub 同步状态。
- 被软删除、已取消或已归档的领域记录不会作为当前报告事实展示；Git 历史仍可能保留旧正文。
- Task 的“实际耗时”只汇总现有 `actual_duration_minutes`；没有 Time Entry 时不能伪称为自动计时事实。

## 4. 明确未开放

- ReportDraft canonical 保存、审批、归档与历史快照；
- 个人复盘版/领导汇报版 Markdown 模板；
- AI 润色、PDF、Word 或自动发送；
- Time Entry CSV；当前协议尚无 Time Entry 实体；
- 定时生成或后台同步。

后续若保存 ReportDraft，必须先确定事实快照、引用完整性、export/inspection/restore/migration 和跨设备 SHA 冲突语义，不能把当前即时预览悄悄当作已保存报告。
