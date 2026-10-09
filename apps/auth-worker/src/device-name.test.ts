import { describe, expect, it } from "vitest";
import { loginDeviceName, MAX_DEVICE_NAME_LENGTH } from "./device-name";

const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
const ipad = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)";
const android = "Mozilla/5.0 (Linux; Android 10; K)";
const webkit = "AppleWebKit/537.36 (KHTML, like Gecko)";
const chrome = `${webkit} Chrome/134.0.0.0 Safari/537.36`;
const safari = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const SYNTHETIC_MAC_CHROME = `${mac} ${chrome}`;
export const SYNTHETIC_IPHONE_SAFARI = `${iphone} ${safari}`;

describe("coarse login browser labels", () => {
  it.each([
    [SYNTHETIC_MAC_CHROME, "Mac－Chrome"],
    [`${mac} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`, "Mac－Safari"],
    [`${mac} Gecko/20100101 Firefox/138.0`, "Mac－Firefox"],
    [`${mac} ${chrome} Edg/134.0.0.0`, "Mac－Edge"],
    [`${windows} ${chrome}`, "Windows－Chrome"],
    [`${windows} ${chrome} Edg/134.0.0.0`, "Windows－Edge"],
    [`${windows} Gecko/20100101 Firefox/138.0`, "Windows－Firefox"],
    [SYNTHETIC_IPHONE_SAFARI, "iPhone－Safari"],
    [`${iphone} ${webkit} CriOS/134.0.0.0 Mobile/15E148 Safari/604.1`, "iPhone－Chrome"],
    [`${iphone} ${webkit} FxiOS/138.0 Mobile/15E148 Safari/605.1.15`, "iPhone－Firefox"],
    [`${iphone} ${safari} EdgiOS/134.0.0.0`, "iPhone－Edge"],
    [`${ipad} ${safari}`, "iPad－Safari"],
    [`${ipad} ${webkit} CriOS/134.0.0.0 Mobile/15E148 Safari/604.1`, "iPad－Chrome"],
    [`${android} ${chrome}`, "Android－Chrome"],
    [`${android} ${chrome} EdgA/134.0.0.0`, "Android－Edge"],
    ["Mozilla/5.0 (Android 15; Mobile; rv:138.0) Gecko/138.0 Firefox/138.0", "Android－Firefox"],
    [`${android} ${chrome} SamsungBrowser/27.0`, "Android－Samsung Internet"],
    [`${android} ${chrome} OPR/82.0`, "Android－Opera"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/138.0", "Linux－Firefox"],
    [`Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) ${chrome}`, "ChromeOS－Chrome"],
    [`${windows} ${webkit} Chromium/134.0.0.0 Safari/537.36`, "Windows－Chromium"],
  ])("maps declared platform/browser without hardware or versions: %s", (ua, expected) => {
    expect(loginDeviceName(ua)).toBe(expected);
    expect(loginDeviceName(ua).length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(loginDeviceName(ua)).not.toMatch(/134|138|10_15|Intel|Win64|x86|MacBook|Pixel/);
  });

  it.each([
    [null, "未知系统－未知浏览器"], ["", "未知系统－未知浏览器"],
    ["unrecognized-client", "未知系统－未知浏览器"],
    ["Mozilla/5.0 (Unknown OS) UnknownBrowser/1.0", "未知系统－未知浏览器"],
    [`${mac} UnknownBrowser/1.0`, "Mac－未知浏览器"],
    [`${iphone} AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`, "iPhone－未知浏览器"],
    [`Mozilla/5.0 (Linux; Android 10; K; wv) ${chrome}`, "Android－未知浏览器"],
    [`${iphone} ${safari} GSA/345.0`, "iPhone－未知浏览器"],
    [`${iphone} ${safari} [FBAN/FBIOS;FBAV/500]`, "iPhone－未知浏览器"],
    [`${iphone} ${safari} Instagram 350.0`, "iPhone－未知浏览器"],
    [`${android} ${chrome} MicroMessenger/8.0`, "Android－未知浏览器"],
    [`${mac} ${chrome} Electron/30.0`, "Mac－未知浏览器"],
    [`${mac} ${chrome} Vivaldi/6.0`, "Mac－未知浏览器"],
    [`${windows} ${chrome} Edg/134.0 Firefox/138.0`, "Windows－未知浏览器"],
    [`${windows} ${chrome} Firefox/138.0`, "Windows－未知浏览器"],
    [`${mac} ${webkit} CriOS/134.0.0.0 Safari/605.1.15`, "未知系统－Chrome"],
    [`${mac} ${webkit} FxiOS/138.0 Safari/605.1.15`, "未知系统－Firefox"],
    [`${mac} ${webkit} EdgiOS/134.0 Safari/605.1.15`, "未知系统－Edge"],
    [`Mozilla/5.0 (Windows NT 10.0; Android 10) ${chrome}`, "未知系统－Chrome"],
    [`${mac} ${safari}`, "未知系统－未知浏览器"],
    [`${mac} ${chrome}<script>alert(1)</script>`, "未知系统－未知浏览器"],
    [`${mac} ${chrome}\nprivate`, "未知系统－未知浏览器"],
    [`${mac} ${chrome}\u0000`, "未知系统－未知浏览器"],
    [`${mac} ${chrome}${"x".repeat(1024)}`, "未知系统－未知浏览器"],
  ])("uses unknown instead of guessing for missing/ambiguous/embedded/malicious UA: %s", (ua, expected) => {
    expect(loginDeviceName(ua)).toBe(expected);
  });

  it("does not extract a model, build number, injected name or IP from UA", () => {
    const ua = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/SECRET_BUILD; 192.0.2.1) " + chrome;
    expect(loginDeviceName(ua)).toBe("Android－Chrome");
  });
});
