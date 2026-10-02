# COROS 接入可用性与合规性调研

> 调研日期：2026-09-19
> 状态：只读调研；未连接 COROS 账号，未获取或写入任何 COROS 数据。

> 2026-09-25 补充：一次连接的安全边界与官方 OAuth 元数据实测见 [Phase 4 COROS MCP 连接预检](PHASE_4_COROS_MCP_CONNECTION_PREFLIGHT.md)。官方当前仅声明通用 `mcp.tools`，不能把计划中的只调用读取工具误称为账号级只读授权。

## 1. 结论

COROS 目前已有两条官方程序化接入路径：

1. **COROS MCP**：面向单个用户的自助式 OAuth 2.0 接入，不需要提交 Partner API 申请。官方文档声明可读取活动、健康、睡眠、恢复与训练数据；能力和工具列表仍在演进。
2. **Partner API**：面向已有用户规模的平台，提供多用户 OAuth、Webhook、双向同步、FIT 下载和日常健康数据，需要公司主体、技术联系人、安全与隐私合规，并接受 COROS API 条款。

因此，Personal Workspace 不应使用抓取、逆向或非官方账号自动化。当前推荐顺序是：

1. 保留手工录入与 FIT/TCX 文件导入 adapter，作为稳定、可审计的基础路径；
2. 将官方 COROS MCP 设计为用户主动启用的可选单用户连接器；
3. 首版只开放最小范围读取，所有结果先进入 Health/Activity staging；
4. 未经用户逐条或按明确批次确认，不得进入 canonical，不得触发 Habit 或建议；
5. 暂不申请或依赖 Partner API；只有产品确实进入多用户平台阶段后再评估。

## 2. 官方能力现状

### 2.1 COROS MCP

官方帮助中心和 `coroslab/COROS-MCP` 仓库给出的接入点为：

- 全球路由：`https://mcp.coros.com/mcp`
- 中国大陆：`https://mcpcn.coros.com/mcp`
- 欧洲：`https://mcpeu.coros.com/mcp`
- 美国：`https://mcpus.coros.com/mcp`

公开说明中的主要边界：

- OAuth 2.0；每名用户只授权自己的数据；
- 无需 Partner API 申请；
- 无 Webhook，需要调用方轮询；
- 不提供 Partner API 级别的双向活动同步或 GPX 路由能力；
- 可读取活动记录、活动详情、分圈、FIT 文件、设备和用户资料；
- 官方帮助中心还列出日常健康、睡眠、心率、HRV、压力、恢复与训练相关数据；
- FIT 文件请求存在每日数量限制；
- 工具和字段可能变化，不能把当前列表当作永久协议。

2026-09-18 的官方说明把训练计划与训练写入标为 2026-09-21 可用。以本调研日期 2026-09-19 为准，Personal Workspace 必须继续把 COROS 连接器视为**只读能力**，即使服务端提前出现写工具也不得调用。

### 2.2 Partner API

Partner API 提供多用户 OAuth 2.0、Webhook、双向活动同步、日常健康数据、FIT 下载、训练计划和路线能力。官方要求包括：

- 已有明确用户规模的平台；
- 注册公司和授权技术代表；
- 安全与数据隐私合规；
- 接受 API 使用条款；
- 提供 OAuth redirect URI 等技术信息。

Personal Workspace 当前是单用户、Private GitHub-backed 产品，不满足也不需要这条路径。把 Partner API 作为当前核心依赖会增加凭据、服务端回调、Webhook、删除请求和运营合规负担。

### 2.3 手工文件导入

COROS 官方支持单条或批量导出活动数据，常见格式包括 FIT、TCX 和 GPX。该路径不需要长期账号连接，适合作为 Personal Workspace 的可恢复基础能力。

注意：COROS 关于“导入到 COROS”的说明明确区分活动与日常数据；睡眠、步数、日常心率等不能按普通 FIT/TCX 活动导入到 COROS。Personal Workspace 自身的导入设计也必须区分 `activity` 与 `daily health/sleep`，不得假定一个文件格式覆盖所有数据域。

## 3. 推荐架构

```text
COROS MCP OAuth / 用户选择的 FIT、TCX 文件
                    │
                    ▼
          ExternalRawRecord（最小元数据）
                    │
                    ▼
       Health / Activity Staging（pending）
                    │
          用户检查、修正、确认或拒绝
                    │
                    ▼
       canonical Health / Sleep / Activity
                    │
                    ▼
      可解释规则建议（仍需用户确认）
```

关键约束：

- COROS 数据不能绕过 staging；
- pending 数据不能触发 HabitCheckIn、运动建议或报告事实；
- OAuth 连接必须由用户主动开始，并提供明确撤销入口；
- 默认不请求用户资料中的生日、性别、身高、体重；只有具体功能需要且用户明确同意时才读取；
- 首次同步必须先展示时间范围、数据类型、预计记录数和落盘范围；
- 不做全历史后台抓取，不把原始 FIT/GPS 轨迹默认写入 Git；
- 日志只记录请求类型、状态、数量和不含正文的标识，不记录 token、轨迹、健康 payload 或完整 MCP 返回；
- MCP 返回结构或字段变化时 fail closed，进入兼容性错误，不猜测映射；
- 任何未来写回 COROS 的训练计划或 workout 都必须另立设计、预览与动作时确认，不能复用读取授权。

## 4. 分阶段建议

### A. 文件导入 adapter

- 本地选择单个 FIT/TCX 文件；
- 浏览器内解析和预览，默认不上传原文件；
- 生成确定性映射、重复检测和 staging 计划；
- 用户确认后才把规范化记录写入 Private GitHub；
- 保留来源文件哈希、解析器版本和字段丢失说明。

### B. COROS MCP 只读连接器

- 独立的 `IntegrationAccount`，记录 provider、授权状态、scope 摘要与撤销状态；
- OAuth token 不进入 Git、不进入浏览器持久存储；
- 先支持用户指定日期范围的活动摘要，随后再评估睡眠与日常健康；
- 每次导入先生成 staging preview；
- 不调用分析型或写入型工具作为 canonical 来源；分析只能基于确认后的本地事实。

### C. Partner API 重新评估条件

只有同时满足以下条件时再考虑：

- 产品成为真实多用户服务；
- 有公司主体、隐私政策、删除/导出流程和安全联系人；
- 确实需要 Webhook、双向活动同步或路线能力；
- 能承担服务端 secret、回调校验、速率限制、重试与事故响应。

## 5. 实施前必须验证

- COROS MCP 的实际 OAuth discovery、PKCE/客户端注册方式和撤销语义；
- 每个读取工具的稳定结构、分页、日期范围、时区和速率限制；
- 中国大陆账号与全球账号的路由及数据驻留差异；
- 睡眠 `local_date` 在 MCP 返回中的定义；
- 活动 ID、FIT 文件与日常健康记录的去重键；
- 用户撤销授权后，本地已确认 canonical 数据的保留与删除政策；
- COROS Terms、Privacy Policy 与 MCP/Partner API 专项条款对缓存、再分发和衍生分析的限制。

## 6. 决策

当前允许继续设计和实现**本地文件导入 adapter**。COROS MCP 可进入技术 spike，但在完成 OAuth、返回结构、撤销和数据最小化验证前，不进入正式 Private 数据链路。Partner API 暂不申请。任何 COROS 账号连接、实际数据读取或 Private 写入都需要用户另行明确授权。

## 7. 官方来源

- [Build on COROS MCP](https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP)
- [COROS MCP 官方仓库](https://github.com/coroslab/COROS-MCP)
- [Connect Your COROS to AI](https://support.coros.com/hc/en-us/articles/50841795180948-Connect-Your-COROS-to-AI)
- [Partner API Access](https://support.coros.com/hc/en-us/articles/53181766856724-Partner-API-Access)
- [Submit an API Application](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application)
- [Bulk Export Historical Activity Data](https://support.coros.com/hc/en-us/articles/33125636125204-Bulk-Export-Historical-Activity-Data)
- [Activities Page & Activity Summary](https://support.coros.com/hc/en-us/articles/15284799576980-Activities-Page-Activity-Summary)
- [COROS Privacy Policy](https://coros.com/privacy)
- [COROS Terms of Service](https://www.coros.com/terms)
