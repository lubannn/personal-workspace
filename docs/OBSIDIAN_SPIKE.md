# Obsidian 单向同步 Spike

> 状态：Node 本地 adapter 隔离验证与浏览器合成 fixture 预检已实现，尚未连接真实 Vault
> 日期：2026-08-25

## 结论

Phase 1 采用本地文件系统 adapter 验证 Workspace → Obsidian Vault 单向写入。数据库仍是 Workspace 事务数据的 canonical source，Markdown 是用户可读、可迁移的长期副本。首版不启用 Vault → Workspace 自动反向覆盖。

## 已验证契约

- 只接受 Vault 根目录内的相对 `.md` 路径。
- 拒绝 `..` 路径穿越、绝对路径、非 Markdown 文件和符号链接逃逸。
- 新文件使用同目录临时文件和排他链接写入，避免静默覆盖突然出现的文件。
- 更新使用上次确认的 SHA-256 做乐观并发控制，并在替换前再次读取核对。
- 内容相同的重复同步是 no-op。
- Vault 文件发生外部编辑时返回显式冲突，保留 Obsidian 中的原内容。

## 首版建议目录

```text
<Vault>/Personal Workspace/
  Journal/YYYY/YYYY-MM-DD.md
  Notes/
  Exports/
```

最终目录必须由用户选择。连接真实 Vault 前，Workspace 应展示目标路径、写入范围和一次测试文件预览；不得扫描或上传 Vault 的其他内容。

## 已知边界

- Obsidian 或云盘同步工具可在极短的“最终核对—原子替换”窗口内并发改写文件。正式实现需保存数据库 revision/hash，并把任何异常作为冲突，不做静默重试覆盖。
- iCloud、Dropbox、OneDrive 等同步目录的锁、大小写和 rename 语义需要在真实 Vault 上单独验证。
- 当前 adapter 不监视 Vault、不读取无关笔记、不实现双向同步。

## Phase 3B 浏览器预检

正式 PWA 已增加一个独立的合成 fixture 兼容性预检。它使用用户手势触发的目录选择器，只在当前页面内存保存 handle，不枚举 Vault；写入前展示唯一目标路径、UTF-8 字节数和两个确定性 SHA-256，并要求输入完整 `<Vault 名>/<子目录>`。两阶段测试只写 `personal-workspace-vault-test.md`，在 close 后回读校验并把任何非精确 fixture 当作冲突。

浏览器 File System Access API 不是跨浏览器 Baseline，因此这是桌面 Chromium progressive enhancement。该切片没有 Journal 正文、没有 Vault 映射 canonical、没有后台或双向同步；详细边界与真实验收步骤见 `PHASE_3_OBSIDIAN_PREFLIGHT.md`。

## 进入 Phase 3 前

1. 用户选择真实 Vault 和 `Personal Workspace/` 子目录。
2. 用不含私人内容的测试文件验证权限、编码、换行、rename 和移动端可见性。
3. 为 Journal 定稿 frontmatter、序列化版本、revision 和冲突 UI。
4. 完成数据库与 Markdown 的备份后，再连接真实日记。
