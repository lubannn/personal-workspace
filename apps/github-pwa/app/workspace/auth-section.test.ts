import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthSection } from "./auth-section";

type AuthProps = ComponentProps<typeof AuthSection>;

function renderAuth(overrides: Partial<AuthProps> = {}) {
  const props: AuthProps = {
    online: true,
    connection: { repository: "owner/private-data", ownerId: "owner-id", ownerLogin: "owner", timezone: "Asia/Shanghai" },
    todayDate: "2026-10-03",
    connectionMethod: "github-app",
    authAvailability: "configured",
    owner: "owner",
    repository: "private-data",
    token: "",
    connecting: false,
    confirmingRevokeAll: false,
    revokingAll: false,
    errorMessage: "",
    statusMessage: "",
    onOwnerChange: () => {},
    onRepositoryChange: () => {},
    onTokenChange: () => {},
    onConnect: () => {},
    onDisconnect: () => {},
    onConfirmingRevokeAllChange: () => {},
    onRevokeAll: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AuthSection, props));
}

describe("compact connected account", () => {
  it.each([
    "已通过 GitHub App 登录，访问令牌仅保留在当前页面内存中。",
    "已通过 GitHub App 登录（octo-cat），访问令牌仅保留在当前页面内存中。",
  ])("shows App connection once without a second success message: %s", (statusMessage) => {
    const html = renderAuth({ statusMessage });
    expect(html.match(/class="connection-card connected"/g)).toHaveLength(1);
    expect(html).toContain('id="connection-title">私人数据已连接');
    expect(html).toContain('class="connection-method">GitHub App</span>');
    expect(html).toContain("owner/private-data · Private · Asia/Shanghai");
    expect(html).toContain("退出当前设备");
    expect(html).toContain("撤销全部设备");
    expect(html).not.toContain("message-bar");
    expect(html).not.toContain(statusMessage);
  });

  it("shows token connection inline without App-only device controls", () => {
    const html = renderAuth({
      connectionMethod: "personal-token",
      statusMessage: "已通过 Private 仓库检查。令牌仅保留在当前页面内存中。",
    });
    expect(html).toContain('class="connection-method">Token</span>');
    expect(html).toContain("断开并清除");
    expect(html).not.toContain("撤销全部设备");
    expect(html).not.toContain("message-bar");
  });

  it("preserves errors even while the connection success message is suppressed", () => {
    const html = renderAuth({
      statusMessage: "已通过 GitHub App 登录（owner），访问令牌仅保留在当前页面内存中。",
      errorMessage: "日记读取失败，请重试。",
    });
    expect(html).toContain('class="message-bar error" role="alert">日记读取失败，请重试。');
    expect(html).not.toContain("message-bar success");
  });

  it.each([
    "日记已保存到 GitHub；日期、时间与正文已记录，版本历史由 Git 保留。",
    "日记修改已保存；日期与首次提交时间保持不变，旧版本仍保留在 Git 历史中。",
    "已通过恢复预检，导出文件已下载。",
    "已通过 GitHub App 登录，设置已保存。",
  ])("preserves operational status: %s", (statusMessage) => {
    const html = renderAuth({ statusMessage });
    expect(html).toContain(`class="message-bar success" role="status">${statusMessage}`);
  });

  it("retains disconnected login and token form with its status", () => {
    const statusMessage = "已退出当前设备；页面中的令牌和私人内容已清除。";
    const html = renderAuth({ connection: null, connectionMethod: null, statusMessage });
    expect(html).toContain("连接你的数据仓库");
    expect(html).toContain('href="/auth/login">使用 GitHub 登录');
    expect(html).toContain('class="connection-form"');
    expect(html).toContain('type="password"');
    expect(html).toContain("使用 Token 连接");
    expect(html).toContain(`role="status">${statusMessage}`);
    expect(html).not.toContain('class="connection-method"');
  });

  it("does not discard a connection message when there is no active connection", () => {
    const statusMessage = "已通过 Private 仓库检查。令牌仅保留在当前页面内存中。";
    expect(renderAuth({ connection: null, connectionMethod: null, statusMessage })).toContain(`role="status">${statusMessage}`);
  });

  it("keeps revoke confirmation and disables its actions while revoking", () => {
    const html = renderAuth({ confirmingRevokeAll: true, revokingAll: true });
    expect(html).toContain('role="group" aria-label="确认撤销全部设备"');
    expect(html).toContain("所有设备都需要重新登录。");
    expect(html).toContain('disabled="">退出当前设备</button>');
    expect(html).toContain('disabled="">正在撤销…</button>');
    expect(html).toContain('disabled="">取消</button>');
  });
});
