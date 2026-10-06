import { parseCorosOAuthFailure } from "../../../auth-worker/src/coros-oauth-errors";
import type { DomainProgress, SyncProgress } from "../../../auth-worker/src/coros-sync-state";
import type { BulkHealthSource, BulkHealthSourceProgress } from "../../../auth-worker/src/coros-health-history";

export function corosNeedsReauthorization(code: string | null | undefined): boolean {
  const oauth = parseCorosOAuthFailure(code);
  return (oauth?.phase === "REFRESH" && oauth.oauthError === "invalid_grant")
    || ["COROS_READ_UNAUTHORIZED", "COROS_TOKEN_INVALID", "COROS_MCP_CONNECTION_INVALID"].includes(code ?? "");
}

export function corosSyncErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  const oauth = parseCorosOAuthFailure(code);
  if (oauth) {
    const phase = { RESOURCE_METADATA: "COROS 资源发现", AUTH_METADATA: "COROS 授权服务发现", REFRESH: "COROS 授权刷新",
      REGISTRATION: "COROS 客户端注册", EXCHANGE: "COROS 授权兑换" }[oauth.phase];
    const status = oauth.status === null ? "" : `（HTTP ${oauth.status}）`;
    const reason = oauth.oauthError === "invalid_grant" ? "刷新或兑换凭据被拒绝，请核对授权状态"
      : oauth.oauthError === "invalid_client" || oauth.oauthError === "unauthorized_client" ? "客户端被拒绝，请核对服务端注册配置"
        : oauth.status !== null && [301, 302, 303, 307, 308].includes(oauth.status) ? "接口返回重定向，需核对服务端地址"
          : oauth.reason === "BODY_MISSING" ? "响应缺少正文，需核对授权接口"
          : oauth.reason === "TIMEOUT" ? "请求超时，可稍后检查状态"
            : oauth.reason === "TRANSPORT_FAILED" ? "网络请求失败，可稍后检查状态"
              : oauth.status === 429 ? "请求受到限流，请等待已安排的重试"
                : "请求未完成，需核对授权服务响应";
    return `${phase}${status}${oauth.oauthError ? `（${oauth.oauthError}）` : ""}：${reason}。已有记录与进度保留。`;
  }
  if (code === "COROS_SYNC_HISTORY_UNSUPPORTED" || code === "COROS_ROUTE_NOT_FOUND") return "后台尚不支持保存历史范围，请等待服务更新后点击「检查状态」；当前范围与暂停状态保持不变。";
  if (code === "COROS_SYNC_HISTORY_BUSY") return "仍有批次占用或进度已变化，请检查状态后重试；历史范围未保存。";
  if (code === "COROS_SYNC_PAUSE_REQUIRED") return "请先暂停自动更新，再保存历史范围或恢复受阻来源。";
  if (/CONFIG|INSTALLATION|GITHUB_APP|OWNER_MISMATCH|WORKSPACE_MISMATCH/iu.test(code)) return "后台写入连接尚未准备好，需要完成服务端配置后再同步。";
  if (code === "COROS_SYNC_INVALID_DATE") return "历史开始日期无效，请选择有效日期；已有范围只允许相同或更早的起点。";
  if (code === "COROS_READ_RESULT_TOO_LARGE" || code === "COROS_SYNC_HEALTH_RANGE_UNCONFIRMED") return "单次响应过大或返回范围不完整，已停止自动重试并保留进度；先核对接口容量或范围，再暂停并显式恢复此来源。";
  if (/TIMEOUT/iu.test(code)) return "连接响应超时，本批未完成；已有记录仍保留，可稍后重试。";
  if (/TOKEN|AUTHORIZATION|UNAUTHORIZED|CREDENTIAL|AUTH_REQUIRED/iu.test(code)) return "COROS 授权暂时不可用。请重新连接后恢复同步。";
  if (/FORMAT|MAPPING|READ_RESULT|READ_TOOL_UNAVAILABLE|TRUNCATED/iu.test(code)) return "来源返回内容尚需核对，未完成区间的进度不前移。";
  if (code === "COROS_SYNC_ACTIVITY_DETAILS_PENDING") return "活动详情正在分批读取；已验证指标保留，完成全部活动详情后才确认该日汇总。";
  if (/RATE|LIMIT|429/iu.test(code)) return "COROS 暂时限制了读取频率，本批更新需要稍后再尝试。";
  if (/CONFLICT/iu.test(code)) return "部分记录与已保存内容不一致，已保留原记录并标记待核对。";
  return "最近一次同步没有完成，已有记录仍保留。";
}

export function corosHistorySources(progress: SyncProgress) {
  const sources: { id: string; label: string; progress?: BulkHealthSourceProgress; resetSource?: BulkHealthSource }[] = [
    { id: "sleep", label: "睡眠", progress: progress.domains.sleep },
    { id: "workout", label: "运动", progress: progress.domains.workout },
    { id: "health", label: "HRV", progress: progress.health },
    { id: "activity", label: "爬升与训练负荷", progress: progress.health?.activity },
    { id: "dailyHealth", label: "日健康", progress: progress.health?.bulk?.dailyHealth, resetSource: "dailyHealth" },
    { id: "restingHeartRate", label: "静息心率", progress: progress.health?.bulk?.restingHeartRate, resetSource: "restingHeartRate" },
  ];
  return sources;
}

/** Configured scope and record dates cannot establish a legacy check's start. */
export function corosCheckedRangeText(progress?: DomainProgress): string {
  const ranges = progress?.checkedRanges ?? [];
  const parts = ranges.length ? [`已检查区间：${ranges.map(range => `${range.from} 至 ${range.through}`).join("；")}`] : [];
  for (const [label, through] of [["历史", progress?.backfillThrough], ["近期", progress?.recentThrough]] as const) {
    if (through && !ranges.some(range => range.from <= through && range.through >= through)) {
      parts.push(`${label}检查截止 ${through}（起点未记录，范围待核验）`);
    }
  }
  return parts.join("；") || "已检查区间：尚无已确认区间";
}

/** Only a deliberate paused UI action may edit scope or reset a named blocked source. */
export async function saveCorosHistorySettings(options: { state: "paused" | "enabled" | null; running: boolean; historyScopeSupported: boolean;
  progress: SyncProgress; startDate: string; csrf: string; retryBlockedSource?: BulkHealthSource; fetcher?: typeof fetch }) {
  if (!options.historyScopeSupported) throw new Error("COROS_SYNC_HISTORY_UNSUPPORTED");
  if (options.state !== "paused") throw new Error("COROS_SYNC_PAUSE_REQUIRED");
  if (options.running) throw new Error("COROS_SYNC_HISTORY_BUSY");
  if (!options.csrf) throw new Error("COROS_AUTH_REQUIRED");
  const date = options.startDate, parsed = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date
    || date < "2000-01-01" || date > options.progress.startDate) throw new Error("COROS_SYNC_INVALID_DATE");
  const response = await (options.fetcher ?? fetch)("/coros/history", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json", "x-pw-csrf": options.csrf },
    body: JSON.stringify({ startDate: date, ...(options.retryBlockedSource ? { retryBlockedSources: [options.retryBlockedSource] } : {}) }) });
  const result: unknown = await response.json().catch(() => null);
  if (response.status === 404) throw new Error("COROS_SYNC_HISTORY_UNSUPPORTED");
  if (!response.ok) {
    const code = result && typeof result === "object" && "error" in result ? result.error : null;
    throw new Error(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/u.test(code) ? code : "COROS_SYNC_REQUEST_FAILED");
  }
  if (!result || typeof result !== "object" || !("state" in result) || result.state !== "paused"
    || !("queued" in result) || result.queued !== false || !("historyStartDate" in result) || result.historyStartDate !== date) throw new Error("COROS_SYNC_RESPONSE_INVALID");
  return { state: "paused" as const, historyStartDate: date, queued: false as const };
}
