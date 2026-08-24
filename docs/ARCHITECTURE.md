# Personal Workspace 架构设计

> 状态：Phase 0 已批准  
> 版本：0.2  
> 最后更新：2026-08-25

## 1. 架构目标

架构需要同时满足：跨设备 Web/PWA、single-user-first、用户数据可迁移、隐私默认收紧、外部服务可替换，以及未来少量分享能力。

本文件描述逻辑架构与推荐基线，不在 Phase 0 锁定具体框架或云厂商。

## 2. 关键架构决策

### ADR-001：模块化单体优先

首个版本采用模块化单体，而不是微服务。

理由：单用户规模不需要分布式复杂度；统一事务更适合任务、日历、习惯和日志之间的关联；未来仍可按模块边界拆出导入、AI 或连接器工作进程。

### ADR-002：服务端数据库是结构化数据真源（被 ADR-007 取代）

结构化业务数据以关系数据库为主真源。浏览器 LocalStorage/IndexedDB 只用于应用壳、临时草稿、离线队列和可安全重建的缓存，不能成为核心数据的唯一副本。

Journal 正文同时具有数据库记录和 Markdown 表示；具体“正文真源”需在 Phase 1 技术验证后最终确认，默认建议数据库负责事务与索引，Vault Markdown 负责用户可读副本和长期可迁移性。

该方案已经完成本地可运行基线，保留为恢复和未来自托管选项。2026-08-25 用户明确选择 GitHub 私有仓库存放全部数据并要求 Mac 关机后仍可使用，因此跨设备主真源改由 ADR-007 定义。

### ADR-003：文件与对象存储抽象

附件、导出包、导入原件和生成文件通过 Storage Adapter 访问。开发环境可使用本地文件系统，部署环境可选择用户控制的 S3 兼容对象存储，不让业务层依赖单一厂商。

### ADR-004：同步采用显式版本和冲突对象

数据库与 Obsidian、外部日历或健康来源之间不做无条件最后写入覆盖。每次同步携带内容哈希、版本、来源时间和基线版本；无法安全合并时创建冲突，等待用户处理。

### ADR-005：Private Core 与 Share Layer 分离

分享不是给私人记录增加一个简单公开标志。Share Layer 保存明确选择、转换或发布的内容及其发布状态；公开读取路径不直接查询日记、健康或 AI 分析主表。

### ADR-006：异步工作通过 Job Queue

Word 解析、Markdown 批量生成、导出、全文索引、外部同步和 AI 长任务使用后台 Job。Job 必须幂等、可重试、有进度、有错误摘要。

### ADR-007：静态 PWA + GitHub 私有数据仓库

目标形态改为可部署到 GitHub Pages 的静态 PWA。GitHub 私有数据仓库保存全部 canonical 文件，包括日记、健康、任务、附件和导入原件；用户已明确接受这些内容以未加密明文存在于私有仓库及 Git 历史中。

部署采用 Public `personal-workspace` 代码仓库与 Private `personal-workspace-data` 数据仓库。公开代码仓库和 Pages 构建物不得包含任何个人业务数据或认证凭据。

约束：

- Pages 构建物只包含应用代码和公开配置，不包含私人数据、token 或仓库快照。
- 客户端通过最小权限的 GitHub 身份授权访问指定数据仓库。
- 每个核心记录使用独立开放文件和稳定 ID；SQLite 只作为旧基线或可重建的本地索引，不再是跨设备真源。
- 写入携带当前 blob SHA/版本；冲突必须显式保留，不使用无条件 last-write-wins。
- 删除只影响当前分支视图；Git 历史中的明文可能继续存在，UI 必须明确说明。
- GitHub 适配器位于稳定 repository 接口之后，保留导出和迁移到其他 Git/文件存储的能力。

## 3. 系统上下文

```text
Mac / Windows / iPhone / iPad
             |
      Static Responsive PWA
             |
      GitHub App authorization
             |
  GitHub private data repository
     /          |             \
JSON/Markdown  Attachments   Git history
             |
   Client-side domain modules
             |
     Integration Adapters
   /        |          |       \
Obsidian  Calendar*   COROS*   AI Provider*

* 后续阶段、按授权启用
```

## 4. 逻辑分层

### 4.1 Client

- 响应式 UI 与 PWA 应用壳。
- 页面级状态、短期草稿和离线写入队列。
- 不持有数据库凭据或外部服务长期密钥。
- 对敏感缓存设置较短生命周期，可一键清除设备数据。
- 网络恢复后以幂等请求同步；冲突展示给用户。

### 4.2 Application API

- 认证、会话、输入校验、速率限制和授权。
- 暴露面向用例的 API，不让客户端任意跨表访问。
- 对写操作生成审计上下文、版本号和事件。
- 统一处理时区、软删除、并发更新和导出范围。

### 4.3 Domain Modules

建议模块：

- Identity & Settings
- Dashboard & Widgets
- Tasks
- Projects & Reports
- Calendar
- Journal
- Learning
- Habits
- Health
- Attachments
- Search
- Imports & Exports
- AI Orchestration
- Sharing
- Audit & Activity

模块之间通过明确的应用服务或领域事件通信，禁止随意跨模块写表。

### 4.4 Persistence

- 关系数据库保存结构化数据、元数据、授权、版本和审计引用。
- 文件存储保存附件、源 Word、导出包和必要的原始数据快照。
- 搜索索引是可重建派生物，不是唯一真源。
- 队列存储负责 Job 状态和重试；业务完成事实仍回写数据库。

### 4.5 Workers

- Journal Import Worker
- Export Worker
- Obsidian Sync Worker
- Search Index Worker
- Integration Sync Worker
- AI Run Worker

Worker 使用最小权限服务身份，并避免把正文写入普通日志。

## 5. 核心数据流

### 5.1 Quick Capture

1. 客户端保存短期草稿并提交 capture。
2. API 生成幂等键，保存原始输入和目标类型。
3. 用户确认或规则明确时转换为任务、日记片段、学习记录等。
4. 转换记录保留源 capture 引用；失败时内容仍留在 Inbox。

### 5.2 日记到 Obsidian

1. 用户保存日记，数据库创建新 revision。
2. 事务提交后产生 sync job。
3. Sync Adapter 根据模板生成规范 Markdown。
4. 对比上次同步哈希与 Vault 当前文件哈希。
5. 无冲突则原子写入；有冲突则保存双版本并创建 conflict。
6. 同步状态和文件路径回写，但不把 Vault 路径当作业务主键。

### 5.3 Word 历史日记导入

1. 原文件只读保存并计算 SHA-256。
2. 解析器输出 staging entries 和 diagnostics。
3. 用户预览、修正、跳过或确认。
4. 提交后按条目幂等键创建日记与 Markdown。
5. 生成清单、异常、输出哈希和导入日志。

### 5.4 COROS 数据

1. Connector 获取数据并保存 staging record、来源标识和抓取时间。
2. Normalizer 转换单位与时间，Classifier 区分夜间睡眠/小睡。
3. UI 展示原始摘要、推断结果和置信度。
4. 用户确认后创建 canonical health record。
5. 习惯与运动建议只消费已确认数据，或显式标注未确认数据。

### 5.5 AI 请求

1. 用户选择能力、对象和范围。
2. Policy Engine 计算最小上下文并展示数据类别。
3. Context Builder 对内容裁剪、脱敏并附来源引用。
4. Provider Adapter 发起调用。
5. 输出作为草稿展示；用户决定保存、应用或丢弃。
6. Audit 记录用途、范围、模型和动作结果，不默认保存完整敏感提示词。

## 6. Obsidian 集成方案

### 6.1 推荐边界

Workspace：快速输入、结构化元数据、搜索摘要、最近笔记和同步状态。  
Obsidian：Markdown 文件编辑、双链、图谱、插件和长期知识组织。

### 6.2 Adapter 能力

- 路径模板，如 `Journal/YYYY/YYYY-MM-DD.md`。
- YAML frontmatter schema 版本。
- Markdown 正文序列化与解析。
- 文件名清理、原子写入、哈希和冲突检测。
- 全量校验与增量同步。

### 6.3 跨设备现实约束

浏览器服务通常不能直接写任意本机 Vault。Phase 1 前需在以下模式中选择：

1. **服务端 Vault / Git 仓库模式**：服务器写入受控目录，再由现有方案同步到设备。
2. **本机 Companion 模式**：受限本机进程访问 Vault，与服务器交换版本。
3. **用户现有同步目录模式**：部署服务运行在能访问 iCloud/同步目录的设备上。

不能在验证文件锁、移动端可用性和冲突行为前承诺“实时双向同步”。建议 MVP 先实现 Workspace → Vault 单向安全导出，再扩展双向同步。

## 7. API 与事件约定

- API 使用版本前缀和稳定资源 ID。
- 写操作支持 idempotency key 和 `expected_version` 乐观锁。
- 错误返回机器可读 code、用户可读说明和 trace ID。
- 领域事件包含 event ID、schema version、actor、entity reference 和发生时间。
- 事件载荷尽量不携带完整日记/健康正文，仅携带引用。

## 8. 部署拓扑

### 8.1 推荐首发拓扑（ADR-007）

无常驻个人服务器的首发部署：

- GitHub Pages 托管静态 PWA；页面本身不含私人数据。
- 独立 GitHub 私有仓库保存 canonical 文件。
- GitHub 身份与仓库权限承担首版 owner 认证/授权。
- IndexedDB 仅作可清除缓存、离线队列和草稿。
- GitHub Actions 只负责测试、构建、Pages 发布和可选导出，不作为常驻服务器。

### 8.2 自托管可迁移性

- 配置通过环境和明确配置文件注入。
- 数据库使用标准迁移和开放导出。
- 存储以 adapter 封装，提供文件清单。
- AI、邮件、日历和健康连接器不进入核心领域逻辑。
- 提供一套从备份恢复到空环境的文档化流程。

## 9. 离线与同步策略

PWA 的首个版本建议“网络优先、有限离线”：

- 离线可打开应用壳、查看选择性缓存的今日摘要、创建 Quick Capture 草稿。
- 日记完整离线编辑需在冲突 UX 验证后启用。
- 离线队列显示待同步、失败和冲突状态。
- 用户退出、远程撤销设备或选择“清除本机数据”后删除敏感缓存。
- Service Worker 更新不能破坏未同步草稿。

## 10. 可靠性与可观测性

- 每个 Job 有 queued/running/succeeded/failed/cancelled 状态、尝试次数和检查点。
- 数据库写入与 Job 发布使用事务性 outbox 或等价机制。
- 指标关注同步积压、导入失败率、备份时间、恢复验证和 AI 错误率。
- 日志默认结构化并脱敏；正文、令牌、Cookie 和附件内容禁止进入普通日志。
- 为导入、导出、同步提供用户可读的状态页和错误报告。

## 11. 备份与灾难恢复

- 数据库、文件存储和 Vault 映射使用同一备份批次标识。
- 备份加密，密钥与备份分离保存。
- 定义每日增量/定期完整备份策略，具体 RPO/RTO 在部署选择后确认。
- 恢复演练必须验证实体计数、文件哈希、引用完整性和抽样可读性。
- 导出功能是可迁移手段，不替代受测试的备份。

## 12. 未来轻量多用户

所有所有权表预留 `owner_id`，但 Phase 1 不实现组织、角色矩阵或团队协作。未来分享通过 Publication / Share Grant 进入独立读模型；若扩展到多用户，先增加租户隔离测试，再开放写协作。

## 13. 待技术验证

1. GitHub App 授权流在 Pages、iOS PWA 和桌面浏览器上的 token 生命周期与退出行为。
2. GitHub 文件协议、API 限额、附件上限和大批量导入策略。
3. Vault 所在位置、同步工具和可接受的同步方向。
4. iOS PWA 对后台同步、通知和文件访问的限制。
5. COROS 是否存在满足用途与地区要求的官方数据访问途径。
6. 搜索是否先用数据库全文检索，何时才需要独立搜索服务。
7. AI provider 的数据保留、区域和零保留能力是否满足隐私要求。
