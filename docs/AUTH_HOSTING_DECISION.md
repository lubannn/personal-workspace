# Auth Broker 托管选择

> 状态：已批准；GitHub App OAuth 四设备与完整会话生命周期验收全部通过
> 日期：2026-08-26
> 关联规格：`AUTHENTICATION_UPGRADE.md`

## 1. 建议结论

建议使用 **Cloudflare Workers Static Assets + D1 + Workers Secrets** 托管正式免手输入口。

理由：

- 一个 Worker 可在同一 Origin 同时提供静态 PWA 与 `/auth/*` 函数，避免 iOS Safari 的跨站 Cookie 问题。
- 不需要先购买自有域名，可用稳定的 `workers.dev` 地址完成 GitHub App callback 和四设备验收；未来可增加自有域名。
- D1 只保存少量会话元数据和加密后的 refresh token，不保存任何工作台业务正文。
- Workers Secrets 可保存 GitHub client secret 和应用加密密钥，密钥不进入 Git 或构建物。
- 静态资源、函数和会话数据库均有免费层，个人单用户流量远低于当前免费额度。
- Worker 使用标准 Fetch API，D1 使用 SQLite 语义；保留迁移到标准 Node.js + SQLite/PostgreSQL 的路径。

Git 集成的静态产物已发布到 `personal-workspace-app.pages.dev`，边缘 Worker 以该地址作为公开应用外壳上游；`personal-workspace-static.pages.dev` 暂时保留为静态回退。正式边缘入口为 `https://nexus.lubannn.workers.dev/`。现有 `lubannn.github.io/personal-workspace/` 保持在线，继续作为手工 PAT 回退入口。

重要限制：Cloudflare Free 使用全球网络，不等于 Cloudflare 中国大陆网络。Cloudflare 官方说明，跨越中国大陆网络边界的流量可能出现延迟和可靠性问题，而其中国大陆网络是 Enterprise 的单独订阅。因此首步只部署不含任何 secret 的健康检查和静态壳，在用户的 Mac、Windows、iPhone、iPad 实网测试通过前，不迁移正式入口、不创建真实认证会话。

## 2. 候选比较

| 方案 | 同源静态站点 + 函数 | 会话存储 | 无自有域名可用 | 个人成本 | 迁移复杂度 | 结论 |
|---|---|---|---|---|---|---|
| Cloudflare Workers + D1 | 原生支持 | 原生 D1 | 是 | 免费层足够原型 | 低至中 | 推荐 |
| Vercel + 外部数据库 | 支持 | 需另选数据库提供商 | 是 | Hobby 可用 | 中；增加数据库供应商 | 备选 |
| 自管 Node.js | 支持 | SQLite/PostgreSQL | 需长期在线主机 | 需要 VPS 或其他主机 | 运维最高 | 当前不选 |
| 继续 GitHub Pages | 仅静态 | 无 | 是 | 免费 | 无 | 只能保留 PAT 回退，无法实现安全持久会话 |

## 3. Cloudflare 资源边界

只创建以下资源：

1. 正式边缘 Worker：`nexus`，入口为 `nexus.lubannn.workers.dev`
2. 旧边缘 Worker：`personal-workspace-preview`，迁移期保留且不再作为新配置的部署目标
3. 一个 Git 集成的公开 PWA Pages 项目：`personal-workspace-app`；另保留 `personal-workspace-static` 作为回退
4. 一个 D1 数据库：`personal-workspace-auth`（已创建，APAC，首个 migration 已应用）
5. 三个 Worker Secrets：
   - `GITHUB_CLIENT_SECRET`
   - `TOKEN_ENCRYPTION_KEY`
   - `SESSION_HMAC_KEY`
6. 非敏感配置：
   - GitHub App Client ID
   - GitHub App slug
   - 允许的数据仓库 owner/name

不创建对象存储、日志正文存储、业务数据库或业务文件代理。

## 4. D1 数据范围

D1 只保存认证会话：

- 哈希后的 session ID
- GitHub 用户 ID 与 login
- 认证加密后的 refresh token
- access token 过期时间
- 会话创建、最后使用、到期和撤销时间
- 可选设备名称

业务数据继续直接写入 `personal-workspace-data`。Worker 不接收 Capture、日记、健康、任务或附件正文。

创建 D1 时使用 `apac` location hint，降低中国大陆周边设备的认证延迟。该 hint 是性能偏好而非法律意义上的数据地域保证；若未来出现强制地域要求，需单独迁移和复核。

## 5. 免费层与费用护栏

Cloudflare 官方当前说明：

- Workers Free：每天 100,000 次动态请求；静态 assets 请求免费且不限量。
- D1 Free：每天 5,000,000 rows read、100,000 rows written。
- D1 Free 数据库容量上限足以保存单用户会话；个人工作台预计每天只产生个位数到数十次认证数据库操作。

官方参考：

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare China Network](https://developers.cloudflare.com/china-network/)

费用规则：

- 首版只使用 Free plan。
- 不添加付费方式、不升级套餐、不启用可能产生按量费用的资源，除非用户再次明确批准。
- 达到免费额度时 fail closed 并显示服务暂时不可用，不自动产生费用。

## 6. 备份与可迁移性

- D1 提供自动 Time Travel；免费层保留期以 Cloudflare 当期政策为准。
- 会话表结构以 SQL migration 保存于 Public 代码仓库。
- D1 只保存可撤销的认证状态；即使会话数据库丢失，业务数据也不会丢失，用户只需重新 GitHub 授权。
- 停用 Cloudflare 时，可以删除全部会话、撤销 GitHub App，并继续使用 GitHub Pages + PAT 回退入口。
- Worker 的 GitHub/OAuth 领域逻辑与 Cloudflare bindings 分层，未来可迁移到标准 Node.js adapter。

## 7. 安全默认值

- Worker 路由默认 fail closed。
- Cookie：`Secure`、`HttpOnly`、`SameSite=Lax`、限定 Path、有限 Max-Age。
- OAuth 使用高熵 `state`、一次性 state cookie 和严格 callback URL。
- 只允许配置的 GitHub 用户和指定 Private 仓库。
- refresh token 在写入 D1 前使用 AES-GCM 认证加密。
- session ID 只保存 HMAC/哈希，不保存原值。
- 错误和访问日志不记录授权码、Cookie、token 或 GitHub API 响应正文。
- 生产 Secret 只由用户在 Cloudflare Secrets 界面或安全 CLI 输入，Codex 不读取或回显。

## 8. 实施前置动作

用户批准本选择后：

1. 在本地创建 Worker、D1 migration、认证核心和测试，不接触真实 secret。
2. 完成本地 mock GitHub OAuth、加密、会话、CSRF、撤销和日志边界测试。
3. 用户连接或创建 Cloudflare 账户。
4. 已部署不含 secret 的静态壳与 `/health`，并在 Mac、Windows、iPhone、iPad 和 Mac 关机场景下验证跨设备可用性。
5. 健康检查通过后，已创建 Free plan D1 数据库并应用 `0001_auth_sessions.sql`；2026-08-27 OAuth 验收后已写入首个加密认证会话。
6. 已创建 `nexus` Worker，并将账户子域名从 `huangyzh2d.workers.dev` 更新为 `lubannn.workers.dev`；旧 Worker 资源暂时保留。
7. GitHub App `Personal Workspace Auth` 已创建且仅安装到 `personal-workspace-data`，Homepage URL 使用 `https://nexus.lubannn.workers.dev/`，callback 使用 `https://nexus.lubannn.workers.dev/auth/callback`。
8. GitHub client secret、token 加密密钥和 session HMAC 密钥已安全写入 Workers Secrets；Secret 未进入 Git、构建物或浏览器持久存储。
9. 认证版本已部署到 100% 正式流量；Mac、Windows、iPhone、iPad 的 OAuth 登录、刷新、写入和跨设备读取均已通过。当前设备退出使有效会话从 5 降至 4，重新登录后恢复为 5；全部设备撤销后有效会话为 0、已撤销历史记录为 8，页面与 D1 状态一致。

## 9. 待用户批准

- 使用 Cloudflare Workers + D1 + Workers Secrets，但以四设备实网健康检查通过为继续条件。
- 首版只使用 Free plan，不添加付费方式。
- 暂时使用 `workers.dev` 地址；未来拥有自有域名后可以迁移。
- GitHub Pages 保持 PAT 回退入口，不删除。
