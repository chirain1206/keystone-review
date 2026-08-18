import { describe, expect, it } from "vitest";
import { getWclReportMeta, parseWclUrl } from "@/lib/wcl/adapter";

/**
 * T8 验收（FR-1/FR-3）：
 *  - www / cn 双域链接识别与元数据拉取
 *  - 无效链接 / 团本链接的明确中文提示
 *  - 失败降级不抛异常
 */
describe("WCL 链接解析", () => {
  it("www 与 cn 链接均解析出 report code", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123").ok).toBe(true);
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123#fight=7").code).toBe("AbC123");
    expect(parseWclUrl("https://cn.warcraftlogs.com/reports/XYZ987").region).toBe("cn");
  });

  it("非 WCL 链接被拒绝", () => {
    expect(parseWclUrl("https://example.com/reports/abc").ok).toBe(false);
    expect(parseWclUrl("随便一段文字").ok).toBe(false);
    expect(parseWclUrl("https://warcraftlogs.com/login").ok).toBe(false);
  });
});

describe("WCL 元数据（mock 适配器）", () => {
  it("大秘境报告：返回战斗列表（副本/层数/成功）", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/MplusDemo");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.code).toBe("MplusDemo");
      expect(r.meta.fights.length).toBeGreaterThanOrEqual(1);
      expect(r.meta.fights[0].keystoneLevel).toBe(15);
      expect(r.meta.fights[0].name).toBe("Mists of Tirna Scithe");
    }
  });

  it("团本链接（mock 模拟）：明确提示仅支持大秘境", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/RaidDemo");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NOT_MYTHIC");
      expect(r.message).toContain("大秘境");
    }
  });

  it("无效链接：明确提示不是 WCL 链接", async () => {
    const r = await getWclReportMeta("https://www.bilibili.com/video/123");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVALID_LINK");
      expect(r.message).toContain("WCL");
    }
  });

  it("国服链接同样可用（mock 语义一致）", async () => {
    const r = await getWclReportMeta("https://cn.warcraftlogs.com/reports/CnDemo");
    expect(r.ok).toBe(true);
  });
});
