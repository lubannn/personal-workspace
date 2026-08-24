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
trash/<entity-type>/<uuid>.json
indexes/*.json
```

JSON 采用 UTF-8、稳定字段名和显式 `schema_version`。Markdown 使用版本化 frontmatter。附件索引记录原文件名、MIME、大小和 SHA-256。

## 5. 明文与 Git 历史边界

- Private 由 GitHub repository visibility 和账号权限提供，不代表端到端加密。
- GitHub、获得仓库权限的协作者及被盗账号可能读取完整明文。
- 删除或修改文件后，旧内容可能继续存在于 Git 历史、克隆、fork、缓存或导出中。
- 将数据仓库改成 Public 是高风险操作；应用设置页必须持续显示仓库 owner/name 和 visibility。
- 永久抹除需要专项 history rewrite，且不能保证清理其他既有副本。

## 6. 授权目标

优先使用只安装到 `personal-workspace-data` 的 GitHub App，并仅申请实现文件同步所需的最小权限。Pages 静态包可以包含公开的 App client ID，但不得包含 client secret、private key 或访问 token。

在正式授权流完成前，原型使用可注入 fetch 的 adapter 和 mock API 验证数据契约，不要求把长期 token 粘贴进页面。

## 7. 迁移顺序

1. 冻结并保留当前 SQLite 本地基线和加密备份。
2. 完成 GitHub 文件 adapter、冲突测试和静态构建。
3. 创建 Public 代码仓库与 Private 数据仓库，并为数据仓库配置最小权限。
4. 将 owner 配置和 Quick Capture 转换为 v1 文件，先写入测试分支。
5. 核对数量、哈希、Pages 不含私人数据后切换 canonical source。
6. 在四类设备验证登录、读取、写入、冲突和退出。

未经第 5 步人工核对，不删除 SQLite 数据，也不允许两个主真源同时写入。
