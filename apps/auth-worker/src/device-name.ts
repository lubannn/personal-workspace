const UNKNOWN_SYSTEM = "未知系统";
const UNKNOWN_BROWSER = "未知浏览器";
const MAX_USER_AGENT_LENGTH = 1024;
export const MAX_DEVICE_NAME_LENGTH = 64;

/** Informational, allowlisted labels only. Never returns UA text or hardware details. */
export function loginDeviceName(userAgent: string | null): string {
  if (!userAgent || userAgent.length > MAX_USER_AGENT_LENGTH
    || /[^\x20-\x7e]|[<>"\\]/.test(userAgent)
    || !/^Mozilla\/5\.0 \([^)]+\)/.test(userAgent)) {
    return `${UNKNOWN_SYSTEM}－${UNKNOWN_BROWSER}`;
  }

  // iOS also contains "Mac OS X"; Android also contains "Linux".
  const platforms = [
    [/\biPhone\b/.test(userAgent), "iPhone"],
    [/\biPad\b/.test(userAgent), "iPad"],
    [/\biPod\b/.test(userAgent), "iPod"],
    [/\bWindows NT\b/.test(userAgent), "Windows"],
    [/\bAndroid\b/.test(userAgent), "Android"],
    [/\bMacintosh\b/.test(userAgent) && !/\bMobile\//.test(userAgent), "Mac"],
    [/\bLinux\b/.test(userAgent) && !/\bAndroid\b/.test(userAgent), "Linux"],
    [/\bCrOS\b/.test(userAgent), "ChromeOS"],
  ].filter(([matches]) => matches);
  let system = platforms.length === 1 ? platforms[0][1] as string : UNKNOWN_SYSTEM;
  // iOS desktop mode can report Macintosh; its explicit iOS browser token
  // cannot reliably tell iPhone from iPad, so do not present it as a Mac.
  if (/\b(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent) && !["iPhone", "iPad", "iPod"].includes(system)) system = UNKNOWN_SYSTEM;

  // Known embedded apps/WebViews and unsupported brands must not fall through
  // to Safari/Chrome just because they share compatibility tokens.
  const embeddedOrUnsupported = /;\s*wv\b|\b(?:FBAN|FBAV|FBIOS|FB_IAB|Instagram|MicroMessenger|GSA|Line|TikTok|BytedanceWebview|Electron|Teams|Discord|DuckDuckGo|Vivaldi|Brave|YaBrowser|UCBrowser|QQBrowser|SeaMonkey|HeadlessChrome|bot|spider|crawler)\b/i.test(userAgent);
  if (embeddedOrUnsupported) return `${system}－${UNKNOWN_BROWSER}`;

  const browsers = [
    [/\b(?:Edg|EdgA|EdgiOS|Edge)\/[\d.]+/.test(userAgent), "Edge"],
    [/\b(?:OPR|Opera|OPiOS)\/[\d.]+/.test(userAgent), "Opera"],
    [/\bSamsungBrowser\/[\d.]+/.test(userAgent), "Samsung Internet"],
    [/\b(?:Firefox|FxiOS)\/[\d.]+/.test(userAgent), "Firefox"],
    [/\bCriOS\/[\d.]+/.test(userAgent), "Chrome"],
    [/\bChromium\/[\d.]+/.test(userAgent), "Chromium"],
  ].filter(([matches]) => matches);
  let browser = UNKNOWN_BROWSER;
  if (browsers.length === 1) {
    browser = browsers[0][1] as string;
    if ((browser === "Firefox" || /\bCriOS\//.test(userAgent)) && /\bChrome\//.test(userAgent)) browser = UNKNOWN_BROWSER;
  } else if (browsers.length === 0) {
    if (/\bChrome\/[\d.]+/.test(userAgent) && /\bAppleWebKit\//.test(userAgent)) browser = "Chrome";
    else if (/\bVersion\/[\d.]+/.test(userAgent) && /\bSafari\/[\d.]+/.test(userAgent)
      && /\bAppleWebKit\//.test(userAgent) && ["Mac", "iPhone", "iPad", "iPod"].includes(system)) browser = "Safari";
  }
  // All components above are fixed strings, with a second hard bound as a safeguard.
  return `${system}－${browser}`.slice(0, MAX_DEVICE_NAME_LENGTH);
}
