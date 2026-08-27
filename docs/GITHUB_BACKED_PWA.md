# GitHub-backed PWA 迁移规格

> 状态：已批准方向，原型进行中  
> 决策日期：2026-08-25

## 1. 用户决策

用户明确接受日记、健康、任务、附件及其他所有业务文件以未加密明文保存在 GitHub 私有仓库中。认证凭据不属于业务文件：GitHub token、密码、恢复码和外部 API key 永远不得提交。

目标是在 Mac 关机时，Mac、Windows、iPhone 和 iPad 仍能通过静态 PWA 使用工作台。

## 2. 仓库划分

- `personal-workspace`：Public；仅保存应用源码、文档、测试和 GitHub Pages workflow，不保存个人业务数据。
- `personal-workspace-data`：仅限私人数据文件与数据格式说明，必须保持 Private。

代码仓库和数据仓库分离，防止 Pages 发布步骤误把数据目录打进公开站点。

## 3. 运行与数据流

```text
GitHub Pages 静态应用
        ↓ GitHub 用户授权
GitHub 私有数据仓库
        ↓ Contents / Git Data API
浏览器内领域逻辑、索引与冲突 UI
```

读取：获取 manifest/index → 按需读取记录文件 → 校验 schema、ID 和哈希 → 写入可清除的本地缓存。

写入：读取当前 blob SHA → 校验领域 version → 提交单文件或原子 commit → 更新 projection → 若 SHA 已变化则创建冲突，不静默覆盖。

## 4. 文件协议 v1

```text
workspace.json
data/captures/<uuid>.json
data/tasks/<uuid>.json
data/projects/<uuid>.json
data/calendar-events/<uuid>.json
journal/YYYY/<uuid>.md
data/learning/<uuid>.json
data/habits/<uuid>.json
data/health/<uuid>.json
attachments/<owner-id>/<attachment-id>/<filename>
imports/<batch-id>/source.docx
imports/<batch-id>/import-log.json
indexes/*.json
```

JSON 采用 UTF-8、稳定字段名和显式 `schema_version`。Markdown 使用版本化 frontmatter。附件索引记录原文件名、MIME、大小和 SHA-256。

Capture 回收站在 v1 中不移动文件：原路径保持为 `data/captures/<uuid>.json`，以 `deleted_at` 区分 Inbox 与回收站。移入和恢复都递增 `version`，并以读取时的 blob SHA 作为写入前置条件。这样可以避免路径搬移产生的非原子多文件提交，也能保留稳定 ID、导出完整性和清晰 Git 历史。

## 5. 明文与 Git 历史边界

- Private 由 GitHub repository visibility 和账号权限提供，不代表端到端加密。
- GitHub、获得仓库权限的协作者及被盗账号可能读取完整明文。
- 删除或修改文件后，旧内容可能继续存在于 Git 历史、克隆、fork、缓存或导出中。
- 将数据仓库改成 Public 是高风险操作；应用设置页必须持续显示仓库 owner/name 和 visibility。
- 永久抹除需要专项 history rewrite，且不能保证清理其他既有副本。

## 6. 授权目标

Phase 1B 首个可用版本使用只授权 `personal-workspace-data` 的 fine-grained token，并仅申请 Metadata 读取与 Contents 读写权限。token 只存在于当前页面内存中，不进入 LocalStorage、SessionStorage、IndexedDB、日志或 Git；该入口现保留为高级回退。

正式默认入口已迁移为只安装于 `personal-workspace-data` 的 GitHub App。用户令牌交换由同源 Cloudflare Worker 最小 auth broker 完成；client secret 与加密密钥只存在于 Workers Secrets，不进入静态包。2026-08-27 四设备登录、刷新、读写、当前设备退出和全部设备撤销均已通过。

浏览器仍直接使用可注入 fetch 的 adapter 访问 GitHub Contents API；auth broker 不接收或代理任何业务正文。

## 7. 迁移顺序

1. 冻结并保留当前 SQLite 本地基线和加密备份。
2. 完成 GitHub 文件 adapter、冲突测试和静态构建。
3. 创建 Public 代码仓库与 Private 数据仓库，并为数据仓库配置最小权限。
4. 将 owner 配置和 Quick Capture 转换为 v1 文件，先写入测试分支。
5. 核对数量、哈希、Pages 不含私人数据后切换 canonical source。
6. 在四类设备验证登录、读取、写入、冲突和退出。

未经第 5 步人工核对，不删除 SQLite 数据，也不允许两个主真源同时写入。

## 8. Phase 1C 开放导出

工作台提供 `personal-workspace-export` v1 JSON：首个 scope 包含 `workspace.json` 和全部 Capture。manifest 为每个文件保存 Git blob SHA、UTF-8 字节数和 SHA-256；正文以原始开放文本保存在同一导出文件中。

浏览器恢复预检只读取用户选择的本地 JSON，检查版本、数量、哈希、owner、schema、ID 与路径，不上传也不执行 GitHub 写入。实际恢复必须晚于空目标判断、逐文件冲突保护和单独人工确认。

## 9. Capture 回收站与冲突保护

Inbox 只读取 `deleted_at: null` 的 Capture；回收站读取 `deleted_at` 非空的记录并允许恢复。界面不提供永久删除。每次生命周期写入使用 GitHub Contents API 的 `sha` 前置条件；如果另一设备已经更新相同文件，陈旧写入被转换为 `GITHUB_SYNC_CONFLICT`，用户刷新后再决定，不发生最后写入者静默覆盖。
