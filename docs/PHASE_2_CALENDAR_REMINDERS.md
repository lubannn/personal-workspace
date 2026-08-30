# Phase 2 Calendar 前台提醒

## 目标与非目标

本切片提供可跨设备同步的提醒计划，以及当前设备页面运行时的系统通知。它不承诺关闭页面后的后台送达，不建立 Calendar 正文到认证 Worker 的新数据通道，也不开放重复、全天或外部 Calendar 同步。

## Canonical

提醒作为 CalendarEvent 的版本化字段保存：

- `reminder_offsets_minutes`: 相对 `start_at` 的分钟偏移数组；首版 UI 只选择一个。
- `reminder_delivery`: 固定为 `foreground_notification`。
- 触发 instant = `Date.parse(start_at) - offset_minutes * 60_000`。
- 允许偏移：开始时、提前 5/10/15/30/60 分钟或 1 天。
- 取消、软删除的事件不触发；编辑事件后 delivery key 随领域版本变化。

旧 v1 CalendarEvent 缺少提醒字段时按无提醒读取，因此 schema 仍为 v1，export 格式也无需升级。导出、inspection、restore 和 migration dry run 已经整文件覆盖 CalendarEvent，提醒字段自动进入同一套 SHA-256 与 blob SHA 保护。

## 当前设备交付语义

页面每 30 秒检查一次到期提醒，并在页面重新可见或窗口重新获得焦点时补查。只接受触发后五分钟内的提醒；更早的提醒视为错过，不制造陈旧通知。页面生命周期内用 `event id + version + offset` 去重，不把正文或 delivery key 写入 LocalStorage、SessionStorage 或 IndexedDB。

通知使用已注册 Service Worker 的 `showNotification()`，点击后聚焦或打开正式应用的 Calendar 区域。标题固定为“日程提醒”，正文使用事件标题；这是锁屏可见的私人内容，只有用户点击“启用此设备提醒”并同意系统权限后才会显示。

## 平台与失败边界

- 通知权限必须由直接用户手势请求；`default`、`denied`、`granted` 和 API 不支持分别显示。
- 移动端通知通过 Service Worker 展示；Service Worker 或浏览器拒绝时，Calendar 数据写入仍成功，UI 单独报告通知失败。
- iOS/iPadOS 16.4 起，后台 Web Push 只适用于加入主屏幕的 Web App；仍需要 Push subscription 和远端发送端。
- 当前认证 Worker 不接收 Private Calendar 正文或提醒计划，因此不能调度后台通知。
- 页面关闭、系统冻结计时器或超过五分钟宽限窗时可能不送达；UI 和文档必须持续明确这一点。

后台 Push 若进入后续切片，必须先解决 subscription 生命周期、多设备撤销、最小化/加密调度 payload、时钟漂移、重复投递、Git 更新同步延迟、权限撤销和无正文日志，再决定是否扩展 Worker/D1。

## 依据

- WebKit：[Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- WebKit：[Meet Web Push](https://webkit.org/blog/12945/meet-web-push/)
- MDN：[Using the Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)
