# Personal Workspace 阶段性交接

> 文档用途：供完全未阅读历史聊天的新 Codex 会话直接接手项目。
> 当前阶段：Phase 2 代码基线已闭环发布；Phase 3A Journal Core 首切片已实现并进入发布流程。
> 下一接力点：Journal 正式 Private 生命周期回归仍需逐动作确认；代码侧后续是搜索/日期浏览与 Obsidian 单向同步准备。
> 最后核对：2026-08-31（Asia/Shanghai）
> 正式入口：<https://nexus.lubannn.workers.dev/>
> Public 代码仓库：<https://github.com/lubannn/personal-workspace>

## 1. 新会话先读这里

这是一个长期维护、personal-first、single-user-first 的 Personal OS。正式产品是一套公开静态 PWA 外壳，通过 Cloudflare Worker 上的 GitHub App 认证，让用户浏览器直接读写独立的 GitHub Private 数据仓库。Mac 可以关机，Mac、Windows、iPhone 和 iPad 均可独立使用。

不要重新设计认证拓扑，不要迁回 LocalStorage，不要合并 Public 代码仓库与 Private 数据仓库，不要建立 GitHub 与 SQLite 双写。

开始任何修改前必须：

1. 阅读根目录与目标目录的 `AGENTS.md`。本项目使用 Next.js 16.3.2；涉及 Next.js 代码时，先阅读 `node_modules/next/dist/docs/` 中与改动相关的当前版本文档。
2. 执行 `git status --short`，保留全部既有修改和未跟踪文件。本地索引明显落后于已发布远端状态；不得用 `git reset --hard`、`git checkout --`、`git clean`、大范围 `git add` 或广泛删除来整理工作区。
3. 发布时以远端 `main` 最新 tree 为基准，只替换本次精确文件集合。此前 PR 均通过 GitHub blob/tree/commit 流程精确发布，本地 Git 状态不能充当发布清单。
4. 不得把 token、Cookie、Cloudflare Secret、GitHub App secret、恢复码、Private 仓库正文或真实业务数据提交到 Public 代码仓库、测试输出或日志。
5. 修改 canonical 数据格式时同步更新解析、collection loading、portable export、inspection、restore、migration、测试和 `docs/DATA_MODEL.md`。已发布 migration 只能追加，不能改写。
6. 正式 Private 业务写入属于高影响动作：必须在动作发生时获得用户针对精确写入内容的确认。实现代码、只读检查和本地假数据回归不等于获准写入正式业务数据。
7. 用户要求平时不要每一步更新本文；仅在准备新开窗口时集中更新。本次已按此要求完成更新。

## 2. 当前架构与不可变边界

```text
Public 代码仓库 lubannn/personal-workspace
        │ main 触发构建/部署
        ▼
Cloudflare Pages: personal-workspace-app.pages.dev
        │ 静态 Next.js PWA 上游
        ▼
Cloudflare Worker: nexus
正式入口 nexus.lubannn.workers.dev
        ├── 代理静态应用外壳
        ├── /auth/* GitHub App OAuth 与会话
        └── D1 personal-workspace-auth（只保存认证会话）
                    │
                    ▼
浏览器获得短期 installation token（仅页面内存）
                    │ GitHub Contents / Git Data API
                    ▼
Private 数据仓库 lubannn/personal-workspace-data
开放 JSON / Markdown / 附件（当前 canonical 真源）
```

- GitHub App：`personal-workspace-auth`；安装 ID `156819288`；只允许用户 `lubannn` 和数据仓库 `lubannn/personal-workspace-data`。
- Worker：`nexus`；D1：`personal-workspace-auth`。
- OAuth 使用 PKCE + state；服务端 session cookie 为 `Secure`、`HttpOnly`、`SameSite=Lax`；CSRF 使用同源双提交检查。
- refresh token 加密后存 D1；短期 access token 只进入当前页面内存，不进入 Git、日志、LocalStorage、SessionStorage 或 IndexedDB。
- `/auth/logout` 撤销当前设备；`/auth/logout-all` 撤销全部设备。fine-grained PAT 只保留为高级回退。
- Worker 只处理认证和静态外壳，不代理、记录或接收 Private 业务正文；正文由浏览器直连 GitHub API。
- `src/app`、`src/server` 与 SQLite/备份脚本是 Phase 1A 保留基线，不是正式 PWA 的可写真源。正式前端是 `apps/github-pwa/app`。

## 3. 当前 canonical 数据协议

协议仍为 v1。已上线路径：

```text
workspace.json
config/dashboard-layout.json
data/captures/<capture_id>.json
data/tasks/<task_id>.json
data/projects/<project_id>.json
data/project-phases/<phase_id>.json
data/milestones/<milestone_id>.json
data/project-notes/<note_id>.json
data/activity-events/<event_id>.json
data/calendar-events/<event_id>.json
```

Journal、Learning、Habit、Health、Publication 等仍是规划实体，尚未上线。

通用 JSON envelope 包含 `schema_version`、`entity_type`、`id`、`owner_id`、领域 `version`、`created_at`、`updated_at`、`deleted_at` 和 `data`。Git blob SHA 是跨设备乐观并发 token；领域 `version` 是业务记录演进版本；二者不能互相替代。任何更新必须携带最后读取到的 blob SHA，冲突必须显式显示，禁止静默 last-write-wins。

删除默认使用 `deleted_at` 软删除。UI 不提供永久删除；Git 历史仍包含旧正文，因此软删除不等于安全擦除。

## 4. 已完成并发布的产品切片

### 4.1 Phase 0 / Phase 1 / Portability

- 产品、架构、数据、隐私、设计、路线图、Journal Import 和 AI 设计文档已建立。
- Phase 1A SQLite、本地备份/恢复和 Obsidian Vault 单向写入 spike 保留为参考，不是当前正式路径。
- Phase 1B GitHub-backed PWA、GitHub App OAuth、D1 会话、短期内存 token、退出/撤销生命周期已上线。
- Quick Capture 支持创建、读取、软删除与恢复；Mac、Windows、iPhone、iPad 登录和跨设备读写曾完成正式验收。
- 开放 JSON 导出覆盖当前全部 canonical 实体；manifest 保存逐文件 SHA-256、数量、owner、schema 和生成信息。
- 恢复 inspection 只在浏览器内存校验版本、路径、owner、数量、哈希、ID、schema 和引用，不上传、不写 GitHub。
- 隔离恢复只允许另一个业务数据为空的 Private 仓库，写入前重查 HEAD，并用单个原子 Git commit 写入。旧 `personal-workspace-restore-test` 已非空，不能复用。
- migration registry 只追加；dry run 只汇总 current/migratable/blocked。
- Dashboard 8 个 Widget 支持显隐、排序、尺寸和移动端单列；布局保存到 `config/dashboard-layout.json`。
- Today Widget 已接入今日/逾期 Task、Project 进度和当日日程。

### 4.2 Tasks：基础闭环已完成

- 每个 Task 独立保存到 `data/tasks/<id>.json`；分类为工作/生活/人生，支持优先级和 date-only DDL。
- Today 聚合今天到期与逾期开放任务。
- 支持创建、编辑标题/分类/优先级/DDL、完成/恢复、取消/恢复、归档/恢复、软删除/恢复。
- 支持 tags、Private Markdown notes、预计耗时、手工实际耗时。
- 支持一层子任务：独立 Task 文件通过 `parent_task_id` 引用父任务；拒绝自引用与二层嵌套。
- 支持 Project 引用；Project 删除不级联删除 Task。
- 全部更新递增领域版本并使用旧 blob SHA；Task 已进入 export/inspection/restore/migration。
- Phase 2A 首个 Task 曾完成正式单设备和跨设备反向写入验收。PR #2–#6 的扩展功能已上线，但本轮没有再次向正式 Private 仓库写测试数据。

### 4.3 Projects：基础闭环已完成

- Project、ProjectPhase、Milestone、ProjectNote、ActivityEvent 均为独立 canonical 文件。
- Project 支持创建、编辑、完成/取消/归档及恢复、软删除/恢复。
- Phase 支持创建与设置当前阶段；这是两个独立 Git 写入，不能伪装成一个原子事务。
- Milestone 支持权重、目标日期、完成/恢复；Project 进度来自关联 Task 事实或加权 Milestone。
- Project Note 支持 Markdown、note date、确定性排序、创建与 SHA 保护的版本化编辑。
- append-only Activity Log 记录 Project 生命周期、Phase、Milestone 和 Note 变化，并提供只读时间线。
- Activity append 在主操作成功后执行，不是跨文件原子事务。如果 append 失败，主记录与 Git 历史仍是权威事实，UI 必须报告部分成功，不能回滚或伪称全部失败。
- Activity 从启用时开始，不回填旧 Git 历史；它是产品时间线，不是安全审计日志。
- 全部 Project 相关实体已进入 export/inspection/restore/migration。
- Project 文件引用元数据已实现；文件本体上传仍未开放。

### 4.4 Internal Calendar：基础闭环已完成

- CalendarEvent 独立保存到 `data/calendar-events/<id>.json`；当前 `calendar_id = internal-default`。
- 支持单日、非重复、非全天且有明确起止时间的 `event` / `time_block`。
- 墙上时间按 workspace IANA timezone 转成 UTC instant；同时保存 timezone 与本地日期，并拒绝 DST 中不存在的本地时间。
- 可选引用 Task，但 Calendar 操作绝不改写 Task 的 DDL、状态或耗时。
- 支持版本化编辑、取消/恢复、软删除/恢复；全部使用旧 blob SHA。
- 支持已安排、已取消、回收站，以及日/周/月读取视图。周按周一至周日，月按自然月；视图从同一批 canonical 记录派生，不保存 projection。
- CalendarEvent 已进入 Dashboard Today、export/inspection/restore/migration，并校验同包 Task 引用。
- 前台设备提醒已实现；重复、全天事件、永久删除、后台 Web Push 和外部 Calendar 同步仍明确关闭。

### 4.5 Phase 2 后续闭环

- Project 文件引用元数据、SHA-256、URL/文件名/MIME/大小和 export/restore 已上线；不托管文件本体。
- Calendar 前台设备提醒已上线，保存偏移与投递方式；只在页面运行或恢复后的宽限窗尝试，不承诺后台送达。
- 确定性周报/月报、个人/汇报 Markdown、周期事实 CSV、Tasks/Projects/Time Entries CSV 已上线。
- ReportDraft 使用 create-only 不可变事实快照，只有明确点击保存才写入，不调用 AI 或自动发送。
- Time Entry 保存手工本地日期与分钟，不伪造开始/结束时刻；Task 人工实际耗时与 Time Entry 分开汇总。

### 4.6 Phase 3A Journal Core 首切片

- JournalEntry 保存到 `data/journal-entries/<id>.json`，当前每天只允许一条未删除 daily。
- 支持创建、版本化编辑、软删除/恢复、最近日记 Dashboard 和单篇 Markdown 下载。
- Private GitHub JSON 是唯一 canonical；没有连接、扫描或写入真实 Obsidian Vault。
- JournalEntry 已进入 export/inspection/restore/migration；同日 active daily 冲突会拒绝创建或恢复。
- 代码质量门已通过，但没有自行向正式 Private 仓库创建 Journal 验收数据。

## 5. 当前代码、测试与正式部署

### 5.1 技术版本

- Node.js `>=24`；pnpm `11.19.0`
- Next.js `16.3.2`；React/React DOM `19.2.8`
- TypeScript `5.9.x`；Vitest `4.1.11`；Wrangler `4.125.0`
- 当前本地生产检查命令：`pnpm build:github-pwa`

Codex 若提示 `node: not found`，把以下路径放在 PATH 前部：

```text
/Users/luban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
/Users/luban/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback
```

### 5.2 最新质量门

2026-08-31 Journal Core 首切片后通过：

- 28 个测试文件、135 项测试；
- 从远端 `main` 组装的精确 Journal 发布分支为 24 个测试文件、127 项测试；差额来自本地保留但不在 Public `main` 的 Phase 1A 测试，不属于本次发布内容；
- `pnpm typecheck`；
- `pnpm lint`；
- `pnpm build:github-pwa`；
- 精确 diff/whitespace 审计；
- 桌面与 390px Browser 回归；Journal 字段、禁用态和响应式布局正确，且无横向溢出。

本地纯静态服务器上的 `/auth/status` 404 是预期现象，不代表正式 Worker 认证故障。

### 5.3 PR、main 与部署

| PR | 已发布切片 | main squash commit |
|---|---|---|
| [#1](https://github.com/lubannn/personal-workspace/pull/1) | 正式 PWA 主页面拆分 | `141fd2e9705bbb9c6728967c07b881c0b5db4c80` |
| [#2](https://github.com/lubannn/personal-workspace/pull/2) | Task 编辑与 SHA 保护 | `ba2868ff22e4358e2ca168fc91d592ac4075a81d` |
| [#3](https://github.com/lubannn/personal-workspace/pull/3) | Task 取消/归档 | `3f55a757ed724ba864702180a5756c1b9ae6ae28` |
| [#4](https://github.com/lubannn/personal-workspace/pull/4) | Task 可恢复回收站 | `92d2aa3a7cce1eb41f827363555fcb512cd76a5f` |
| [#5](https://github.com/lubannn/personal-workspace/pull/5) | Task tags/notes/duration | `19d735d974d6926dfe55e45a141884d5232b8266` |
| [#6](https://github.com/lubannn/personal-workspace/pull/6) | 一层 Task 子任务 | `b6e9c37c5c5f2a76ddcd9f5da88832eb69a9fd71` |
| [#7](https://github.com/lubannn/personal-workspace/pull/7) | Projects、Phases、Milestones | `850e2a80e12bc7b4e8fffd68cad97f8ba2e9b705` |
| [#8](https://github.com/lubannn/personal-workspace/pull/8) | Project Notes | `672c09a6df07b4d16bcdc4afe4b1599ccd58e0c8` |
| [#9](https://github.com/lubannn/personal-workspace/pull/9) | Project Activity Log | `c5f155b72a44cc083185205cbb7bebe6b4ee296b` |
| [#10](https://github.com/lubannn/personal-workspace/pull/10) | Calendar 时间块 | `78b416c73324da22ffc724f39ee32bbf574b9db6` |
| [#11](https://github.com/lubannn/personal-workspace/pull/11) | Calendar 编辑/取消/回收站 | `57c1be9330254683b0320ae3a65ebd1caaf0f89b` |
| [#12](https://github.com/lubannn/personal-workspace/pull/12) | Calendar 周/月视图 | `5589b6291629e45fc21f6e320f17d2477e0ba23d` |
| [#13](https://github.com/lubannn/personal-workspace/pull/13) | 当前日期 hydration 与日期/时间输入修复 | `ff46d1330d168c661daf4ffc09c8c1d2ea8303e2` |
| [#14](https://github.com/lubannn/personal-workspace/pull/14) | Project 文件引用元数据 | `f7278dd9752b76ad76bb04350e8bedcadef37d6d` |
| [#15](https://github.com/lubannn/personal-workspace/pull/15) | Calendar 前台提醒 | `1b46f9d797f33438e4f39f41341d8b2941eef10d` |
| [#16](https://github.com/lubannn/personal-workspace/pull/16) | 确定性周报/月报 | `c861b67cf1b4cbf586fc81bbc6e2b4129a8ddc48` |
| [#17](https://github.com/lubannn/personal-workspace/pull/17) | 确定性 Markdown 模板 | `770375748906e3818027dee584b9f19f6c0d348d` |
| [#18](https://github.com/lubannn/personal-workspace/pull/18) | Tasks/Projects CSV | `0cc6a5bdf7e91e4eb9f024a93e9733395fe9b991` |
| [#19](https://github.com/lubannn/personal-workspace/pull/19) | 不可变 canonical ReportDraft | `62a19592ec5b42c07b6af63f90fb6d8836960f2b` |
| [#20](https://github.com/lubannn/personal-workspace/pull/20) | canonical Time Entry | `b5a05cb87453d6fb24e5e3e400c3e3a0cee047aa` |

Journal 发布前最新 `main`：`b5a05cb87453d6fb24e5e3e400c3e3a0cee047aa`。

Journal 发布前最新部署：GitHub Actions run `33331173201`（#79），`Deploy Personal Workspace PWA`，status `completed`，conclusion `success`。正式 Worker 已只读验证 Time Entry UI、报告指标、独立 CSV 与 portability 文案；没有点击写入按钮。

正式入口始终是 `nexus.lubannn.workers.dev`。Pages preview、旧 GitHub Pages 或随机账户子域不是产品入口。

### 5.4 本地工作树

本地仍有大量 modified/untracked 的有效文件，且 `.git` 索引不能完整反映上述远端 main。`docs/PROJECT_HANDOFF.md` 本地可能显示 untracked，这不表示可删除。不要清理、重置或批量提交。

`apps/github-pwa/app/page.tsx` 当前约 2288 行。UI sections 与 loading/bootstrap hooks 已拆出，但跨领域写入和 portable export/restore 编排使页面 orchestrator 再次增长。后续可按领域提取写入 hooks，但不得改变认证、SHA 冲突或 portability 安全门。

## 6. 下一接力点

### 6.1 第一优先：正式登录后的真实回归

PR #2–#20 的代码、测试、构建、部署与只读正式回归已完成；本轮没有对正式 Private 仓库执行真实 Journal 或其他新增测试写入。新会话应在用户针对每个精确写入动作确认后验证：

1. GitHub App 登录、Private collections 刷新和内存 token 生命周期；
2. Task 编辑/生命周期/tags/notes/duration/子任务的实际 SHA 写入与跨设备冲突；
3. Project、Phase、Milestone、Note，以及 Activity 部分成功边界；
4. Calendar 创建、编辑、取消/恢复、软删除/恢复及日/周/月刷新回读；
5. Dashboard layout 保存；
6. 包含全部新实体的 export、inspection、migration dry run；
7. 隔离恢复只使用新建且业务数据为空的 Private 目标；旧 restore-test 应被安全拒绝。
8. Journal 创建、版本化编辑、软删除/恢复、同日冲突拒绝和 Markdown 下载。

任何正式业务写入都要在动作发生时再次向用户确认精确内容；不要自行创建验收数据。若用户暂不愿写入，可先做只读登录/collection 检查，并保留未验收状态。

### 6.2 验收后的下一代码切片

推荐顺序：

1. **Journal 日期浏览与搜索**：只索引必要字段，删除或权限变化必须清除 projection。
2. **Journal Segment/Revision 设计**：先定义可逆渲染和 change reason，再导入 Legacy Word。
3. **Obsidian 单向同步准备**：由用户选择真实 Vault 和子目录，用无私人内容测试文件验证权限、编码、原子替换和冲突；不先开双向覆盖。
4. **Legacy Word Importer**：只读副本、preview、diagnostics、幂等 Import Log 和分批确认。
5. 再做 Learning、Habit、Health、AI Assistant、Publication/Share Layer。

## 7. 已知风险与技术债

- **页面 orchestrator 偏大**：`page.tsx` 约 2288 行，领域写入、portable export/restore 与状态仍集中。
- **正式验收债**：新 Task/Project/Calendar 扩展功能尚未完成正式 Private 真实写入与跨设备验收；代码上线不能替代业务验收。
- **GitHub API 扩展性**：目录列表后逐文件读取，增长后会增加延迟、请求数和 rate-limit 风险。
- **有限离线**：只保证应用外壳，不承诺核心数据离线编辑；不能假装弱网写入已保存。
- **明文隐私风险**：Private 不等于端到端加密；账号接管、误加协作者或仓库误设 Public 会暴露正文。
- **软删除不是擦除**：Git 历史仍保留正文；永久删除、历史重写和备份轮换尚无产品流程。
- **外部依赖**：认证依赖 Cloudflare、GitHub 和 D1，当前没有离线写入保证。
- **恢复目标一次性**：已有业务文件的 restore-test 再次恢复被拒绝是预期安全行为。
- **导出 v1 演进**：不兼容语义必须提升 `export_version`，不能悄悄扩展。
- **Task 时间语义仍较窄**：planned time、原始时区和跨时区编辑尚未开放；Time Entry 目前只支持手工日期与分钟。
- **Project Activity 非原子**：主操作成功、Activity append 失败是允许且必须显式报告的状态。
- **Calendar 边界**：当前只支持单日明确时段和前台提醒；重复、全天、后台 Web Push 和外部同步未实现。
- **Journal 边界**：当前每天一篇 daily、无搜索/Segment/Revision/Vault/Legacy Import；Private GitHub JSON 是唯一真源。
- **旧 SQLite 并存**：不要误改 `src/app` 或建立双写；正式代码在 `apps/github-pwa/app`。
- **Cloudflare 构建范围较宽**：main 更新会触发部署；发布后必须核对 workflow commit 和最终状态。
- **可观测性有限**：Worker 日志禁止正文、token 或健康 payload；尚无完整用户可见安全活动页。

## 8. 关键文件

| 文件/目录 | 作用 |
|---|---|
| `AGENTS.md`、`apps/github-pwa/AGENTS.md` | 开发约束与 Next.js 16 文档要求。 |
| `apps/github-pwa/app/page.tsx` | 正式 PWA 页面级状态和 GitHub 写入编排。 |
| `apps/github-pwa/app/workspace/use-github-app-bootstrap.ts` | GitHub App session、短期 token 和首次加载。 |
| `apps/github-pwa/app/workspace/use-workspace-collections.ts` | canonical collections 的读取、解析与加载状态。 |
| `apps/github-pwa/app/workspace/*-section.tsx` | Auth、Dashboard、Capture、Task、Project、Calendar、Portability、Readiness UI。 |
| `apps/github-pwa/app/workspace/page-model.ts` | 页面共享类型、日期/错误映射与 Private 连接边界。 |
| `apps/github-pwa/app/globals.css` | 正式 PWA 视觉及响应式布局。 |
| `src/lib/github-data/protocol.ts` | canonical envelope、路径、版本与软删除基础。 |
| `src/lib/github-data/github-contents.ts` | GitHub adapter、SHA 并发与原子多文件 commit。 |
| `src/lib/github-data/tasks.ts` | Task 详情、生命周期、Today、子任务规则。 |
| `src/lib/github-data/projects.ts` | Project 数据、生命周期与进度来源。 |
| `src/lib/github-data/project-phases.ts`、`milestones.ts` | Phase 与 Milestone 协议。 |
| `src/lib/github-data/project-notes.ts`、`activity-events.ts` | Project Notes 与 append-only Activity。 |
| `src/lib/github-data/calendar-events.ts` | CalendarEvent、时区、生命周期与日期范围。 |
| `src/lib/github-data/journal-entries.ts` | JournalEntry v1、日期唯一性、Markdown 派生与生命周期选择器。 |
| `src/lib/github-data/portable-export.ts` | 开放导出、manifest、SHA-256 与 inspection。 |
| `src/lib/github-data/portable-restore.ts` | 空目标检查、恢复计划与原子恢复。 |
| `src/lib/github-data/schema-migrations.ts` | 只追加 migration registry 与 dry run。 |
| `src/lib/github-data/*.test.ts` | canonical、引用、生命周期、portability 和边界测试。 |
| `apps/auth-worker/src/*` | OAuth、D1 session、CSRF、撤销、安全和静态代理。 |
| `.github/workflows/pages.yml` | main 构建与 PWA 部署 workflow。 |
| `docs/DATA_MODEL.md` | 当前与规划实体、关系、时间、来源和导出规则。 |
| `docs/PHASE_1C_DATA_PORTABILITY.md` | export/inspection/restore/migration/Dashboard 安全规则。 |
| `docs/PHASE_2_TASKS.md` | Task 规则与历史验收。 |
| `docs/PRIVACY_AND_SECURITY.md` | 数据分类、认证、日志、AI 与外部连接安全门。 |
| `docs/JOURNAL_IMPORT_SPEC.md` | Legacy Word Journal 只读解析、预览、幂等与 Import Log。 |
| `docs/PHASE_3_JOURNAL_CORE.md` | Journal Core 首切片、真源、时间、唯一性与 Obsidian 边界。 |
| `src/app`、`src/server`、`scripts` | Phase 1A 基线；不是正式可写主路径。 |

## 9. 继续开发必须遵守

- Public 代码与 Private 数据必须分离；改变可见性、协作者或 GitHub App 权限必须由用户明确决定。
- Private 数据允许明文存 GitHub，但只允许 TLS；该同意不等于允许公开、记录日志或发给 AI。
- 核心数据不依赖浏览器持久存储，不重新引入 Mac 常开依赖，不建立 GitHub/SQLite 双写。
- 所有更新携带最后读取到的 blob SHA；冲突显式展示。
- 删除默认软删除。永久删除、公开分享、恢复写入、外部连接、正式业务写入和 AI 高敏上下文均需清楚范围与动作时确认。
- 导出保持开放格式与完整性信息；恢复先 inspection，只写独立空 Private 目标，并使用单个原子 commit。
- schema/migration 版本化；已发布 migration 只追加；未知未来字段/Widget 尽量 round-trip 保留。
- Task 与 CalendarEvent 始终独立；移动时间块不能改 Task DDL。
- Project 报告事实必须可追溯，AI 只能润色确定性事实草稿。
- Journal 原 Word 永不覆盖；导入前预览，异常可见，未解析内容不得静默丢失，并生成支持幂等/回滚的 Import Log。
- Obsidian 先单向、原子写入、哈希/冲突；未验证前不得开放任意双向覆盖。
- Learning Area 可配置，不把现有领域写死。
- 健康数据必须 staging → 识别 → 用户确认 → canonical；训练建议不是医疗诊断。
- AI 默认无全库读取权；用户主动请求、最小上下文、发送前可见范围、输出先草稿。
- Share Layer 只读独立 Publication 快照，不直连 Private Core；默认 noindex，可撤销、有有效期与缓存清理策略。
- UI 保持个人手帐/编辑页面风格；响应式、键盘可用、有清晰焦点和足够对比度。
- 每个切片需自动测试、typecheck、lint、生产构建、精确 diff 审计和桌面/移动回归。涉及正式业务写入时，再做用户确认后的真实与跨设备验收。
- 发布后核对 workflow 对应 commit、最终 success，并从正式 Worker 验证当前产物。

## 10. 新会话的完成定义

若新会话选择正式回归，完成标准是：

- 每次正式 Private 写入前，用户确认精确测试记录与动作；
- 登录后 collections 读取成功，且不输出 token/正文；
- Task、Project、Calendar 各至少完成一个带版本递增和 blob SHA 的真实生命周期闭环；
- Project 主操作/Activity append 的部分成功提示被实际验证；
- 日/周/月刷新范围正确，Calendar 操作未改写 Task；
- 最新导出包含全部 canonical 类型，inspection 和 migration dry run 计数一致；
- 非空恢复目标被安全拒绝；真实恢复只使用新空 Private 仓库和单原子 commit；
- 正式数据、凭据和恢复包没有进入 Public Git、日志或测试 fixture；
- 只把实际发生的验收结果集中更新到本文，不预先宣称通过。

若用户选择继续代码而暂不做正式写入，必须明确保留上述正式验收债，并只推进边界清晰的垂直切片。
