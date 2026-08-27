# Personal Workspace 路线图

> 状态：Phase 0 已批准；Phase 1A SQLite 基线完成；Phase 1B GitHub-backed PWA 验收通过；Phase 1C 导出预检已验收、Capture 生命周期实现中
> 版本：0.1  
> 最后更新：2026-08-27
> 原则：阶段按“风险被验证且可验收”推进，不用日期承诺替代范围控制。

## 1. 阶段总览

| 阶段 | 目标 | 明确不做 |
|---|---|---|
| Phase 0 | 产品、架构、数据、隐私、设计与专项规格达成共识 | 业务代码、部署、真实数据迁移 |
| Phase 1 | 建立安全可运行的个人核心与数据基础 | COROS 正式接入、公开分享、复杂离线、全量 AI |
| Phase 2 | 打通每日计划与项目闭环 | 外部健康自动化、多用户协作 |
| Phase 3 | 完成 Journal/Obsidian 与历史导入 | 无确认的批量覆盖、不可逆迁移 |
| Phase 4 | 建立 Learning、Habit、Health 确认流 | 医疗诊断、黑箱自动入库 |
| Phase 5 | 上线隐私受控的 AI Assistant | 全库默认访问、自主高影响操作 |
| Phase 6 | 加强导出、分享与可选外部连接 | 企业级组织后台 |

阶段编号表达依赖顺序，可根据真实使用反馈拆分小版本。

## 2. Phase 0：定义与评审（当前阶段）

### 目标

形成足以指导后续原型和技术决策的共同基线，并把未知事项显式列出。

### 交付物

- `PRODUCT_REQUIREMENTS.md`
- `ARCHITECTURE.md`
- `DATA_MODEL.md`
- `PRIVACY_AND_SECURITY.md`
- `DESIGN_SYSTEM.md`
- `ROADMAP.md`
- `JOURNAL_IMPORT_SPEC.md`
- `AI_DESIGN.md`

### 退出标准

- 用户完成文档评审并标记批准、需修改或暂缓的决策。
- Phase 1 的部署、认证、数据库、Vault 模式和 MVP 范围有明确选择。
- 不存在“先开发再决定”的高风险数据所有权或隐私问题。

### 当前禁止项

不创建业务代码、数据库 schema、项目脚手架、云资源或真实数据迁移。

## 3. Phase 1：Foundation & Private Core

### 目标

交付一个只有本人可安全访问、能持久化和导出基础数据的跨设备 Web/PWA 骨架。

### 建议范围

- 应用壳、响应式导航、登录、设备会话和基础设置。
- 关系数据库迁移、文件存储 adapter、审计和后台 Job 基础。
- Dashboard Widget Registry 与可持久化布局基础。
- Quick Capture Inbox 最小流程。
- 附件基础、软删除和回收站。
- JSON 基础导出及 manifest。
- 备份与从空环境恢复验证。
- PWA 应用壳；仅启用有限离线缓存，不承诺完整离线编辑。

### 当前进度（2026-08-27）

- Phase 1B：GitHub App 认证、四设备读写和完整会话生命周期验收完成。
- Phase 1C 首个切片：`workspace.json` + 全部 Capture 的开放 JSON 导出、逐文件 SHA-256 manifest 与浏览器只读恢复预检已实现，并通过 Windows 正式环境与 iPad 验收。
- Phase 1C 第二个切片：Capture 同路径软删除、回收站恢复与 blob SHA 跨设备冲突保护已进入实现和验证。
- 批量恢复写入、schema migration registry 和 Dashboard layout 持久化仍属于 Phase 1C 后续切片。

### 技术验证

- 部署拓扑和各设备访问。
- Obsidian 三种集成模式小型 spike，只验证路径、权限、哈希与冲突。
- iOS PWA 通知、存储生命周期和后台限制。
- Restricted 数据不进入日志的自动/人工检查。

### 退出标准

- 未认证与越权访问测试通过。
- 基础数据写入不依赖 LocalStorage。
- 导出可在独立工具中读取并核对计数。
- 完成一次加密备份恢复演练。
- Mac、Windows、iPhone、iPad 的核心登录/捕捉/查看流程通过。

## 4. Phase 2：Today、Tasks、Projects、Calendar

### 目标

形成从计划、执行到汇报的日常工作闭环。

### 建议范围

- Task 分类、状态、优先级、项目、截止时间、时间区间、标签、一层子任务和耗时。
- Project 阶段、Milestone、进度、Notes、文件和 Activity Log。
- 内部 Calendar 日/周/月视图、时间块和提醒。
- Today Dashboard 的日程、待办、项目进度模块。
- 周报/月报确定性事实汇总与两种模板草稿；AI 润色留到 Phase 5。
- CSV 导出 Tasks、Projects、Time Entries。

### 退出标准

- 今日任务和日程在所有目标设备可用。
- Task 与 Calendar Event 的边界清晰，移动时间块不会意外改写任务 DDL。
- 项目进度显示计算来源。
- 报告中的事实能回溯到任务、里程碑和活动记录。

## 5. Phase 3：Journal、Obsidian 与 Legacy Import

### 目标

让 Workspace 成为可靠的日记入口，并安全迁移历史 Word 日记。

### 建议拆分

#### 3A Journal Core

- Journal 创建、编辑、修订、搜索、最近日记和 Markdown 导出。
- 数据库与 Markdown 序列化契约。
- 同步状态和冲突模型。

#### 3B Obsidian Integration

- 根据 Phase 1 spike 选择的模式实现 Workspace → Vault。
- 原子写入、frontmatter version、哈希校验和冲突 UI。
- 稳定后再评估 Vault → Workspace 双向编辑。

#### 3C Legacy Importer

- Word 只读上传、结构解析、preview、diagnostics、修正、commit、log。
- 先用脱敏的小样本文档建立测试集。
- 分批导入真实数据，批次之间抽样核对和备份。

### 退出标准

- 模拟冲突不造成静默覆盖。
- 同一导入批次重试不产生重复日记。
- 所有未解析内容都能在异常报告或保留块中找到。
- 原 Word 与导入前数据库/Vault 均有可恢复备份。
- 抽样对比日期、时间、段落和 Markdown 渲染通过。

## 6. Phase 4：Learning、Habits 与 Health Staging

### 目标

支持可扩展学习领域、可信习惯记录和健康数据人工确认流程。

### 建议范围

- Learning Area、Goal、Activity、Resource。
- 初始领域配置：韩语、英语、钢琴、羽毛球，但不写死在代码枚举。
- Habit 定义、规则版本、手工/自动 check-in 和 Heatmap。
- 手工睡眠记录和早睡/早起规则。
- Health staging、确认/拒绝/更正与数据来源展示。
- COROS 可用性验证；若无稳定合规接口，保留文件导入/手工录入 adapter，不采用脆弱抓取作为核心依赖。
- 运动记录和规则型建议的初版。

### 退出标准

- Learning 新增领域无需改业务代码。
- 自动习惯打卡可解释、可更正，规则版本可追溯。
- 未确认 COROS 数据不会进入 canonical health 表或触发正式打卡。
- 夜间睡眠与小睡的异常案例有人工处理路径。

## 7. Phase 5：AI Assistant

### 目标

在用户主动请求、最小上下文和草稿确认机制下提供“G 老师”式辅助。

### 推荐上线顺序

1. 当前页面摘要与复盘提问。
2. 项目周报/月报润色，事实由系统确定性收集。
3. 日记共创与阶段复盘。
4. 学习分析与今日计划建议。
5. 基于已确认数据的运动建议。

### 基础能力

- Capability Policy、Context Manifest、Provider Adapter。
- 发送前数据范围预览和脱敏。
- 输出草稿、来源引用、保存/应用/丢弃。
- AI Run 最小审计与可配置保留。
- prompt injection 防护与不可信内容边界。

### 退出标准

- 每个 AI 能力都有明确允许/禁止数据、输出限制和失败路径。
- 抽样证明实际发送内容不超出 context manifest。
- AI 不可直接发布、删除或写入正式健康结论。
- 用户可不用 AI 完成所有核心流程。

## 8. Phase 6：Portability、Sharing 与 Integrations

### 目标

加强可迁移性，并在不打开 Private Core 的前提下支持少量分享和外部连接。

### 建议范围

- 完整 JSON/CSV/Markdown/附件索引导出与恢复导入。
- 导出格式版本和迁移工具。
- Publication 快照、预览、有效期、撤销和访问日志。
- 外部 Calendar 只读接入，再评估双向同步。
- 可选的朋友邀请和私人链接。
- 自托管迁移文档与恢复演练自动化。

### 退出标准

- 从完整导出在空环境恢复核心关系和附件。
- 撤销分享后源数据不再可通过公开路径访问。
- 外部集成断开后核心功能继续运行。

## 9. 跨阶段质量轨道

每阶段都持续执行：

- 数据迁移、导出兼容和回滚设计。
- 对象级授权、敏感日志和依赖安全检查。
- 备份恢复演练。
- 多设备、时区、跨午夜和离线/弱网测试。
- 可访问性和键盘操作检查。
- 用户文档与决策记录更新。
- 性能基线与错误可观测性。

## 10. 优先级方法

功能按以下顺序评估：

1. 是否保护数据完整性和隐私。
2. 是否直接降低每日记录与计划摩擦。
3. 是否建立其他模块依赖的基础。
4. 是否能在不锁定供应商的情况下演进。
5. 是否有可验证的真实使用价值。

外部集成、复杂 AI 和分享均不得早于其安全边界与数据来源成熟。

## 11. 主要风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 范围过大 | 长期无法形成可用闭环 | 按 Phase 和垂直切片验收，先 Today/Tasks/Journal |
| Obsidian 双向冲突 | 日记覆盖或丢失 | 先单向、revision/hash/conflict、真实样本测试 |
| COROS 接口不稳定/不可用 | 健康自动化受阻 | adapter + staging；手工/文件导入可替代 |
| 十多年 Word 格式不一致 | 错误日期、内容遗漏 | 只读原件、preview、diagnostics、分批 commit、抽样 |
| AI 过度读取 | 隐私泄露 | capability policy、context manifest、显式请求、最小化 |
| PWA 被期望成完整原生/离线 App | 体验落差 | 首发明确有限离线，验证 iOS 限制后扩展 |
| 单用户设计演变成隐式多用户 | 越权风险 | Publication 隔离；多用户前专项授权改造 |
| 自托管维护成本 | 更新与备份失败 | 简单拓扑、标准存储、自动健康检查与恢复文档 |

## 12. Phase 0 评审清单

请人工逐项确认：

- [ ] 产品原则和非目标符合预期。
- [ ] 首个可用闭环的优先级正确。
- [ ] 推荐的“模块化单体 + 关系数据库 + 文件存储”可接受。
- [ ] Obsidian 先单向安全同步、再评估双向同步可接受。
- [ ] COROS 必须 staging → 用户确认 → canonical 的边界可接受。
- [ ] AI 必须主动请求、最小上下文、输出草稿的边界可接受。
- [ ] Share Layer 使用独立发布快照可接受。
- [ ] 待确认问题已有答案或明确延后。
- [ ] 批准后才允许创建 Phase 1 技术实施计划与代码。
