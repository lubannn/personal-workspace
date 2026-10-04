/** COROS sport codes supplied by querySportRecords. Keep the broad import category separate. */
const labels: Record<number, string> = {
  100: "户外跑步", 101: "室内跑步", 102: "越野跑", 103: "操场跑步", 104: "徒步", 105: "登山", 106: "多段攀登",
  200: "户外骑行", 201: "室内骑行", 202: "电助力骑行", 203: "砾石骑行", 204: "山地骑行", 205: "电助力山地骑行", 299: "骑行",
  300: "泳池游泳", 301: "公开水域游泳", 400: "室内有氧", 401: "户外有氧", 402: "力量训练",
  500: "双板滑雪", 501: "单板滑雪", 502: "越野滑雪", 503: "登山滑雪", 600: "飞行运动",
  700: "划船", 701: "室内划船", 702: "激流运动", 704: "静水运动", 705: "帆板", 706: "速度冲浪",
  707: "船钓路亚", 708: "岸钓路亚", 709: "塘钓路亚", 710: "皮划艇钓鱼", 711: "近海钓鱼", 712: "远海钓鱼", 713: "船钓飞蝇", 714: "岸钓飞蝇", 715: "浪区钓鱼",
  800: "室内攀岩", 801: "抱石", 802: "户外攀岩", 900: "步行", 901: "跳绳", 902: "爬楼", 903: "椭圆机", 904: "瑜伽", 905: "普拉提", 906: "拳击",
  1000: "羽毛球", 1001: "乒乓球", 1002: "篮球", 1003: "足球", 1004: "匹克球", 1005: "网球", 1006: "板式网球",
  1100: "飞盘", 1101: "滑板", 1200: "混合体能训练",
  9800: "自定义户外球类", 9801: "自定义户外休闲", 9802: "自定义山地运动", 9803: "自定义高空运动", 9804: "自定义机动车运动", 9805: "自定义水上运动", 9806: "自定义探险", 9807: "自定义户外运动",
  9900: "自定义室内球类", 9901: "自定义力量训练", 9902: "自定义塑形", 9903: "自定义舞蹈", 9904: "自定义室内运动", 9999: "自定义运动",
  10000: "铁人三项", 10001: "多项运动", 10002: "登山滑雪组合", 10003: "多段攀登", 25301: "轨迹运动",
};

/** Only explicit exercise labels in the custom sport's location field; never retain a place or coordinates. */
export function customCorosSportName(code: number, value: string | undefined): string | undefined {
  return code >= 9800 && code <= 9999 && value && ["爬坡", "超慢跑", "跑步机", "室内有氧", "跳绳", "爬楼", "上肢力量", "下肢力量", "核心训练", "拉伸"].includes(value) ? value : undefined;
}

export function corosSportLabel(code: number | undefined, sourceName?: string): string | undefined {
  if (code === undefined) return undefined;
  const custom = customCorosSportName(code, sourceName);
  return custom ?? labels[code] ?? sourceName ?? `运动类型 ${code}`;
}
