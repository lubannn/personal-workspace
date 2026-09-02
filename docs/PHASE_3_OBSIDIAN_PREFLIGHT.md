# Phase 3B Obsidian Vault 兼容性预检

> 状态：浏览器端合成 fixture 预检已实现；尚未在真实 Vault 执行，也未启用 Journal 同步。

## 1. 目的与边界

这一切片只验证用户选择的 Obsidian Vault 是否具备后续单向导出所需的最小文件系统能力。它不是 Journal 同步器，也不改变 Private GitHub canonical 数据。

- 用户必须通过浏览器目录选择器主动选择 Vault；handle 只保留在当前页面内存中。
- 应用不枚举 Vault，不读取其他笔记，不保存目录 handle，不上传路径或文件内容。
- 唯一允许的目标是用户输入的安全相对子目录下 `personal-workspace-vault-test.md`。
- fixture 固定标记为 `synthetic-no-private-data`，不包含 Journal、Task、Project、token 或仓库数据。
- 任何既有非精确 fixture 内容都按冲突停止；应用不删除、改名、吸收或覆盖它。
- 测试文件完成后保留，由用户决定是否手工删除。当前 UI 不提供删除能力。
- 正式 Journal → Vault 导出、Obsidian → Workspace 反向覆盖、后台同步和持久化 Vault 映射全部保持关闭。

## 2. 用户确认门

目录选择本身不会触发文件创建。写入前 UI 必须同时满足：

1. 当前浏览器支持 `showDirectoryPicker()`，且运行在安全上下文；
2. 用户选择了目标 Vault 并授予 read/write 权限；
3. 子目录通过相对路径校验，不含绝对路径、`..`、反斜杠、控制字符或系统保留字符；
4. UI 展示 Vault 名、唯一目标文件、两阶段 UTF-8 字节数与 SHA-256；
5. 用户逐字输入 `<Vault 名>/<相对子目录>`。

typed confirmation 只授权这一份合成测试文件，不授权读取其他 Vault 内容或导出真实 Journal。

## 3. 两阶段测试

Stage 1 与 Stage 2 都是确定性 UTF-8/LF Markdown，只有 `replacement_stage` 和末行阶段号不同：

1. 先只读检查目标；missing 才允许创建，精确 Stage 1 可以恢复，精确 Stage 2 作为幂等成功，其他内容一律冲突。
2. missing 时创建 Stage 1，关闭 writable stream 后重新读取并核对 SHA-256、UTF-8 和字节数。
3. 替换前再次读取 Stage 1 并核对预期 SHA-256；不一致立即停止。
4. 写入 Stage 2，成功关闭 stream 后再次读取并核对最终 SHA-256。
5. 用户以后可在 Obsidian 或同步工具中编辑该测试文件，再点击“只读核验”确认外部变化会显示为冲突。

## 4. “原子”措辞限制

File System Standard 规定 `createWritable()` 的修改在 stream 关闭前不应反映到原文件，并要求浏览器尽力避免 partial write；典型实现是临时文件加 close 时替换。因此产品文案使用 **commit-on-close replacement**，不把它夸大成所有文件系统和云盘上的绝对原子事务。

仍需真实环境验证：

- Obsidian、iCloud、Dropbox、OneDrive 或其他同步工具的并发窗口；
- 文件锁、大小写、Unicode normalization、移动端同步可见性；
- stream 关闭后同步工具是否观察到完整新版本；
- 外部编辑发生在“最后一次 hash 复核—close”窗口时的实际行为。

浏览器端 hash 是 fail-closed 的乐观检查，但无法消除该最终竞态。正式 Journal 单向同步仍需 canonical `ObsidianDocument` 基线、显式 `SyncConflict`、可恢复导出清单和单独评审。

## 5. 浏览器支持

`showDirectoryPicker()` 需要 HTTPS 和瞬时用户手势，当前不是跨主流浏览器 Baseline。PWA 将它作为 progressive enhancement：不支持时继续保留已有的单篇 Markdown 下载，不伪装成 Vault 已连接。

## 6. 后续真实验收

代码与静态 UI 验收通过后，真实 Vault 测试仍需动作发生时确认精确 Vault、子目录和唯一 fixture 路径。推荐顺序：

1. 选择 Vault 与专用 `Personal Workspace/` 子目录；
2. 核对 UI 展示的唯一目标文件并输入完整确认；
3. 运行两阶段写入并在 Obsidian 中检查 UTF-8、LF 与内容完整性；
4. 等待现有同步工具传播到另一台设备；
5. 人工修改 fixture 后回到 PWA 运行只读核验，确认冲突可见且没有覆盖；
6. 记录文件系统/同步工具结果后，再单独设计真实 Journal 单向导出。

