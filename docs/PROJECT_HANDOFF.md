# Personal Workspace 阶段性交接

> 文档用途：供完全未阅读历史聊天的新 Codex 会话直接接手项目。
> 当前阶段：Phase 2A Tasks 首个垂直切片已通过正式环境跨设备验收；下一接力点是拆分正式 PWA 主页面。
> 最后核对：2026-08-28（Asia/Shanghai）
> 正式入口：<https://nexus.lubannn.workers.dev/>

## 1. 接手时先读这一节

这是一个长期维护、本人优先、单用户优先的 Personal OS。它不是企业后台，也不是把所有知识管理能力重新做一遍。当前可运行产品是一套公开静态应用外壳，通过 Cloudflare 上的 GitHub App 登录边缘服务，让本人浏览器直接读写独立的 GitHub 私有数据仓库。Mac 可以关机，Mac、Windows、iPhone 和 iPad 都可独立使用。

接手后不要重新设计认证拓扑、不要迁回 LocalStorage、不要把公开代码仓库和私人数据仓库合并。Phase 2A Tasks 首个垂直切片已经完成代码、自动测试、正式环境单设备流程及跨设备反向写入验收。下一段工作由新对话执行：先在不改变业务行为的前提下拆分正式 PWA 主页面，再继续补齐 Task 生命周期。

开始任何修改前必须：

1. 阅读根目录及目标目录的 `AGENTS.md`；本项目使用 Next.js 16.3.2，写代码前读取 `node_modules/next/dist/docs/` 中与改动相关的当前版本文档。
2. 执行 `git status --short`，保留所有既有修改和未跟踪文件。当前本地 Git 索引与已发布远端状态并不完全同步，不能用大范围 `git add`、重置或清理来“整理”工作区。
3. 对发布内容采用精确文件范围；不得把 token、Cookie、Cloudflare Secret、GitHub App secret、恢复码或私人业务数据提交到公开代码仓库。
4. 修改数据格式时同时更新解析、导出、恢复、migration、测试与文档；已经发布的 migration 只能追加，不能改写。

## 2. 当前项目目标

Personal Workspace 要统一承载：

- 日程与时间块；
- 工作、生活、人生任务；
- 项目、里程碑、进度、Notes、文件和 Activity Log；
- 日记、Markdown 与 Obsidian；
- 学习领域与学习活动；
- 工作知识入口（Obsidian 负责深度知识管理）；
- 习惯、睡眠、运动和健康数据；
- 用户主动调用、最小上下文的个人 AI 助手“G 老师”。

长期产品原则：

- Personal-first、single-user-first；未来才考虑少量朋友分享和轻量多用户。
- 数据属于用户，可导出、可恢复、可迁移，不把核心能力锁死在单一 SaaS。
- Responsive Web App / PWA 优先，覆盖 Mac、Windows、iPhone、iPad，不要求原生 App。
- 核心业务数据不以 LocalStorage 作为唯一或正式副本。
- Private Core 默认不分享；Share Layer 必须使用用户明确选择生成的独立发布快照，不能直接开放私人主数据。
- 首页采用极简、黑白、留白、精致排版和模块化 Card，不做企业后台风格；模块可显隐、排序和调整尺寸，不能写死。

## 3. 当前总体架构

### 3.1 代码、运行与数据

```text
公开代码仓库 lubannn/personal-workspace
        │ main 分支触发构建
        ▼
Cloudflare Pages: personal-workspace-app.pages.dev
        │ 静态 Next.js PWA 上游
        ▼
Cloudflare Worker: nexus
正式入口 nexus.lubannn.workers.dev
        ├── 代理静态应用外壳
        ├── /auth/* GitHub App OAuth 与会话
        └── D1 personal-workspace-auth（仅认证会话）
                    │
                    ▼
用户浏览器获得短期 installation token（仅页面内存）
                    │ GitHub Contents / Git Data API
                    ▼
私有数据仓库 lubannn/personal-workspace-data
开放 JSON / Markdown / 附件文件（当前业务真源）
```

正式代码仓库是 Public，只含源码、文档、测试与部署配置。正式数据仓库必须保持 Private；它保存日记、健康、任务等全部私人业务文件。用户已明确接受这些业务文件以**未加密明文**存放于 GitHub 私有仓库。这个决定不包括任何凭据：凭据永远不得进入 Git。

### 3.2 认证与会话

- GitHub App：`personal-workspace-auth`，安装 ID `156819288`，仅允许 GitHub 用户 `lubannn`，且只允许数据仓库 `lubannn/personal-workspace-data`。
- Worker 名：`nexus`；D1：`personal-workspace-auth`。
- OAuth 使用 PKCE 和 state；服务端会话 ID 存于 `Secure`、`HttpOnly`、`SameSite=Lax` Cookie，CSRF token 使用同源双提交检查。
- GitHub refresh token 加密后存 D1；加密、HMAC 和 GitHub client secrets 只存在 Cloudflare Secrets。
- 浏览器通过 `/auth/token` 取得短期 token，token 只存在当前页面内存；不进入 Git、日志、LocalStorage、SessionStorage 或 IndexedDB。
- 当前设备退出走 `/auth/logout`；全部设备撤销走 `/auth/logout-all`。会话最长 30 天，但受 GitHub refresh token 实际有效期约束。
- Worker 只代理应用外壳和认证，不接收、记录或代理私人业务正文；浏览器直接调用 GitHub API。
- fine-grained PAT 手工连接仍保留为高级回退，不是正式默认入口。

### 3.3 数据协议

当前 canonical 数据格式版本为 v1。一般实体路径：

```text
workspace.json
config/dashboard-layout.json
data/captures/<capture_id>.json
data/tasks/<task_id>.json
journal/<year>/<journal_id>.md            # 规划，尚未上线
data/projects/<project_id>.json           # 协议已预留，尚未上线
data/calendar-events/<event_id>.json      # 协议已预留，尚未上线
data/learning/<id>.json                   # 协议已预留，尚未上线
data/habits/<id>.json                     # 协议已预留，尚未上线
data/health/<id>.json                     # 协议已预留，尚未上线
```

通用 JSON envelope 包含 `schema_version`、`entity_type`、`id`、`owner_id`、领域 `version`、创建/更新时间、`deleted_at` 和 `data`。Git blob SHA 是跨设备乐观并发 token，领域 `version` 是记录演进版本；两者不能互相替代。索引只可作为可重建 projection，不能成为唯一数据副本。

仓库中保留了一套 Phase 1A SQLite、本地服务端和备份基线，供本地恢复、自托管研究及旧实现参考。它不是当前跨设备可写真源，绝不能与 GitHub canonical 同时双写。

## 4. 已完成并验收的功能

### 4.1 Phase 0 产品与设计基线

八份指定文档均已完成并经用户批准：产品需求、架构、数据模型、隐私安全、设计系统、路线图、历史日记导入和 AI 设计。后续又补充了 GitHub-backed、认证升级、部署、Obsidian spike、数据迁移与 Tasks 专项文档。

### 4.2 Phase 1A 本地基础

- Next.js 模块化应用骨架、SQLite schema/repository、基础登录与会话、Dashboard/Quick Capture 基线。
- SQLite 备份、加密包与恢复脚本，以及 Obsidian 本地 Vault 单向写入 spike。
- 这套实现保留但不是当前正式 PWA 的主路径。

### 4.3 Phase 1B GitHub-backed PWA

- Cloudflare GitHub App OAuth、D1 会话、短期内存 token 和完整退出/撤销生命周期。
- 静态 PWA 由正式 Worker 地址访问，Mac 关机时仍可使用。
- Quick Capture 创建并写入独立 `data/captures/*.json` 文件。
- 最近 Capture 可从 GitHub 刷新读取。
- Mac、Windows、iPhone、iPad 的登录、刷新、读写均已通过；用户也确认 Mac 关机时 iPhone 仍可正常登录和写入。

### 4.4 Phase 1C 数据可迁移性前五个切片

1. **开放 JSON 导出**：导出 `workspace.json`、Capture、Dashboard layout 和 Task；manifest 含逐文件 SHA-256、数量、owner、schema 和生成信息。
2. **只读恢复预检**：本地选择导出 JSON 后仅在浏览器内存校验版本、路径、owner、数量、哈希、ID 与 schema，不上传、不写 GitHub。
3. **Capture 生命周期**：同路径软删除进入回收站，可恢复；更新带旧 blob SHA，陈旧写入显示冲突，界面不提供永久删除。
4. **隔离恢复**：只允许写入业务数据为空的另一 Private 仓库，使用单个原子 Git commit；写入前再次检查 HEAD，来源仓库不被修改。正式演练目标曾为 `lubannn/personal-workspace-restore-test`，提交 `8389cdce…`，因此该仓库现在不再是空目标。
5. **Schema dry run**：只追加 migration registry，能汇总 current/migratable/blocked；dry run 不改正文、不写远端。
6. **模块化 Dashboard（第五个产品切片）**：8 个 Widget 的显隐、顺序、尺寸和移动端单列布局写入 `config/dashboard-layout.json`；未知未来 Widget 配置会保留；跨设备写入与冲突保护已验收。

Dashboard 默认 Widget：今日日程、今日待办、Quick Capture、项目进度、今日学习、今日运动、最近日记、习惯 Heatmap。尚无业务数据的模块显示空状态。

### 4.5 Phase 2A Tasks 首个切片

已实现：

- 每个任务独立保存到 `data/tasks/<task_id>.json`。
- 分类：工作、生活、人生；状态与优先级协议已预留完整集合。
- 创建任务；默认 DDL 为当前 `Asia/Shanghai` 本地日期。
- Today 聚合“今天到期 + 已逾期”的开放任务，按 DDL、优先级、创建时间排序。
- 待办/已完成视图；完成写入 `completed_at`，恢复清空当前 `completed_at`，每次更新增加记录版本。
- 更新带 Git blob SHA，跨设备陈旧版本不能静默覆盖。
- Task 已进入导出、预检、migration dry run 和隔离恢复。

正式单设备验收记录：创建 `Phase 2A 跨设备验收任务`（v1），完成为 v2，恢复为 v3，刷新后仍从 Private GitHub 出现在 Today/待办。导出为 18 个文件：15 Capture、1 Task、1 Dashboard layout 和 `workspace.json`；dry run 为 current 18、migratable 0、blocked 0。

2026-08-28 用户确认 Task 跨设备验收通过：另一设备能够读取同一任务并完成反向状态写入，跨设备同步闭环成立。Phase 2A 首个垂直切片至此验收完成。

## 5. 当前代码与部署状态

### 5.1 技术版本

- Node.js `>=24`；pnpm `11.19.0`
- Next.js `16.3.2`，React/React DOM `19.2.8`
- TypeScript `5.9.x`，Vitest `4.1.11`
- Wrangler `4.125.0`
- PWA 为 Next.js static export，正式 Pages 构建命令 `pnpm build:cloudflare-pwa`。

### 5.2 质量状态

2026-08-28 重新执行并通过：

- 15 个测试文件、62 项测试；
- `pnpm typecheck`；
- `pnpm lint`；
- `pnpm build:cloudflare-pwa`；
- 此前已完成桌面与 390px 手机宽度视觉检查，无横向溢出。

Codex 桌面环境直接运行 pnpm 若提示 `node: not found`，先加载工作区依赖或把以下路径放在 PATH 前部：

```text
/Users/luban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
/Users/luban/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback
```

### 5.3 已发布提交与部署

- Phase 2 Task 代码：`4bf0adf560d1482039508c06709c2aef1540333a`
- Phase 2 单设备验收记录：`d969fc9166d107d18413d863f48263e2fe99d64d`
- 对应 Cloudflare Pages deployment：`92e3d036-0f73-4277-9cdb-0248ac526903`
- 2026-08-28 已复核该部署为 `success / deploy`，其 commit 正是 `d969fc9…`。

正式运行路径是 Worker `nexus` 代理 Pages，不应把临时 preview 地址或带账户随机子域的旧地址重新写回产品入口。GitHub Pages workflow 仍存在，旧 GitHub Pages 页面可作为历史/回退，但正式入口是 `nexus.lubannn.workers.dev`。

### 5.4 本地工作树特别说明

当前 `git status` 显示许多 modified/untracked 文件，其中包含用户及此前 Codex 累积的有效工作；本地 `.git` 视图并不能完整反映远端已发布提交。不要假设未跟踪文件就是垃圾，不要执行 `git reset --hard`、`git checkout --`、`git clean` 或广泛删除。此前发布采用 GitHub API 创建精确 blob/tree/commit 并非本地 Git commit。后续若继续此方式，必须以远端 `main` 最新 tree 为基准，只替换本次目标路径。

## 6. 已作出的关键设计决策及原因

| 决策 | 原因 |
|---|---|
| Public 代码仓库与 Private 数据仓库分离 | 代码可公开复用，私人数据永不进入公开构建物；未来分享仍有清晰边界。 |
| GitHub 私有仓库是当前 canonical 真源 | 跨设备、Mac 关机可用、开放文件、版本历史和可导出；满足用户当前维护能力。 |
| 业务数据允许私有仓库明文，凭据绝不允许 | 用户明确接受明文风险以换取易用与可迁移；凭据泄露会扩大权限，必须仍由 Secret/Cookie 边界保护。 |
| GitHub App OAuth 是默认，PAT 仅回退 | 避免每台设备手动生成长期 token，可撤销会话，权限更窄，用户体验更稳定。 |
| Worker 只做认证和外壳代理，不代理正文 | 降低服务器接触 Restricted 数据的范围；业务正文由浏览器直接读写用户仓库。 |
| 核心数据不落 LocalStorage | 避免单设备丢失、难以导出及长期 token/正文泄露；刷新时从 canonical 重新读取。 |
| 每实体一文件 + Git blob SHA 乐观并发 | 文件开放、差异可读；跨设备冲突显式，不采用最后写入者静默覆盖。 |
| 软删除优先，不提供默认永久删除 | 减少误删；Git 历史本来也不能等同安全擦除。 |
| 恢复只能到独立、业务数据为空的 Private 仓库且单 commit | 防止覆盖正式数据，便于核验和整体回滚。 |
| migration registry 只追加 | 已导出的历史包必须持续可解释；禁止新代码改写过去语义。 |
| Dashboard Registry + 持久化布局 | 首页必须可增删、显隐和重排，移动端从同一配置派生，不能写死。 |
| Task 与 Calendar Event 分离 | DDL、任务状态和时间块语义不同；移动 Calendar 时间块不能意外改任务截止日期。 |
| Project 报告先做确定性事实汇总，AI 只润色 | 汇报事实必须能追溯到 Task、Milestone、Time Entry 和 Activity Log。 |
| Obsidian 负责深度知识管理 | Workspace 只提供搜索、最近笔记、链接和可靠同步，不重造知识图谱。 |
| Journal 采用 Workspace → Markdown → Obsidian | 用户拥有长期可读文本；先做单向、哈希和冲突，验证后才考虑双向。 |
| COROS 数据 staging → 识别 → 用户确认 → canonical | 夜间睡眠、小睡和异常数据不能自动成为正式健康记录或习惯打卡依据。 |
| AI 必须用户主动请求、最小上下文、先草稿 | 日记和健康高度敏感；AI 默认不得读全库，也不得直接删除、发布、发送或形成医疗结论。 |
| Share Layer 保存独立发布快照 | “可分享”不等于“已公开”，撤销分享不能依赖继续查询 Private Core。 |

## 7. 当前未完成事项

### 7.1 立即事项

1. 在添加更多复杂业务前，把 `apps/github-pwa/app/page.tsx`（当前约 1553 行）拆为清晰的 auth、data loading、Dashboard、Task、Capture、portability 组件/hooks。
2. 为 Tasks 增加编辑、取消、归档、软删除/回收站、标签、notes、实际/预计耗时、一层子任务与项目引用。
3. 建立 Projects canonical 文件、Milestone、阶段、进度来源、Notes、文件引用和 Activity Log。
4. 建立内部 Calendar 日/周/月视图、时间块和提醒，并坚持 Task/Calendar 边界。
5. 建立周报/月报的确定性事实汇总、个人复盘版与领导汇报版；再补 Tasks/Projects/Time Entries CSV 导出。

### 7.2 后续阶段

- Journal 创建、编辑、修订、搜索、最近日记、Markdown 输出和冲突模型。
- Obsidian 真正接入；当前只有本地 Vault spike，用户的实际 Vault 位置和同步方式尚未确认。
- Legacy Journal Importer：巨大 Word 原件只读、解析年/月/日/时间、预览、异常诊断、幂等批次、Import Log、Markdown 输出；原 Word 不覆盖，正文默认不送 AI。
- Learning Area/Goal/Activity/Resource；韩语、英语、钢琴、羽毛球只是初始配置，绝不能写死为封闭枚举。
- Habit 规则版本、自动依据与人工修正；早睡初始阈值 23:30，早起 06:30，均需时区和跨午夜规则。
- Health 手工记录、COROS staging/确认、睡眠/HRV/恢复/静息心率/训练负荷/运动记录和非医疗性质训练建议。
- AI Assistant 能力策略、Context Manifest、发送前范围预览、provider adapter、草稿确认与最小审计。
- 完整 Markdown/CSV/附件索引导出、搜索、附件、有限离线、工作设备隐私模式、Publication/Share Layer，以及未来轻量多用户专项授权设计。

### 7.3 仍需用户回答的产品问题

- Obsidian Vault 的实际位置与同步方式（本机、iCloud、Obsidian Sync 或其他）。
- 工作设备隐私模式是否首发必备。
- 周报/月报首选输出（Markdown、复制文本、PDF、Word）。
- 日记是否默认一天一文件。
- 回收站、AI Run、健康原始数据、导入原件和导出包的保留期。
- 日记正文是否允许发给外部 AI provider，及允许的 provider/隐私配置与预算。

## 8. 已知 bug、风险与技术债

- **正式 UI 单文件过大**：`apps/github-pwa/app/page.tsx` 混合认证、数据读取、业务状态、恢复和多个 UI 模块，继续堆功能会显著增加回归风险。
- **GitHub API 扩展性**：当前目录列表后逐文件读取；记录增长后会增加延迟、请求数和 rate-limit 风险。尚无分页索引、增量缓存或服务端 projection。
- **有限离线**：PWA 只保证应用外壳，不承诺离线编辑核心数据。离线/弱网下写入应禁用或明确排队，不能假装已保存。
- **明文隐私风险**：Private 不等于端到端加密。GitHub 账号接管、误加协作者或仓库误设 Public 会暴露完整数据；Git 历史还会保留旧版本。
- **软删除不是安全擦除**：当前删除只改 `deleted_at`，Git 历史仍含正文；永久删除、历史重写和备份轮换尚未设计为产品流程。
- **浏览器 token 仍是高价值临时凭据**：虽仅内存保存，XSS 或恶意浏览器扩展仍可能窃取；必须保持 CSP、依赖审计、最小权限和无第三方追踪。
- **认证可用性依赖 Cloudflare、GitHub 与 D1**：这些服务任一中断时无法获取新 token；当前没有离线写入保证。
- **恢复目标一次性**：已演练的 restore-test 仓库已有业务文件，再次恢复应被拒绝，这是预期保护而非 bug。新演练需新建空 Private 目标。
- **导出格式 v1 已扩展可选模块**：旧 v1 不含 Task 仍兼容；未来发生不兼容语义变化必须提升 `export_version`，不能继续偷偷扩展。
- **Task 日期语义尚窄**：当前创建 UI 只暴露 date-only DDL 与 Asia/Shanghai 默认；计划时间、原始时区、跨时区和 Calendar 耦合尚未验收。
- **任务测试数据仍在正式私库**：`Phase 2A 跨设备验收任务` 已用于跨设备完成验收，记录仍留在正式私库。后续决定保留、归档或删除；当前 UI 尚无 Task 删除。
- **旧 SQLite 与正式 GitHub 路径并存**：新开发者可能误改 `src/app` 而不是 `apps/github-pwa/app`，或误建双写。正式线上前端目前是后者。
- **Cloudflare 构建范围较宽**：`main` 更新会触发 Pages 构建；发布纯文档也可能部署应用。每次发布后检查 deployment commit 与状态。
- **基础恢复门槛尚有缺口**：Phase 1 路线图要求的独立加密备份目标、passphrase 管理和真实 Vault/iOS 文件语义仍未全部验收；本机缺少 Docker 时容器恢复路径也未验证。
- **可观测性有限**：Worker 日志有 10% head sampling，禁止添加正文、token 或健康 payload；尚无完整用户可见安全活动页。

## 9. 重要文件及作用

| 文件/目录 | 作用 |
|---|---|
| `AGENTS.md`、`apps/github-pwa/AGENTS.md` | 开发约束；尤其要求依据仓库内 Next.js 16 文档工作。 |
| `package.json` | 版本、Node/pnpm 门槛和测试/构建/部署脚本。 |
| `apps/github-pwa/app/page.tsx` | 当前正式 PWA 的主页面与业务编排；需要优先拆分。 |
| `apps/github-pwa/app/globals.css` | 正式 PWA 视觉、响应式 Dashboard/Task/Capture 样式。 |
| `apps/github-pwa/app/layout.tsx`、`manifest.ts`、`icon.svg` | PWA 元数据、应用壳和图标。 |
| `apps/github-pwa/next.config.ts` | Next.js static export、basePath 与资源前缀。 |
| `apps/auth-worker/src/index.ts` | Worker 健康检查、认证路由和 Pages 静态代理。 |
| `apps/auth-worker/src/auth.ts` | OAuth/PKCE、D1 会话、token refresh、CSRF、退出与授权边界。 |
| `apps/auth-worker/src/security.ts` | token 生成、哈希和 refresh token 加密。 |
| `apps/auth-worker/migrations/0001_auth_sessions.sql` | D1 会话表基线。 |
| `apps/auth-worker/wrangler.jsonc` | `nexus`、D1、允许用户/仓库和观测配置；Secrets 不在此文件。 |
| `src/lib/github-data/protocol.ts` | canonical envelope、实体类型与路径生成。 |
| `src/lib/github-data/github-contents.ts` | GitHub Contents/Git Data adapter、文本读写、并发和原子 commit。 |
| `src/lib/github-data/workspace.ts` | `workspace.json` 初始化与解析。 |
| `src/lib/github-data/dashboard-layout.ts` | Widget registry、布局解析、显隐/排序/尺寸和持久化协议。 |
| `src/lib/github-data/tasks.ts` | Task 类型、解析、状态迁移、Today/开放/完成聚合。 |
| `src/lib/github-data/portable-export.ts` | 开放导出、manifest、SHA-256 和完整性预检。 |
| `src/lib/github-data/portable-restore.ts` | 空目标检查、恢复计划和原子恢复。 |
| `src/lib/github-data/schema-migrations.ts` | 只追加 migration registry 与 dry run。 |
| `src/lib/github-data/*.test.ts` | 数据协议与边界的核心回归测试。 |
| `src/app`、`src/server`、`scripts` | Phase 1A SQLite/本地基线、备份恢复和 Obsidian spike；不是当前正式 PWA 主路径。 |
| `.github/workflows/pages.yml` | 旧 GitHub Pages CI/CD 回退路径。 |
| `docs/PRODUCT_REQUIREMENTS.md` | 产品范围、角色、核心模块、非功能要求和成功标准。 |
| `docs/ARCHITECTURE.md` | ADR、逻辑架构、同步、部署与 Private/Share 边界。 |
| `docs/DATA_MODEL.md` | 全部规划实体、关系、时间/来源/导出规则。 |
| `docs/PRIVACY_AND_SECURITY.md` | 数据分类、威胁、认证、日志、AI/外部连接和安全门槛。 |
| `docs/DESIGN_SYSTEM.md` | 极简编辑感 UI、Card、排版、响应式与可访问性要求。 |
| `docs/ROADMAP.md` | Phase 0–6 的范围、退出标准与跨阶段质量轨道。 |
| `docs/GITHUB_BACKED_PWA.md` | 当前 GitHub canonical 方案与历次正式验收事实。 |
| `docs/PHASE_1C_DATA_PORTABILITY.md` | 导出、预检、软删除、隔离恢复、migration、Dashboard 细则。 |
| `docs/PHASE_2_TASKS.md` | Tasks 当前切片的范围、规则、验收与待办。 |
| `docs/JOURNAL_IMPORT_SPEC.md` | 十多年 Word 日记安全解析、预览、幂等、日志和 Markdown 契约。 |
| `docs/AI_DESIGN.md` | AI capability policy、最小上下文、草稿/审计与禁止动作。 |
| `docs/OBSIDIAN_SPIKE.md` | 当前本地 Vault 验证结论及未决部署语义。 |
| `docs/AUTHENTICATION_UPGRADE.md`、`AUTH_HOSTING_DECISION.md` | 从 PAT 到 Cloudflare GitHub App 的迁移理由和边界。 |
| `docs/DEPLOYMENT.md` | 较早的本地/SQLite 部署和备份说明；阅读时必须结合当前 Cloudflare/GitHub 架构。 |

## 10. 下一步建议执行顺序

1. **拆分正式 PWA 主页面**：先写保持行为不变的 characterization tests，再提取 GitHub/auth hook、workspace loader、Dashboard、Task、Capture、portability 组件；不要在同一改动里加入新业务语义。该工作明确交由下一新对话执行。
2. **补齐 Task 生命周期**：编辑 → 取消/归档 → Task 软删除/恢复 → tags/notes/duration → 一层子任务。每步都做跨设备 SHA 冲突验收，并进入导出/恢复/migration。
3. **实现 Project 最小闭环**：Project 文件、阶段、Milestone、Task 关联、进度计算和 Activity Log；不能只存一个人工百分比而不记录来源。
4. **实现内部 Calendar**：先数据协议和 Task/Event 边界，再做日/周/月、时间块与提醒。
5. **实现确定性报告与 CSV**：事实汇总可追溯；AI 润色留到 Phase 5。
6. **转入 Journal/Obsidian**：先确认实际 Vault 和同步方式，再做单向安全同步与冲突；之后才做 Legacy Word Importer。
7. **再做 Learning/Habit/Health、AI、Share Layer**：严格遵循 staging、最小上下文和独立发布快照边界。

## 11. 继续开发时必须遵守的约束

- 不把任何私人数据、token、Cookie、Secret、API key 或恢复码写入公开代码仓库、Pages 构建物、日志或测试 fixture。
- `personal-workspace` 可公开；`personal-workspace-data` 必须保持私有。改变可见性、添加协作者或扩大 GitHub App 权限必须由用户明确决定。
- 所有业务数据当前可以明文进入 Private GitHub，但必须 TLS 传输；这个同意不等于允许公开、记录到日志或发送给 AI。
- 核心数据不依赖 LocalStorage/SessionStorage/IndexedDB；任何离线缓存必须可清除、可重建、有分类与过期策略。
- 不重新引入 Mac 常开依赖。正式核心流程必须在 Mac 关机时仍能从其他设备工作。
- 不建立 GitHub 与 SQLite 双写；每个阶段只有一个 canonical 可写真源。
- 任何更新都携带最后读取到的 blob SHA；冲突必须显式显示，绝不静默 last-write-wins。
- 删除默认软删除；永久删除、公开分享、完整导出、恢复写入、外部连接和 AI 高敏上下文属于高影响动作，应有重新确认/认证与清楚范围。
- 导出必须保持开放格式和完整性信息；恢复先预检，只写独立空 Private 目标，且使用单个原子 commit。
- 数据 schema 和 migration 均需版本化；已发布 migration 只能追加。未知未来字段/Widget 尽量 round-trip 保留。
- Journal 原 Word 永不覆盖；导入前预览，异常必须可见，所有未解析内容不得静默丢弃，生成 Import Log，并支持幂等与回滚。
- Obsidian 先单向同步、原子写入、版本/哈希/冲突；未验证前不启用任意双向覆盖。
- Learning Area 可配置，不把当前四个领域写死。
- COROS 或其他外部健康数据必须先 staging，经夜间睡眠/小睡识别与用户确认后才进入 canonical；训练建议不是医疗诊断。
- AI 默认无全库读取权，只在用户主动请求时按 capability policy 组装最小上下文；发送前可见范围，输出先为草稿，不得自动发布、删除、发送或形成正式健康结论。
- Share Layer 只读独立 Publication 快照，不直接查询 Private Core；默认 noindex，可撤销、有有效期与缓存清理策略。
- UI 保持个人手帐/编辑页面风格：大量留白、黑白主色、精致排版、模块化 Card；响应式、键盘可用、有清晰焦点和足够对比度。
- 每个垂直切片都需自动测试、类型检查、Lint、生产构建、桌面/移动视觉检查、正式环境真实写入及跨设备验收；文档状态只能记录已发生的事实。
- 发布后必须核对正式 deployment 对应 commit 和成功状态；不能只看到本地构建通过就宣布上线。

## 12. 当前接力点的完成定义

Phase 2A 首个切片已完成，不需要新会话重复 Task 跨设备验收。新会话的第一项工作是正式 PWA 主页面拆分，完成定义为：

- 拆分前先建立足以锁定现有认证、Dashboard、Task、Capture、导出/恢复行为的 characterization tests；
- 从 `apps/github-pwa/app/page.tsx` 提取职责清晰的组件/hooks，显著降低该文件体积和状态耦合；
- 不在同一切片引入新业务字段、数据迁移或视觉重设计；
- GitHub App、内存 token、Private GitHub 直读写、blob SHA 冲突、导出/恢复和移动端行为保持不变；
- 62 项既有测试及新增测试、类型检查、Lint、生产构建全部通过；
- 完成桌面和移动端正式环境回归，确认跨设备读写未退化；
- 更新本交接文档中的文件结构、测试数量、已知技术债与下一接力点，并精确发布、核对 Cloudflare deployment。
