# Phase 2 确定性周报/月报首切片

## 1. 当前范围

首切片在正式 PWA 的当前浏览器内，从已经读取的 Private canonical 记录生成周报/月报事实预览和 CSV：

- 周报按 workspace IANA timezone 的周一至周日；月报按自然月；
- 已完成 Task 以 `completed_at` 在 workspace timezone 的本地日期归属周期；
- 已完成 Milestone 与 Project Activity 同样按各自事实时间归属；
- Calendar 只纳入周期内、未删除且状态为 `confirmed` 的记录；
- Project 显示当前进度快照，并明确来源是手工、Task 事实或 Milestone 权重；
- Time Entry 按 `local_date` 归属周期，只汇总未删除的手工分钟事实，并与 Task 上的人工实际耗时分开显示；
- 每条预览事实保留 canonical ID，CSV 进一步保留 source entity 和 canonical path。

这不是 AI 总结。排序、过滤、计数、时区换算、分钟汇总和 CSV 字段均由纯确定性逻辑完成。

第二个切片在同一只读事实对象上增加两种 Markdown 即时草稿：

- 个人复盘版保留概览、完成事项、项目进度、里程碑、日程和 Project Activity；
- 汇报版压缩为交付与完成、项目状态、时间投入和项目动态，并显式要求发送前人工复核；
- 两种模板都在每条事实旁保留 entity type 与 canonical ID；用户标题会做 Markdown 转义，不能改变草稿结构；
- 复制使用浏览器 Clipboard API，若浏览器拒绝则明确报错；Markdown 下载仍只在当前浏览器生成。

## 2. CSV 契约

CSV 使用 UTF-8 BOM 与 CRLF，面向 Excel 等表格工具。每行包含：

`report_type, period_start, period_end, timezone, fact_type, source_entity, source_id, source_path, project_id, occurred_on, title, status, value, details`

所有单元格均使用双引号并转义内部双引号；以 `=`, `+`, `-`, `@` 开头的值会增加前导单引号，防止表格公式注入。复杂正文不会被塞入 CSV；`details` 只保存短的确定性关联或进度来源。

第三个切片补充按实体导出：

- Tasks CSV 覆盖当前读取到的全部 Task，包括软删除记录、完整 envelope、Project/父子关系、生命周期、计划时间、DDL、耗时、tags JSON 和 Private notes Markdown；
- Projects CSV 覆盖全部 Project，包括完整 envelope、生命周期、阶段引用、日期、原始 progress mode 与带来源的派生进度；
- Time Entries CSV 覆盖全部 Time Entry，包括软删除记录、Task/Project 引用、本地日期、时区、分钟、录入方式和 Private notes Markdown；
- 三类实体都按 canonical ID 稳定排序，并保留 `source_path`；多行 Markdown 由标准 CSV quoting 保真；Time Entry 的空开始/结束时间保持为空，不伪造时钟事实。

## 3. 隐私与失败语义

- 生成和下载只在当前浏览器执行；Worker、AI 服务和 Public 代码仓库不接收 Private 正文。
- 预览本身不写回；只有用户明确点击“保存草稿”才会 create-only 创建不可变 `ReportDraft`，并固化来源版本、计数和耗时快照。
- 下载失败不改变任何 canonical 记录，也不影响 GitHub 同步状态。
- 复制或 Markdown 下载失败同样不改变数据；草稿不会自动保存、审批或发送。
- 被软删除、已取消或已归档的领域记录不会作为当前报告事实展示；Git 历史仍可能保留旧正文。
- Task 的“实际耗时”只汇总现有 `actual_duration_minutes`；Time Entry 只汇总手工分钟记录，两者独立展示并禁止双算或伪称自动计时。
- Tasks/Projects/Time Entries CSV 可能包含软删除记录和 Private Markdown 正文，下载后的文件由用户自行安全保管。

## 4. 明确未开放

- ReportDraft 审批、归档、编辑和导出生命周期；
- AI 润色、PDF、Word 或自动发送；
- 运行中计时器、自动计时以及未经事实支持的开始/结束时刻；
- 定时生成或后台同步。

后续若开放 ReportDraft 生命周期变更，必须携带旧 blob SHA 并定义跨设备冲突语义；不能把当前即时预览悄悄当作已保存报告，也不能覆盖既有不可变草稿。
