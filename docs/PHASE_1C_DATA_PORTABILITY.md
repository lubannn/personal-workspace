# Phase 1C：数据可迁移与恢复基础

> 状态：首个垂直切片已实现，待正式环境验收  
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
- [ ] 正式 Cloudflare 环境下载并回选同一文件通过。
- [ ] 至少在一台移动设备完成导出下载或文件预检。

## 5. 安全边界

- 导出包含 Private 仓库中的明文私人数据，下载后的副本由用户自行保管。
- 浏览器只在生成或预检期间把正文保留在页面内存，不写入 LocalStorage、SessionStorage 或 IndexedDB。
- 本阶段不开放“恢复写入”，避免在空仓库判断、owner 判断、并发保护完成前造成覆盖。
- GitHub 历史仍是当前在线版本恢复来源；开放导出提供厂商迁移能力，但不替代独立备份。

## 6. 后续切片

1. 只允许恢复到新建空仓库或隔离分支，并在写入前再次显示文件数量与目标仓库。
2. 为所有文件写入使用 blob SHA / 空目标约束，禁止静默覆盖。
3. 增加 Capture 软删除、`trash/captures/` 与恢复流程。
4. 增加 workspace schema migration registry 和迁移 dry run。
5. 扩展 manifest 到 Dashboard layout、Tasks、Projects、Journal、附件索引等后续模块。
