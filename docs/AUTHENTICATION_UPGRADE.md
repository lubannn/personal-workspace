# Personal Workspace 认证体验升级规格

> 状态：GitHub App OAuth 已上线；Mac、Windows、iPhone、iPad 登录、刷新与读写验收通过；退出与撤销复验待完成
> 版本：0.2
> 日期：2026-08-27

## 1. 目标

在不把 GitHub 凭据写入 Public 仓库、Pages 构建物或浏览器长期存储的前提下，减少每次刷新页面都要重新粘贴 fine-grained personal access token 的摩擦。

升级后仍必须满足：

- Mac、Windows、iPhone、iPad 可独立使用，Mac 关机不影响访问。
- GitHub App 只安装到 `personal-workspace-data`，只申请 Metadata 读取和 Contents 读写权限。
- 日记、健康、任务和附件继续由 Private GitHub 仓库保存。
- 认证服务不读取、不代理、不保存任何业务文件正文。
- Public `personal-workspace` 仓库和前端构建物不包含 client secret、private key、refresh token 或长期 access token。
- 用户可以查看当前设备会话、退出当前设备并撤销全部会话。

## 2. 当前基线

Phase 1B 最初使用只授权数据仓库的 fine-grained token：

- token 只保存在当前页面 JavaScript 内存中。
- 刷新、关闭或断开页面后 token 被清除。
- 浏览器直接调用 GitHub Contents API，业务数据不经过其他服务。
- 四类目标设备和 Mac 关机场景的真实读写均已通过。

这条路径安全边界清晰，也应继续作为紧急回退入口，但不适合作为长期日常登录体验。

## 3. 无法同时满足的三个条件

纯静态 GitHub Pages 无法同时满足：

1. 刷新后自动恢复登录；
2. token、refresh token 和会话秘密不进入浏览器持久存储；
3. 不存在任何服务端认证组件。

登录状态必须存放在某处。如果浏览器和服务端都不保存状态，刷新后就只能重新认证。

## 4. 官方能力核对

GitHub App 支持 Web Application Flow 和 Device Flow：

- GitHub 对有网页界面的应用推荐 Web Application Flow；授权码换取 user access token 时必须使用 client secret，因此不能在公开静态前端中完成。
- Device Flow 面向 CLI、IoT 和无浏览器环境。它不需要 client secret，但 GitHub 官方不建议普通 Web App 将它作为默认流程。
- 2026-08-25 对 `https://github.com/login/device/code` 的 Pages Origin 预检未返回允许跨域访问的响应，因此当前静态 PWA 不能可靠地直接执行 Device Flow。
- GitHub App 的可过期 user access token 有效期为 8 小时；refresh token 有效期为 6 个月，并可轮换。

官方参考：

- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)

## 5. 方案比较

| 方案 | 刷新后体验 | 凭据边界 | 新增依赖 | 结论 |
|---|---|---|---|---|
| 继续手工 PAT | 每次重新粘贴 | 最清晰；仅内存 | 无 | 保留为回退 |
| PAT 存 LocalStorage/IndexedDB | 自动恢复 | 长期凭据可被 XSS 或设备数据读取 | 无 | 禁止 |
| 让浏览器密码管理器保存 PAT | 可自动填充 | 凭据可能跨设备同步；仍是长期 PAT | 密码管理器 | 仅可作为用户明确选择的临时措施，不作为默认设计 |
| 静态 PWA 直接 Device Flow | 仍需授权，且端点跨域不可依赖 | token 仍需决定保存位置 | GitHub App | 不采用 |
| GitHub App + 最小同源 auth broker | 刷新后可恢复会话 | refresh token 仅在服务端加密保存；短期 token 仅在页面内存 | 一个可移植的小型服务 | 推荐 |

## 6. 推荐架构

将正式入口部署为“静态 PWA + 同源最小认证函数”。Public GitHub 仓库仍保存全部代码，Private GitHub 仓库仍是唯一业务数据真源。

```text
Browser / PWA
    │
    ├── GET /auth/login ───────────────→ GitHub App authorization
    │                                      │
    │                                      ↓
    ├── GET /auth/callback ←──── authorization code
    │          │
    │          ├── 服务端用 client secret 换取 token
    │          ├── 加密保存 refresh token
    │          └── 设置 HttpOnly + Secure + SameSite 会话 Cookie
    │
    ├── GET /auth/token ───────────────→ 返回短期 user access token
    │                                      （只进入当前页面内存）
    │
    └── GitHub Contents API ───────────→ personal-workspace-data
                                           （业务数据仍由浏览器直连 GitHub）
```

auth broker 只处理授权码、refresh token、短期 access token 和不透明会话 ID。它不接收 Capture、日记、健康数据、附件或其他业务正文。

## 7. 会话与密钥规则

- GitHub App client secret 只存在于托管平台的 Secret Manager。
- refresh token 使用服务端密钥认证加密，数据库中不保存明文。
- 浏览器只保存 HttpOnly 会话 Cookie；JavaScript 无法读取 Cookie。
- 短期 GitHub user access token 仅保存在页面内存，刷新时通过有效会话重新取得。
- 会话 ID 在服务端只保存哈希；Cookie 设置 `Secure`、`HttpOnly`、`SameSite=Lax`。
- `/auth/token` 只接受同源请求，并校验 Origin、CSRF、会话状态和速率限制。
- 退出当前设备时删除服务端会话并清除 Cookie；“撤销全部设备”使该用户的全部会话失效。
- GitHub App 被卸载、仓库授权被移除或 refresh token 失效时，前端回到显式重新授权状态。
- 不在 URL、日志、分析事件、错误详情或 Git 提交中记录任何 token。

## 8. 托管边界

GitHub Pages 不能运行 auth broker。正式免手输入口需要支持同源函数和 Secret Manager 的托管环境；实现保持标准 Web API，避免绑定单一平台。

候选部署形态：

- Cloudflare Pages/Workers；
- 标准 Node.js 小型服务；
- 其他支持同源静态资源、函数、HTTPS Cookie 和 Secret Manager 的平台。

在新入口完成验收前，现有 GitHub Pages + 手工 PAT 保持可用，作为可回退版本。业务数据无需迁移。

## 9. 最小服务端数据

认证服务只允许保存：

- `session_id_hash`
- `github_user_id`
- `github_login`
- `encrypted_refresh_token`
- `access_token_expires_at`
- `created_at`
- `last_used_at`
- `expires_at`
- `revoked_at`
- 可选的用户自定义设备名称

禁止保存：

- PAT
- 私有仓库文件内容
- 日记、健康、任务或附件
- GitHub 密码、MFA、passkey 或恢复码

## 10. 验收标准

- 四类目标设备均可通过 GitHub 授权连接指定 Private 仓库。
- 刷新页面后无需重新粘贴 PAT，可自动恢复有效会话。
- Mac 关机时移动设备仍可登录、读取和写入。
- Public 仓库、构建物、浏览器 LocalStorage/SessionStorage/IndexedDB 中不存在长期凭据。
- GitHub App 未安装到其他仓库，也没有超出 Metadata 读取和 Contents 读写的权限。
- 退出当前设备、撤销全部设备、卸载 GitHub App 和 refresh token 过期均有明确失败路径。
- auth broker 日志抽查不包含 token 或业务正文。
- 停用 auth broker 后，用户仍可通过现有手工 PAT 回退入口访问同一数据仓库。

## 11. 实施顺序

1. 用户批准本规格和“增加最小认证托管组件”的架构变化。
2. 选择托管环境；确认费用、域名、Secret Manager、数据地区和可导出性。
3. 注册只授权 `personal-workspace-data` 的 GitHub App。
4. 实现 auth broker、加密 session store、CSRF/Origin 校验、速率限制和退出流程。
5. 前端增加“使用 GitHub 登录”，同时保留“使用 PAT 回退”。
6. 在测试仓库验证权限、撤销、过期、并发和日志边界。
7. 在 Mac、Windows、iPhone、iPad 重新完成登录、刷新、写入、读取和退出验收。
8. 验收完成后将 GitHub App 登录设为默认，PAT 入口降级为高级回退。

当前进度：步骤 1 至 6 已完成。GitHub App `Personal Workspace Auth` 已创建并且
只安装到 `lubannn/personal-workspace-data`；`nexus` Worker 已配置 Client ID、
Workers Secrets 和 D1。2026-08-27 已完成桌面浏览器授权、callback、短期 token、
Private 仓库读取和刷新后会话恢复验证，D1 中生成了首个有效会话。随后用户在
Mac、Windows、iPhone、iPad 上完成 GitHub App 登录、刷新、写入与跨设备读取，
四设备核心流程均通过；当前 D1 中有 5 个同账号有效会话，其中一个为初始桌面
验收会话。步骤 7 仅余当前设备退出与全部设备撤销的实机复验。

## 12. 已确认决策

- 批准增加一个不接触业务正文的最小 auth broker。
- 正式免手输入口使用 Cloudflare Workers；GitHub Pages 继续作为 PAT 回退入口。
- 正式入口为 `https://nexus.lubannn.workers.dev/`。
- GitHub App 只允许当前账户安装，只授权 `personal-workspace-data`，仅申请
  Metadata 读取和 Contents 读写权限。
