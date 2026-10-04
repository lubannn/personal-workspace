import { describe, expect, it } from "vitest";
import { corosSportLabel, customCorosSportName } from "./coros-sport-labels";

describe("COROS specific sport labels", () => {
  it("shows specific sports previously collapsed into other, with an honest unknown fallback", () => {
    expect([1000, 901, 902, 400, 101, 201].map(code => corosSportLabel(code))).toEqual(["羽毛球", "跳绳", "爬楼", "室内有氧", "室内跑步", "室内骑行"]);
    expect(corosSportLabel(4500, "New Sport")).toBe("New Sport");
    expect(corosSportLabel(undefined)).toBeUndefined();
  });
  it("uses explicit custom exercise labels without retaining a location or coordinates", () => {
    expect(corosSportLabel(9904, "爬坡")).toBe("爬坡");
    expect(corosSportLabel(9904, "超慢跑")).toBe("超慢跑");
    expect(customCorosSportName(104, "爬坡")).toBeUndefined();
    expect(customCorosSportName(9904, "Synthetic location 1.2,3.4")).toBeUndefined();
    expect(corosSportLabel(9904, "Custom Indoor Other")).toBe("自定义室内运动");
  });
});
