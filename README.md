# Personal Workspace

Personal-first、single-user-first 的长期个人工作台。原有 Node.js + SQLite 本地技术基线保留为回退方案；目标架构已切换为 GitHub Pages 静态 PWA + GitHub 私有明文数据仓库，使 Mac 关机后仍可跨设备使用。

## GitHub 静态 PWA 原型

```bash
pnpm build:github-pwa
```

构建产物位于 `apps/github-pwa/out/`，只包含静态应用代码，不包含 `.data/`、SQLite、日记、健康数据或认证凭据。当前原型可以预览 Quick Capture 的开放文件格式，但在 GitHub App 授权完成前不会写入真实数据。

目标仓库：

- `personal-workspace`：代码与 GitHub Pages workflow。
- `personal-workspace-data`：Private、未加密明文的业务数据。

完整决策见 [GitHub-backed PWA 迁移规格](./docs/GITHUB_BACKED_PWA.md)。

## 原 SQLite 基线当前可用

- 首次创建唯一 owner。
- 密码登录和数据库 session。
- 响应式 Today Dashboard。
- 服务端持久化 Quick Capture Inbox。
- Dashboard Widget Registry 与默认布局。
- 重新验证密码后的 JSON 导出。
- SQLite migration、审计、后台任务和附件基础表。
- PWA manifest、有限离线页和安全响应头。
- Capture 归档、软删除和可恢复回收站。
- 登录设备列表、单设备撤销和撤销其他设备。

Tasks、Projects、Calendar、Journal、Learning、Habits、Health 和 AI 的完整业务能力会按 [路线图](./docs/ROADMAP.md)逐步实现。

## 本地启动

需要 Node.js 24 和 pnpm 11：

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

打开 `http://localhost:3000`，首次访问会进入 `/setup`。请创建至少 12 个字符的密码；项目不提供默认密码。

默认数据库：`.data/workspace.db`。核心数据不保存在 LocalStorage；LocalStorage 只用于未提交的 Quick Capture 临时草稿。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 备份

确保数据库已经创建后运行：

```bash
pnpm backup
```

一致性备份和 SHA-256 manifest 会写入 `.data/backups/`。备份脚本不替代异机加密备份；正式部署后应将该目录复制到独立、加密的位置并定期做恢复演练。

将备份加密为不可覆盖的 `.pwbackup` 文件（口令在终端中无回显输入）：

```bash
pnpm backup:encrypt -- .data/backups/workspace-<timestamp>.db .data/backups/workspace-<timestamp>.pwbackup
```

解密时必须指定一个尚不存在的新数据库路径：

```bash
pnpm backup:decrypt -- .data/backups/workspace-<timestamp>.pwbackup .data/restored/decrypted-workspace.db
```

加密口令应保存在密码管理器中，不应与 Workspace 登录密码相同；忘记口令后无法恢复。

恢复到一个不存在的新数据库路径：

```bash
pnpm restore -- .data/backups/workspace-<timestamp>.db .data/restored/workspace.db
```

容器与跨设备入口见 [部署说明](./docs/DEPLOYMENT.md)。

Obsidian 单向写入的隔离验证结论见 [Obsidian Spike](./docs/OBSIDIAN_SPIKE.md)。它尚未连接或扫描真实 Vault。

## 数据与安全

- `.data/`、`storage/`、导出和环境文件均已排除在版本控制之外。
- 生产环境必须使用 HTTPS，并设置 `SECURE_COOKIES=true`。
- 不要上传客户敏感信息或未经脱敏的工作资料。
- 完整边界见 [隐私与安全设计](./docs/PRIVACY_AND_SECURITY.md)。
