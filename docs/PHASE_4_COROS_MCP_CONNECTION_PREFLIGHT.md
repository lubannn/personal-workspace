# Phase 4 COROS MCP 连接预检

> 2026-09-25 只读技术预检。没有注册 OAuth 客户端、连接 COROS 账号、读取真实运动/健康数据，或改动 Private 仓库。

## 用户期望与当前边界

目标体验是用户在 Personal Workspace 中主动连接一次 COROS，之后按需同步新活动，不再逐条导出 FIT/TCX。现有文件路径仍是可恢复的回退与解析验收入口，不等于账号连接。Codex 客户端即使能独立连接 COROS MCP，也不会自动让 Personal Workspace 网页获得该连接或同步状态。

## 官方接口实测

- 未授权访问 `https://mcp.coros.com/mcp` 返回 HTTP 401，并通过 `WWW-Authenticate` 指向受保护资源元数据；本次请求被路由到 `https://mcpcn.coros.com/mcp`。路由不代表所有用户应固定使用中国大陆端点。
- 资源元数据声明 `openid`、`mcp.tools`、`offline_access`。授权服务器元数据声明 authorization-code、refresh-token、PKCE S256、动态客户端注册与撤销端点。
- 元数据**没有声明活动读取专用 scope**。COROS 官方 MCP 同时提供读取活动和写入训练计划/Workout 的工具。因此“我们的代码只调用读取工具”不能表述为“COROS 账号只授权了读取权限”。
- 官方说明没有 webhook；产品如需免文件导入，应在用户发起同步时或经另行配置的调度中轮询，并用稳定活动 ID/摘要去重。

这些是 2026-09-25 的公开接口观察结果，正式开发必须重新发现并校验 issuer、resource、端点和支持的授权方式；不得把当前元数据常量当成永久协议。

## 建议的第一版交付边界

1. 在 UI 中明确展示授权能力边界，并由用户在动作时启动 COROS OAuth。未获用户同意前不进行客户端注册或账号连接。
2. 独立连接器处理 COROS 凭据，不把长期/刷新令牌写入 Public Git、Private Git、浏览器持久存储或日志。若要跨刷新保持连接，需要服务端加密存储与显式撤销；这会扩大现有 GitHub-only auth broker 的信任边界，应先定架构。
3. 首版只允许调用 `querySportRecords` 和必要的 `getActivityDetail`。在连接器层设置工具 allowlist、日期范围上限、分页与响应大小限制；任何 COROS 写入工具均不可从工作台调用。
4. 首次只读同步先显示日期范围、运动数量和字段映射/丢失诊断；同步结果进入 `HealthStagingRecord`，复用现有逐条确认、去重与原子 canonical Workout 提交。不得自动生成正式 Workout、HabitCheckIn 或建议。
5. 不默认请求 FIT 原文件、GPS、轨迹点序列、用户生日、身高、体重、睡眠或日常健康。活动摘要足够时不取活动详情；需要新增数据域时另行设计与授权。
6. 授权失效、用户撤销、来源字段变化或远端结果无法稳定映射时停止同步，不猜测或悄悄覆盖 Private 数据。

## 尚需用户决定

- 是否接受 COROS 当前 `mcp.tools` 授权并非真正只读这一事实，即使 Personal Workspace 自身严格禁止调用写工具。
- 是否允许为“一次连接、跨设备继续使用”把 COROS 刷新令牌加密存入独立服务端存储，以及由哪个服务承接敏感活动摘要传输。
- 后续是“打开页面/手动点击时拉取”还是需要额外的定时轮询。无 webhook 意味着不能承诺实时推送。

在这些决定前，仅可继续无凭据的协议适配、合成数据映射和安全测试；不得上线账号连接按钮或读取真实 COROS 数据。

## 来源

- [COROS 官方 MCP 仓库](https://github.com/coroslab/COROS-MCP)
- [Build on COROS MCP](https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP)
- 2026-09-25 只读请求：`/.well-known/oauth-protected-resource/mcp` 与 `/.well-known/oauth-authorization-server`
