# Personal Workspace

Personal-first、single-user-first 的长期个人工作台。原有 Node.js + SQLite 本地技术基线保留为回退方案；目标架构已切换为 GitHub Pages 静态 PWA + GitHub 私有明文数据仓库，使 Mac 关机后仍可跨设备使用。

## GitHub 静态 PWA 原型

```bash
pnpm build:github-pwa
```

构建产物位于 `apps/github-pwa/out/`，只包含静态应用代码，不包含 `.data/`、SQLite、日记、健康数据或认证凭据。当前版本可通过仅授权数据仓库的 fine-grained token 读写真实 Quick Capture；token 只保留在当前页面内存中，刷新或关闭后必须重新输入。

目标仓库：

- `personal-workspace`：Public，保存代码与 GitHub Pages workflow，不保存个人业务数据。
- `personal-workspace-data`：Private、未加密明文的业务数据。

完整决策见 [GitHub-backed PWA 迁移规格](./docs/GITHUB_BACKED_PWA.md)。

### 日记记录与勋章

日记首页只读取最近 3 篇正文，统计摘要与目录并行读取。完整统计的本地计数快照先显示为“已统计”，随后按 GitHub 文件 SHA 核对；同一登录会话中的摘要读取合并并短暂复用，手动重试会强制核对。目录先读取小型 `data` 父目录，再读取完整日记子树；文件名、SHA、大小的元数据可以缓存，但每次初次访问或手动刷新都必须通过已认证的远端父目录版本核对。目录版本未变时无需重复下载全目录，缓存损坏、目录更新或无权限均不能作为旧版本继续显示。

查看月份只读取该月未加载的正文，按日期从新到旧、最多 40 个文件且合计不超过 1 MiB 分批请求，校验成功的批次立即显示；全部批次通过才标记整月读取完成。普通 30 篇月份可合并为一次正文查询，已读月份再次浏览不发请求。中断后保留已校验批次并只补读缺失文件；快速切月和保存期间仍执行取消、版本与提交一致性保护。正文仅缓存于当前已认证适配器内存，不写入浏览器持久缓存，不自动扫描全部历史正文。

日记列表下方显示累计记录天数、篇数、写作字数和每日千字天数，以及连续记录与 10 个系列、40 枚勋章。完整勋章列表默认折叠。勋章直接复用现有按文件版本核对的共享统计摘要，不新增 GitHub 请求、历史正文扫描或勋章持久化文件；摘要未核对完整时暂不判定勋章。保存或修改后沿用现有增量统计更新，手机和不同浏览器共用同一摘要。

日期沿用工作台时区下的 `journal_date`，以自然日、周一开始的自然周和自然月计算连续记录。同日多篇合并字数，导入日记按原有分段计篇；中文逐字、英文逐词、标点逐个计数，空格与 Markdown 格式标记不计。历史有效日记参与计算，未来日期不提前计入。连续勋章按历史最长记录获得，中断后保留历史最长；当前连续记录允许今天（本周、本月）尚未写入。当前有效记录被修改或删除后，勋章随统计结果重新判定。

记录勋章四级门槛：日日有记为连续 1 / 2 / 3 / 4 年（365 / 730 / 1,095 / 1,460 天）；周周相见为连续 1 / 2 / 5 / 10 年（52 / 104 / 260 / 520 周）；月月留痕为连续 1 / 2 / 5 / 10 年（12 / 24 / 60 / 120 个月）；岁月有记为累计 1,000 / 2,000 / 5,000 / 10,000 个有记录的自然日。四季相逢要求 365 个月日分别在至少 1 / 2 / 5 / 10 个不同年份有记录，不要求这些年份连续，不含 2 月 29 日；同一年重复提交不增加年份覆盖。其余五组写作勋章门槛不变，更新门槛后由现有已核对摘要重新判定，不读取历史正文或修改 Private 数据。

新增勋章在日记页右上角显示轻量提示，列出名称与等级，多枚同时获得会合并展示；8 秒后自动消失，也可手动关闭。鼠标悬停或键盘焦点位于提示内时暂停消失，不自动移动焦点、不弹出模态窗口或声音。每次打开模块/重新登录的第一份完整核对结果仅建立静默基线，不把已有勋章当作新获得；本次会话中同一枚只提示一次，未核对完整的统计不会触发提示，退出或更换仓库后不会带出上次提醒。检测仅对现有摘要生成的勋章 ID 做内存比较，不增加 GitHub 请求、持久缓存或历史正文读取。

### 健康月历读取

睡眠与运动按月读取，初次登录只加载当前月份。每次登录和手动刷新先用已认证的 GitHub 目录版本核对文件 SHA；未变更的日期目录与已查看月份可以复用，只有缺少或变更的记录需要下载。健康页面当前月份读取完成后，空闲时预加载前后相邻月份；离开健康页面、切月或刷新时取消预加载，不扫描全部历史，也不触发 COROS 更新。

健康正文及必要的运动来源确认记录使用 IndexedDB 中的 AES-GCM 加密缓存，按仓库、分支与文件 SHA 隔离，可跨登录复用；密钥以不可导出的 CryptoKey 保存，不持久保存认证 token。缓存不是离线访问入口，未经远端认证和版本核对不能显示。记录删除后不会从缓存恢复；缓存损坏或浏览器不支持时回退到正常读取。缓存最多保留 30 天、2,500 条和 16 MiB，可在「同步设置与记录」中清除本机月历缓存。首次查看、换设备、清除或缓存过期仍需读取一次。

### 旅游记录

「旅游」与健康、日记平级：34 个省级区域静态地图、已去统计、省份与城市联动下拉、起止日期及可选备注记录。旧自由文本城市在编辑时可明确保留。
新增或编辑后保存至现有私有数据仓库；软删除后可在回收站恢复。一个省份只要有一条
有效记录就点亮，多次到访不重复计省。地图和省份列表均可键盘选择，日期保留本地
自然日字符串，支持同日且结束不得早于开始；旧单日期记录按同日兼容。详见 [旅游模块与验证](./docs/TRAVEL_MODULE.md)。

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
