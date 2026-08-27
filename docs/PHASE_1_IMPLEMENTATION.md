# Phase 1 实施基线

> 状态：SQLite 本地基线完成；Phase 1B GitHub-backed PWA 验收通过；Phase 1C 导出预检与 Capture 生命周期已验收
> 开始日期：2026-08-24
> 本地基线完成日期：2026-08-25

## 2026-08-25 架构调整

用户明确接受日记、健康及所有业务文件以未加密明文保存到 GitHub 私有仓库，并要求 Mac 关机后仍可使用。目标架构因此切换为 GitHub Pages 静态 PWA + 独立 Private 数据仓库；本文件后续章节记录的 SQLite 成果保留为回退与迁移来源，不再代表最终跨设备拓扑。

Phase 1B 已完成：

- GitHub 文件协议 v1 与稳定记录路径。
- Private repository 强制校验、UTF-8/base64 Contents API adapter。
- blob SHA 乐观并发和显式冲突错误。
- 独立 Next.js static export PWA 原型，无 API、Cookie、Server Action 或 Node.js runtime。
- GitHub Pages workflow；只上传 `apps/github-pwa/out`，不接触 `.data`。
- Public `personal-workspace` 代码仓库、Private `personal-workspace-data` 数据仓库与上线的 GitHub Pages。
- 仅保存在当前页面内存的 fine-grained token 连接、Private 可见性强制校验和 `workspace.json` owner 校验。
- Quick Capture 真实文件写入、最近记录读取与手工跨设备刷新。
- 桌面与 390px 手机布局、无横向溢出和控制台检查。

## 2026-08-25 跨设备实机验收

- Mac 浏览器：Private 仓库连接、首条 Capture 写入、整页刷新、重新输入令牌和回读通过。
- iPhone Safari：读取 Mac Capture、写入 iPhone Capture 通过；Mac 端从 GitHub 刷新后可见。
- iPad Safari：读取既有 Capture、写入 iPad Capture 通过；Mac 端从 GitHub 刷新后可见。
- Mac 完全关机：iPhone 仍可重新连接、读取既有 Capture 并写入新 Capture，独立运行验收通过。
- Windows 工作电脑：经用户确认公司合规与安全策略允许后，连接、读取和跨设备写入通过。
- Mac、Windows、iPhone、iPad 四类目标设备读取的数据均来自 `personal-workspace-data`，未依赖 Mac 本地存储或 Mac 上运行的服务。

Phase 1B 认证升级已完成：

- Cloudflare Worker + D1 最小 auth broker 已部署到 `https://nexus.lubannn.workers.dev/`。
- GitHub App 仅安装到 `personal-workspace-data`，权限限定为 Metadata 读取与 Contents 读写。
- OAuth state + PKCE、HttpOnly 会话 Cookie、HMAC session ID、加密 refresh token、同源 CSRF 与显式用户/仓库 allowlist 已实现。
- 2026-08-27 Mac、Windows、iPhone、iPad 的 GitHub App 登录、刷新、写入与跨设备读取均已通过；D1 核对到 5 个同账号有效会话，其中一个为初始桌面验收会话；手工 PAT 入口保留为回退。
- 当前设备退出使有效会话从 5 降至 4；重新登录恢复为 5；全部设备撤销后有效会话为 0、已撤销记录为 8，页面与 D1 状态一致。
- GitHub App 登录为正式默认入口，手工 PAT 仅作为高级回退；Phase 1B 认证升级验收完成。

## 2026-08-27 Phase 1C 启动

首个数据可迁移垂直切片已经实现：

- 从 canonical Private 仓库读取 `workspace.json` 与全部 `data/captures/*.json`。
- 生成 UTF-8 开放 JSON 导出包，包含来源仓库、导出版本、范围、计数、Git blob SHA、字节数和逐文件 SHA-256。
- 下载前自动运行同一套恢复预检；用户也可以重新选择本地导出文件进行只读预检。
- 预检覆盖格式/版本、manifest 集合、数量、哈希、workspace、owner、Capture schema、ID 与路径一致性。
- 导出和预检不保存或包含 GitHub/Cloudflare 凭据；预检不会上传或写回数据。

Windows 正式环境导出回选（15 个文件、14 条 Capture）和 iPad 预检均已通过。真正的批量恢复写入仍需空目标约束与独立确认，详细协议见 `PHASE_1C_DATA_PORTABILITY.md`。

Phase 1C 第二个垂直切片已实现并通过跨设备正式环境验收：

- Capture 使用同路径 `deleted_at` 软删除，不执行物理删除，也不提供永久删除入口。
- Inbox 与回收站分离展示；恢复会清空 `deleted_at`，两种操作都递增记录版本。
- 更新携带读取时的 Git blob SHA；跨设备陈旧写入会显式冲突，不静默覆盖。
- 导出继续读取全部 Capture，因此回收站记录也包含在开放数据包中。
- 一台设备移入回收站、另一台设备刷新并恢复、原设备再次刷新回读的完整链路已通过。

Phase 1C 第三个垂直切片已完成本地实现：

- 恢复目标必须是同一 owner 下、不同于来源仓库、已初始化且业务数据为空的 Private 仓库。
- 目标可以保留 README 等非业务文件，但任何 canonical 数据根路径都会阻断恢复。
- 全部文件以 Git blobs → tree → commit → 非强制 ref 更新的单次原子提交写入。
- 执行前重新检查目标 HEAD；并发变化会中止，不允许覆盖。
- 用户必须再次输入完整目标仓库名才可执行；来源仓库不会被修改。
- 47 项自动测试、类型检查、Lint、生产构建与 390px 本地布局检查通过；正式隔离仓库演练待确认。

## 已确认技术基线

- Web：Next.js 16 App Router + React 19 + TypeScript。
- 样式：原生 CSS design tokens，不绑定组件 SaaS 或重型 UI 框架。
- 数据库：SQLite 单文件数据库，启用 WAL、外键和显式 SQL migrations。
- 数据访问：server-only DAL/repository，所有业务读取都带 owner 边界。
- 认证：首位 owner 初始化、scrypt 密码哈希、数据库 session、浏览器仅保存 HttpOnly 随机 session cookie。
- 文件：本地文件系统 adapter 为首个实现，附件元数据与文件内容分离。
- PWA：manifest、应用图标、有限 service worker；不缓存私人页面响应。
- 部署：标准 Node.js server，可容器化但不依赖特定云平台。

SQLite 适合 single-user-first 的首发拓扑，也便于备份和自托管。数据访问和 migration 不向客户端暴露 SQLite 细节；当并发、远程部署或多用户需求证明需要时，再迁移 PostgreSQL。

## 本轮垂直切片

- 应用壳和响应式导航。
- 首次 owner 初始化、登录、退出和受保护页面。
- Dashboard Widget Registry、默认布局和状态卡片。
- Quick Capture Inbox，核心内容落服务端数据库。
- Capture 归档、软删除、回收站恢复，不提供不可逆删除入口。
- 登录设备列表、当前设备识别、单会话撤销和其他会话批量撤销。
- JSON 导出与 manifest。
- 审计事件、后台任务和附件的基础数据表。
- PWA manifest、离线说明和安全响应头。
- SQLite 一致性备份、SHA-256 manifest、只恢复到新路径的恢复工具。
- scrypt + AES-256-GCM 加密备份、无回显口令输入和认证失败保护。
- Next.js standalone、Dockerfile、Compose 和跨设备部署说明。
- Obsidian 本地 Vault 单向写入 adapter 隔离 spike：原子创建、SHA-256 并发控制、路径/符号链接防护。
- 自动测试、类型检查、代码检查和生产构建。

## 已完成验证

- ESLint、TypeScript、Vitest（4 个测试文件、8 项测试）全部通过。
- Next.js production build 通过，打包后的 standalone server 可独立启动。
- 真实 owner 登录态可在生产包中读取；Inbox、设置和设备会话页面通过浏览器检查。
- 最新备份恢复到独立临时数据库后，SQLite `integrity_check` 为 `ok`，2 项 migration 和 1 个 owner 均可读取。
- 加密包往返、错误口令、密文修改和禁止覆盖验证通过。
- owner 对象边界、导出凭据排除、未登录导出 401 和基础安全响应头验证通过。
- Obsidian 隔离 Vault 的外部编辑冲突、路径穿越和符号链接逃逸验证通过；未读取真实 Vault。
- Restricted 数据未写入客户端 LocalStorage；密码、密码哈希和 session token 未进入页面或导出。

## 尚未满足的 Phase 1 退出项

- 加密备份能力已就绪，但异机备份目标和用户保管的正式加密口令尚未配置。
- Obsidian adapter 隔离 spike 已通过；真实 Vault 路径、云盘语义和 iOS PWA 限制仍待实机验证。
- Docker 配置已生成；当前开发机未安装 Docker，因此以 standalone production server 完成运行验证。

## 明确延后

- Tasks、Projects、Calendar、Journal 等完整业务 CRUD。
- Obsidian 实际写入及双向同步。
- Legacy Word Importer 实现。
- COROS、外部 Calendar 和 AI provider。
- 完整离线编辑、推送通知和 Share Layer。

## 开发运行要求

- Node.js 24（最低兼容线将在安装依赖后由 lockfile 和 CI 固定）。
- pnpm 11。
- 数据默认保存在项目根目录 `.data/`，该目录不进入版本控制。
- 首次访问 `/setup` 创建唯一 owner；之后 setup 自动关闭。

## 安全限制

- 不提供默认密码或演示账号。
- 密码不得进入日志或数据库明文。
- session cookie 使用 HttpOnly、SameSite=Lax；生产 HTTPS 下启用 Secure。
- 导出要求已登录，响应禁止缓存，并记录审计事件。
- LocalStorage 仅允许保存未提交的 Quick Capture 草稿，不是数据真源。
- service worker 不缓存 Dashboard、API、导出或其他私人响应。
