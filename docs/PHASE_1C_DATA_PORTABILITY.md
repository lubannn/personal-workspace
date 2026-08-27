# Phase 1C：数据可迁移与恢复基础

> 状态：导出预检、Capture 生命周期与隔离仓库原子恢复三个垂直切片均已通过正式环境验收  
> 开始日期：2026-08-27  
> 范围：GitHub-backed canonical data

## 1. 目标

Phase 1C 在继续增加业务模块前，先证明私人仓库中的开放文件可以完整导出、独立校验，并为安全恢复提供确定协议。

首个切片只覆盖当前已经上线的 canonical 数据：

- `workspace.json`
- `data/captures/*.json`

后续 Task、Project、Journal、Health 等模块接入时，沿用同一 manifest 与预检规则扩展 scope，不另造专有导出格式。

## 2. 导出格式 v1

导出文件为 UTF-8 JSON，顶层字段如下：

```json
{
  "format": "personal-workspace-export",
  "export_version": 1,
  "generated_at": "2026-08-27T00:00:00.000Z",
  "source": {
    "repository": "lubannn/personal-workspace-data",
    "branch": "main"
  },
  "manifest": {
    "schema_version": 1,
    "scope": {
      "modules": ["workspace", "captures"],
      "complete": true
    },
    "counts": {
      "files": 2,
      "captures": 1
    },
    "files": []
  },
  "files": []
}
```

每个 manifest 文件条目包含：

- 仓库相对路径；
- 导出时的 Git blob SHA；
- UTF-8 字节数；
- 正文 SHA-256。

`files` 保存原始文本，因此导出内容可以脱离 GitHub 独立读取。导出包不包含 GitHub access token、refresh token、Cookie、GitHub App secret 或其他认证凭据。

## 3. 恢复预检

恢复预检在当前浏览器内只读执行，检查：

- 文件格式与导出版本；
- manifest 与正文路径集合是否一致；
- 文件数量和 Capture 数量；
- UTF-8 字节数和 SHA-256；
- `workspace.json` 结构；
- Capture schema、`owner_id`、稳定 ID 与规范路径；
- 重复路径、重复 Capture ID 和当前 scope 之外的意外文件。

预检不会向 Cloudflare、GitHub 或其他服务上传所选文件，不执行 commit，也不覆盖当前仓库。

## 4. 首个切片验收标准

- [x] 可从已连接的 Private 仓库读取全部 Capture。
- [x] 可生成开放 JSON 和逐文件 SHA-256 manifest。
- [x] 生成后的导出包在下载前自动通过相同恢复预检。
- [x] 用户可重新选择本地 JSON，独立执行只读预检。
- [x] 篡改正文、错误 owner、错误路径、版本不兼容和缺失 workspace 可被测试捕获。
- [x] 正式 Cloudflare 环境下载并回选同一文件通过（Windows：15 个文件、14 条 Capture）。
- [x] 至少在一台移动设备完成导出下载或文件预检（iPad 通过）。

## 5. 安全边界

- 导出包含 Private 仓库中的明文私人数据，下载后的副本由用户自行保管。
- 浏览器只在生成或预检期间把正文保留在页面内存，不写入 LocalStorage、SessionStorage 或 IndexedDB。
- 恢复写入只对通过 owner、Private、空业务数据与分支并发检查的独立仓库开放；来源仓库始终只读。
- GitHub 历史仍是当前在线版本恢复来源；开放导出提供厂商迁移能力，但不替代独立备份。

## 6. Capture 生命周期切片

Capture 回收站采用同路径软删除，不移动或物理删除 Private 仓库文件：

- 移到回收站：保留 `data/captures/<id>.json`，设置 `deleted_at`，并递增 `version`；
- 恢复：清空同一文件的 `deleted_at`，再次递增 `version`；
- Inbox 默认只显示 `deleted_at: null` 的记录，回收站按删除时间倒序显示；
- 每次变更都携带页面最后读取到的 Git blob SHA；另一设备已修改时 GitHub 拒绝旧 SHA，页面显示冲突并要求刷新；
- 不提供永久删除入口，旧版本仍保留在 Git 历史中；
- 开放导出包含 Inbox 与回收站中的全部 Capture，保证迁移不遗漏软删除记录。

正式环境验收于 2026-08-27 完成：一台设备创建并将测试 Capture 移入回收站，另一台设备刷新后读取并恢复，原设备再次刷新后可在 Inbox 读取恢复记录。整个流程未执行物理删除，也未依赖 Mac 保持开机。

## 7. 隔离恢复切片

真正恢复采用“已初始化、业务数据为空的独立 Private 仓库 + 单个原子 Git commit”模型：

- 目标必须与导出来源仓库不同，且 owner 必须与 `workspace.json` 一致；
- 目标必须保持 Private，并使用当前默认分支；
- 目标可以保留 README、LICENSE、`.gitignore` 等非业务文件，但不得存在 `workspace.json`、`data/`、`journal/`、`attachments/`、`imports/` 或 `indexes/`；
- 浏览器在写入前重新校验导出包、仓库可见性、目标根目录和分支 HEAD；
- 所有导出文件先生成 Git blobs，再组成一个 tree 和一个 commit，最后以 `force: false` 更新目标分支；
- 检查后或写入期间只要目标 HEAD 变化，GitHub 会拒绝非快进更新，不发生静默覆盖；
- 用户必须再次输入完整目标仓库名才能启用执行按钮；
- 来源仓库永远不会被恢复流程修改。

本地实现已通过协议、原子提交、冲突映射、类型、Lint、生产构建及 390px 布局检查。

正式环境验收于 2026-08-27 完成：从 `lubannn/personal-workspace-data` 生成并自动预检 16 个文件（`workspace.json` + 15 条 Capture），恢复到独立 Private 仓库 `lubannn/personal-workspace-restore-test`。目标仓库原有 README 被保留，全部业务文件通过单个 commit `8389cdceec1cbc1c318c933f4b5498b6e7269c4f` 写入；独立核对确认 15 个唯一 Capture 文件、`workspace.json`、2 条仓库历史记录和来源仓库未修改。

## 8. 后续切片

1. 增加 workspace schema migration registry 和迁移 dry run。
2. 扩展 manifest 到 Dashboard layout、Tasks、Projects、Journal、附件索引等后续模块。
