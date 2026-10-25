# 旅行 tab 读取性能（草稿）

2026-10-25，基于最新 main `decc49f78b81e8518a583bff05011f41196ebb29`。
只修改旅行读取，不改页面、地图、标签算法、写入、认证或其他模块。
全部记录、令牌、认证响应和 GitHub API 都来自合成内存仓库，没有读写真实私人记录。

## 已确认的瓶颈与处理

1. **首次记录读取**：原实现先读取目录，再按 6 条一组逐文件请求；60 条需要
   61 次 API 请求、10 轮正文请求。接入现有 `readBlobTexts` 后，按已认证目录的
   SHA 读取不可变正文，默认每批 25 条、共享并发上限 4；60 条是 1 次目录、
   3 次 GraphQL 请求。复用现有能力探测、错误处理和 REST 降级，不要求新权限。
2. **刷新重复下载**：原实现每次刷新下载全部正文。现在每次刷新仍请求远端目录，
   仅缺少或 SHA 改变的正文需要读取。删除的文件不从缓存补回；正文只保留在
   当前已认证适配器内存，不增加 localStorage、IndexedDB、离线读取或分析追踪。
   换适配器/重新登录仍需重读。完整 owner、路径、SHA、schema 校验通过才发布快照。
3. **同会话重复进入**：原有 `WorkspaceModuleLoader` 已合并成功及未完成读取，
   tab 已保留挂载。测量中重复切换没有旅行 API 请求，不应再增加一层过期缓存。
   每次点旅行回全国的呈现逻辑、未保存表单均保留。
4. **其他模块阻塞**：旅行依赖集合仅为旅行；故意将通告读取延迟 1.6 秒，
   旅行目录请求仍在通告完成前发起。隔离旅行打开时没有日记/健康请求。
5. **资源与渲染**：冷页面仍加载约 1.50 MB 未压缩静态资源，4 倍 CPU 降速下
   初始化有约 1.1 秒长任务；浏览器缓存命中后资源重传显著减少，但重新登录仍读记录。
   旅行首屏是全国地图，不加载省级城市 JSON，也不运行城市标签避让。
   正文完成到稳定画面约 0.1–0.25 秒。省级图的密集标签计算是另一条路径，
   广东桌面选择含资源和绘制约 1 秒；本次保留完整标签、引导线、小字号和无白色描边。

优先级：先减少首次记录请求和刷新重复正文（已实现）；其后评估 REST 降级的
首次读取差异；全工作台 bundle/初始化拆分需要另立范围，不能用该测量直接决定大改。
省级标签计算可单独做结果等价的测量优化，不应牺牲标签完整性。

## 同条件结果

以 [逐轮测量数据](travel-performance/measurement-summary.json) 为准；下表为中位数。

| 60 条记录，GraphQL 可用，5 轮 | 优化前 | 优化后 | 旅行请求数 前 → 后 |
| --- | ---: | ---: | ---: |
| 新浏览器上下文，直接冷打开旅行 | 4,116 ms | 2,815 ms | 61 → 4 |
| 同上下文页面重载，静态资源暖缓存/新适配器 | 2,708 ms | 1,433 ms | 61 → 4 |
| 已连接通告页面，首次点击旅行 | 2,157 ms | 810 ms | 61 → 4 |
| 同会话切出再返回 | 285 ms | 268 ms | 0 → 0 |
| 手动刷新，远端未变化 | 1,659 ms | 308 ms | 61 → 1 |
| 冷打开中，目录完成至正文请求完成 | 1,363 ms | 253 ms | — |

240 条记录、3 轮补测：首次点击 6,082 → 1,280 ms，冷直接打开
8,604 → 3,387 ms，未变更刷新 6,144 → 570 ms；旅行请求 241 → 11，
刷新 241 → 1。同会话切回 488 → 575 ms、均为 0 请求，没有重复请求收益，
该小幅波动不应宣称为优化。数据多时完整列表绘制仍需约 0.3–0.45 秒。

运行环境：云端 Linux、系统 Chromium 151.0.7922.173、1440×1000、CPU 降速 4 倍；
真实生产静态构建，每次 API 响应额外固定延迟 100 ms；静态资源来自 loopback HTTP，
未压缩、不施加带宽限制；没有运行生产认证或真实 GitHub 数据读取。
“完整”定义为全部合成记录行出现、写入按钮可用后再经过两次 animation frame。
首次点击和切回计时含 Playwright 点击等待及绘制，不能当作纯 React 执行时间。
浏览器资源缓存实际启用，service worker 关闭；冷上下文与同上下文重载分开统计。
这些数字反映请求结构和本测试机差异，不能等同手机、用户网络或生产压缩后的速度。

### REST 降级限制

当现有 token 不能用 GraphQL 时，适配器会探测一次后使用 SHA-pinned REST blob
读取。共享上限为 4 个并发，而原旅行代码为 6 个；冷正文可能更慢，并多一次能力
探测请求。刷新仍只核对目录，功能及新鲜性保持。必须在评审中考虑该性能取舍，
不能把主路径改善推广到所有授权方式。本次没有提高通用并发、改其他集合或申请权限。

60 条记录、3 轮 GraphQL 403 补测：首次点击 2,407 → 2,875 ms，
正文窗口 1,669 → 2,197 ms，旅行请求 61 → 62；未变更刷新
1,692 → 420 ms、61 → 1 请求。完整冷启动 5,610 → 5,324 ms 有较大
初始化噪声，不能用这个总数掩盖正文降级变慢；暖资源重载为 3,486 → 3,748 ms。

## 验证状态

- 相关适配器/旅行/导航初步测试：5 个文件、119 项通过。
- 生产 PWA 构建通过；全仓 `pnpm lint`、`pnpm typecheck` 通过，
  全量 Vitest 172 个文件、1,746 项全部通过。lint 仅有已有的根目录 pages 提示。
- 合成 Chromium：冷/暖打开、同会话重复切换、每次点 tab 返回全国、表单保留、
  编辑保存、SHA 冲突保留输入/刷新重选、软删除恢复、远端修改/移除、新适配器读取、
  401 后缓存不能绕过核对、限流/不完整批次阻止部分展示和写入、显式重试恢复均通过。
- 1440/390/320px：34 个全国区域、广东/新疆/贵州/台湾省级切换；城市标签文字完整、
  标签框无相交、无裁切、无横向溢出、无白色描边；地图失败时完整城市列表保留，
  返回后重选可恢复；快速切省最终显示目标省份。浏览器无未捕获异常。
- 未执行已知不适用的根目录 `pnpm build`；正式静态 PWA 使用 `build:github-pwa`。
- 未合并、未推送 main、未触发生产部署；没有新持久权限或真实用户数据读写。
- 同一云端合成预览的独立浏览器冒烟通过：60 条完整记录可见，无页面未捕获异常。

## 可复现测量与合成预览

测试工具不进入应用 bundle，也不增加仓库依赖；需要 Node 24、Chromium 和 Playwright。
在独立目录准备上述 main 的静态构建后，对前后构建使用同一份当前测试脚本：

```sh
npm install --prefix /tmp/travel-perf --cache /tmp/travel-npm-cache playwright@1.64.1
export PLAYWRIGHT_MODULE=/tmp/travel-perf/node_modules/playwright/index.mjs
pnpm build:github-pwa
node scripts/benchmark-travel.mjs --out /tmp/travel-baseline-out --result /tmp/travel-before.json
node scripts/benchmark-travel.mjs --result /tmp/travel-after.json
node scripts/benchmark-travel.mjs --runs 3 --records 240 --result /tmp/travel-after-240.json
node scripts/benchmark-travel.mjs --runs 3 --rest-only --result /tmp/travel-after-rest.json
node scripts/benchmark-travel.mjs --runs 0 --verify --result /tmp/travel-verification.json
node scripts/benchmark-travel.mjs --preview --port 4173
```

最后一条启动独立的合成数据预览（`http://127.0.0.1:4173/#workspace-panel-travel`），
只在测试服务器提供 HTML 时注入合成传输，不修改 `out/` 或生产代码。预览中的
新增/编辑只写当前进程的合成内存；外部 fetch 被阻止，真实登录不可用。
云端端口是否可从当前客户端访问取决于平台转发；下方截图可直接审阅。

![全国地图桌面预览](travel-performance/national-1440.png)
![广东手机完整标签预览](travel-performance/province-440000-390.png)
![新疆窄屏完整标签预览](travel-performance/province-650000-320.png)
