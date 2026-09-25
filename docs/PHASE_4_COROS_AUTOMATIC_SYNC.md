# COROS 自动同步：实施边界与验收

> 2026-09-25：用户将目标调整为工作台直连 COROS，运动活动、睡眠、心率及选定日汇总指标无需逐条确认即可入库；冲突和不确定映射留待处理。本文是实施契约，不表示服务已经连接或上线。

## 产品行为

- 用户在 Personal Workspace 单独完成一次 COROS OAuth。Codex 插件的现有授权不能转交给工作台。
- 连接后由服务端定时拉取；浏览器关闭时仍能运行。MCP 无 webhook，不能承诺实时到达。
- 新增、可稳定识别且字段校验通过的记录自动成为正式 Workout / SleepSession / HealthMetric，不要求每条确认。
- 同一来源 ID 和相同内容的重试是 no-op。相同来源 ID 但内容变化、与手工记录疑似重复、时区或分类不明、字段越界等情况进入待处理区；绝不静默覆盖正式记录。
- 初次连接默认只从明确选定的起始日期前向同步；历史回填须单独发起并显示数量上限。暂停、断开、重试、最近成功时间和错误状态必须可见。
- 现有手工与 FIT/TCX 文件导入仍保持逐条确认，不能被自动规则顺带放宽。

## 凭据和授权

- COROS 当前 MCP OAuth 元数据只有通用 `mcp.tools` 等 scope，不能声称远端授权是只读。工作台连接器自身使用硬编码读取工具 allowlist，拒绝所有训练写入工具。
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
2. 核实 COROS 官方关于 MCP 读取活动/FIT 与 Partner API “活动同步”限制的适用边界；超出 MCP 许可或限额时转 Partner API，不使用抓取。
3. 先部署关闭的连接器，再由用户在工作台完成 COROS OAuth；不从 Codex 导出/复制凭据。
4. 对真实数据先运行只读预览，核对至少一条运动、睡眠和心率的字段/单位/时区，然后显式启用定时自动入库。
5. 验证断开授权后不再拉取；重新授权不会重复创建；现有已确认 Workout 不会被覆盖。

## 当前状态

目前只有纯函数自动入库判定规则及合成测试。OAuth、定时轮询、Private 仓库服务端写入、COROS 实际数据映射和 UI 尚未实施；自动同步**未启用**。

## 依据

- [COROS Build on MCP](https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP)
- [COROS MCP 官方工具表](https://github.com/coroslab/COROS-MCP)
- [COROS Partner API](https://support.coros.com/hc/en-us/articles/53181766856724-Partner-API-Access)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
