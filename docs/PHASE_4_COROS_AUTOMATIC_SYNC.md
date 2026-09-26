# COROS 自动同步：实施边界与验收

> 2026-09-25：用户将目标调整为工作台直连 COROS，运动活动、睡眠、心率及选定日汇总指标无需逐条确认即可入库；冲突和不确定映射留待处理。本文是实施契约，不表示服务已经连接或上线。

## 产品行为

- 用户在 Personal Workspace 单独完成一次 COROS OAuth。Codex 插件的现有授权不能转交给工作台。
- 首批自动域：运动活动、主睡眠与小睡、日均/静息心率、步数、压力、睡眠 HRV 和恢复状态的日汇总。经期数据、GPS 原始轨迹与逐秒曲线不纳入。
- 连接后由服务端定时拉取；浏览器关闭时仍能运行。MCP 无 webhook，不能承诺实时到达。
- 新增、可稳定识别且字段校验通过的记录自动成为正式 Workout / SleepSession / HealthMetric，不要求每条确认。
- 同一来源 ID 和相同内容的重试是 no-op。相同来源 ID 但内容变化、与手工记录疑似重复、时区或分类不明、字段越界等情况进入待处理区；绝不静默覆盖正式记录。
- 初次连接仍默认暂停。启用后，先对本文件限定的自动域执行一次历史回填，再转入增量轮询；“全部历史”是 COROS 对这些域实际提供且能验证的记录，不扩展到经期、原始 FIT/GPS 或逐秒曲线。历史范围、COROS 可访问的最早日期、预计数量及服务限额必须先以只读方式确认，不能假设所有年代均可通过 MCP 取得。
- 历史回填按 COROS 工具允许的时间窗口分批执行，逐批记入独立游标和计数；失败、暂停或断开后可从最后成功窗口恢复，不能因重试重复创建。活动 FIT 的官方日限额为每自然日 50 个请求；未经适用许可和容量核对不得把它当作无限量历史通道。
- 回填追上当前日期后，只轮询新增的短窗口，并有限重查最近数日以接住延迟上传与事后修订。重查不等于重复入库：相同来源 ID + 相同指纹是 no-op，内容变化进入待处理。历史窗口不常规重扫，只在用户主动修复或来源要求时重跑。暂停、断开、进度、最近成功时间和错误状态必须可见。
- 现有手工与 FIT/TCX 文件导入仍保持逐条确认，不能被自动规则顺带放宽。

## 凭据和授权

- COROS 当前 MCP OAuth 元数据只有通用 `mcp.tools` 等 scope，不能声称远端授权是只读。工作台连接器自身使用硬编码读取工具 allowlist，拒绝所有训练写入工具。
- COROS 的公开文档同时列出 MCP 活动查询/FIT 读取，又注明“COROS 到平台的活动同步需 Partner API”。因此，MCP 活动读取能力不等于自动活动入库的发布许可；在 COROS 确认适用边界或取得 Partner API 接入前，正式运动活动自动同步保持关闭。睡眠与日汇总的实施和验证可独立推进。
- COROS 刷新凭据仅在服务端加密存储；不进入 Private Git、Public Git、浏览器存储或日志。对现有 GitHub 登录的退出语义，需明确区分“退出当前设备”和“断开后台同步”。
- 定时任务还需要**独立的服务端 GitHub 写入身份**；现有浏览器 GitHub token 不能在后台使用。优先评估安装范围仅为 `personal-workspace-data` 的 GitHub App installation token，并最小化 Contents 权限。不得复用用户浏览器 token 或把 PAT 存入代码。
- OAuth 连接、断开和同步控制操作要求已登录用户、同源 CSRF 防护与 GitHub allowlist。调度器不可由公开 HTTP URL 无鉴权触发。

## 数据与事务

- 先固定 COROS 返回结构和单位映射，再为每种域建立版本化映射。只取实现所需的活动摘要、睡眠段及选择的日指标；默认不保存原始 FIT、GPS 轨迹或逐秒曲线。
- 每条候选含 `source_id`、映射版本与规范化内容 SHA-256。正式数据保存来源身份与同步版本，支持可审计的去重与冲突判断。不能以标题、日期或展示文本充当唯一 ID。
- 自动入库的正式记录不能伪称“用户已确认”。Workout 和 Health/Sleep 现有 `confirmation_status: confirmed`、`user_adjusted: true` 等字段需要版本化扩展为 `import_mode: automatic`、`review_status` 等真实语义；旧记录保持可读。
- 创建正式记录与来源索引/审核状态使用同一个带预期 head 的 Git commit；并发失配时重新读取，不回退为多个部分提交。
- 待处理冲突需要明示来源、新旧摘要和原因，但不暴露原始敏感健康载荷到日志。

## 发布闸门

1. 仅用合成数据测试授权状态、自动判定、映射、幂等、并发、撤销、失败重试与导出/恢复。未知字段必须 fail closed。
2. 向 COROS 核实 MCP 活动读取/FIT 与 Partner API “活动同步”限制的适用边界；未澄清前不可开启运动活动自动入库。超出 MCP 许可或限额时转 Partner API，不使用抓取。
3. 用户于 2026-09-26 批准先部署默认暂停的连接器与只读预览；此阶段可应用连接表迁移，但不得添加定时任务或自动写入。之后由用户在工作台完成 COROS OAuth；不从 Codex 导出/复制凭据。
4. 对真实数据先运行只读预览，核对至少一条运动、睡眠和心率的字段/单位/时区，然后显式启用定时自动入库。
5. 验证断开授权后不再拉取；重新授权不会重复创建；现有已确认 Workout 不会被覆盖。
6. 历史回填先做只读清单：逐域确认最早可用日期、最大查询窗口、页数/截断行为、单位/时区、来源 ID 与预计记录数；只有通过映射和容量验证的域才能启动回填。验证跨窗口重复、延迟上传、源记录修订、速率限制、失败续跑及回填/增量切换。不能以“请求成功”冒充“全量完成”。

## 当前状态

目前已增加纯函数自动入库判定规则、COROS OAuth 发现/PKCE/客户端注册与加密连接记录的服务端代码、限定单仓库 Contents 权限的 GitHub App installation token 辅助模块、仅允许读取运动/睡眠/日指标的 MCP 工具白名单，以及显示连接/暂停/断开状态与“只读检查最近一天”的前端入口，并用合成数据测试。只读检查仅返回直接 MCP 响应的格式和字段名称，不返回健康数值。连接后默认暂停。2026-09-26 已在现有 Cloudflare Worker、Pages 和 D1 发布这一暂停版，且已验证匿名不能读取 COROS 状态。COROS MCP 实际数据映射、定时轮询、Git 事务和真实数据验收均未实施，自动同步**未启用**。

2026-09-26：经用户授权，使用现有 Codex COROS 插件只读查询一天的睡眠概览、平均心率、日健康汇总和睡眠 HRV。授权已生效。该插件返回的是格式化展示文本；睡眠日期按醒来日归属，心率标注 bpm，睡眠 HRV 标注 ms，且 HRV 响应附带逐点序列。此次未保存数值或逐点数据，也未写入工作台。展示文本不能当作稳定的机器接口契约；工作台独立 OAuth 后仍需核对直接 MCP 返回的结构化字段、来源 ID、时区和单位，映射未通过前不得启用自动入库。

工作台独立 OAuth 已完成；首轮一天只读检查收到 MCP `content` 文本块，而非 `structuredContent`。预览器现进一步区分单一、完整 JSON 文本与自然语言/Markdown/混合内容；只返回字段名，不返回健康数值。即使文本可解析为 JSON，仍须核对字段语义、单位、来源 ID 与稳定性，不能据此直接启用自动入库。

用户重新运行一天只读检查后，结果仍为不可按 JSON 解析的展示文本；所以问题不是预览器遗漏了 JSON，当前健康数据映射闸门未通过。用现有 Codex COROS 插件再次核对相同的一天，`queryDailyHealthData` 也只返回一个文本块，无 `structuredContent`；未将响应正文或健康数值写入仓库。不能因为 OAuth 成功就启动历史回填。

用户随后将目标调整为“首次取得可用历史，之后仅增量”。上述历史回填与游标/重叠窗口规则是目标契约；当前连接仍暂停，没有进行全量读取、历史写入或定时轮询。

## 依据

- [COROS Build on MCP](https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP)
- [COROS MCP 官方工具表](https://github.com/coroslab/COROS-MCP)
- [COROS Partner API](https://support.coros.com/hc/en-us/articles/53181766856724-Partner-API-Access)
- [COROS MCP 数据类型与 FIT 日限额](https://support.coros.com/hc/en-us/articles/50841795180948-Connect-Your-COROS-to-AI)
- [COROS 全部历史活动的一次性批量导出](https://support.coros.com/hc/en-us/articles/33125636125204-Bulk-Export-Historical-Activity-Data)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
