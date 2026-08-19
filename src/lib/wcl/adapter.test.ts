import { describe, expect, it, vi } from "vitest";
import {
  getAccessToken,
  getWclReportMeta,
  parseWclUrl,
  selectFight,
  type WclFight,
} from "@/lib/wcl/adapter";

/**
 * T8 验收（FR-1/FR-3）：
 *  - www / cn 双域链接识别与元数据拉取
 *  - 无效链接 / 团本链接的明确中文提示
 *  - 失败降级不抛异常
 *  - ?fight=N 场次参数解析与默认选中（本地验收缺陷修复）
 */
describe("WCL 链接解析", () => {
  it("www 与 cn 链接均解析出 report code", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123").ok).toBe(true);
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123#fight=7").code).toBe("AbC123");
    expect(parseWclUrl("https://cn.warcraftlogs.com/reports/XYZ987").region).toBe("cn");
  });

  it("提取 ?fight=N 查询参数（数字）", () => {
    const r = parseWclUrl(
      "https://www.warcraftlogs.com/reports/47pvKM3LkhnXyDwd?fight=11&type=damage-done",
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe("47pvKM3LkhnXyDwd");
    expect(r.fight).toBe(11);
  });

  it("兼容旧版 #fight=N hash 片段", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123#fight=7").fight).toBe(7);
  });

  it("无 fight 参数时返回 undefined（行为不变）", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123").fight).toBeUndefined();
    expect(
      parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?type=damage-done").fight,
    ).toBeUndefined();
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?fight=abc").fight).toBeUndefined();
  });

  it("非 WCL 链接被拒绝", () => {
    expect(parseWclUrl("https://example.com/reports/abc").ok).toBe(false);
    expect(parseWclUrl("随便一段文字").ok).toBe(false);
    expect(parseWclUrl("https://warcraftlogs.com/login").ok).toBe(false);
    expect(parseWclUrl("http://www.warcraftlogs.com/reports/abc").ok).toBe(false);
  });

  it("支持 fight=last（query 与 hash 均可）", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?fight=last").fight).toBe(
      "last",
    );
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123#fight=last").fight).toBe(
      "last",
    );
  });

  it("忽略 type/source 等视图参数，仅提取 fight", () => {
    const r = parseWclUrl(
      "https://www.warcraftlogs.com/reports/47pvKM3LkhnXyDwd?fight=11&type=damage-done&source=123",
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe("47pvKM3LkhnXyDwd");
    expect(r.fight).toBe(11);
  });

  it("兼容大写路径、参数名与值", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/REPORTS/AbC123").code).toBe("AbC123");
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?FIGHT=11").fight).toBe(11);
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?fight=LAST").fight).toBe("last");
  });

  it("兼容 URL 编码与参数顺序无关", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?type=damage-done&fight=%31%31").fight).toBe(11);
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123?fight=last&type=damage-done").fight).toBe("last");
  });

  it("hash 片段可携带附加视图参数", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123#fight=7&type=damage-done").fight).toBe(7);
  });

  it("code 保留尾斜杠仍可解析", () => {
    expect(parseWclUrl("https://www.warcraftlogs.com/reports/AbC123/").code).toBe("AbC123");
  });
});

describe("WCL 场次默认选中（selectFight）", () => {
  const fights: WclFight[] = [
    {
      id: 7,
      name: "Mists of Tirna Scithe",
      difficulty: 8,
      keystoneLevel: 15,
      affixes: [],
      success: true,
      durationSec: 1650,
      playerName: "P",
      playerClass: "Mage",
      playerSpec: "Fire",
    },
    {
      id: 11,
      name: "Grim Batol",
      difficulty: 8,
      keystoneLevel: 12,
      affixes: [],
      success: false,
      durationSec: 1830,
      playerName: "P",
      playerClass: "Mage",
      playerSpec: "Fire",
      selected: true,
    },
  ];

  it("selected 场次优先于最高层数", () => {
    expect(selectFight(fights)?.id).toBe(11);
  });

  it("显式 fightId 命中时优先于 selected", () => {
    expect(selectFight(fights, 7)?.id).toBe(7);
  });

  it("无 selected 时回退到最高层数（历史行为）", () => {
    const noSelected = fights.map((f) => ({ ...f, selected: false }));
    expect(selectFight(noSelected)?.id).toBe(7);
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
      expect(r.message).toBe(
        "第一版仅支持大秘境分析，请重新粘贴大秘境 log 链接，或上传战斗日志文件",
      );
    }
  });

  it("无大秘境战斗的报告：明确引导更换链接或上传日志", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/EmptyDemo");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NO_MYTHIC_FIGHT");
      expect(r.message).toBe("该报告中没有大秘境战斗，请更换链接或上传日志文件");
    }
  });

  it("无效链接：明确提示链接无效或过期", async () => {
    const r = await getWclReportMeta("https://www.bilibili.com/video/123");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVALID_LINK");
      expect(r.message).toBe("链接无效或报告已过期，请检查后重新粘贴，或上传日志文件");
    }
  });

  it("国服链接同样可用（mock 语义一致）", async () => {
    const r = await getWclReportMeta("https://cn.warcraftlogs.com/reports/CnDemo");
    expect(r.ok).toBe(true);
  });

  it("?fight=N 标记对应场次为 selected 且不丢失其他场次", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/MplusDemo?fight=9");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.fights).toHaveLength(2);
      const selected = r.meta.fights.filter((f) => f.selected);
      expect(selected.map((f) => f.id)).toEqual([9]);
      expect(r.meta.fights.map((f) => f.id).sort((a, b) => a - b)).toEqual([7, 9]);
    }
  });

  it("无 fight 参数时无 selected 标记（行为不变）", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/MplusDemo");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.fights.some((f) => f.selected)).toBe(false);
    }
  });

  it("?fight=last 预选最后一场大秘境且不丢失其他场次", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/MplusDemo?fight=last");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.fights).toHaveLength(2);
      const selected = r.meta.fights.filter((f) => f.selected);
      expect(selected.map((f) => f.id)).toEqual([9]); // 最大 fight id = 最后一场
      expect(r.meta.fights.map((f) => f.id).sort((a, b) => a - b)).toEqual([7, 9]);
    }
  });

  it("?fight=N 找不到对应场次时回退无预选并保留全部场次", async () => {
    const r = await getWclReportMeta("https://www.warcraftlogs.com/reports/MplusDemo?fight=999");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.fights).toHaveLength(2);
      expect(r.meta.fights.some((f) => f.selected)).toBe(false);
      expect(r.meta.fights.map((f) => f.id).sort((a, b) => a - b)).toEqual([7, 9]);
    }
  });
});

describe("WCL OAuth getAccessToken（client_credentials）", () => {
  it("携带 HTTP Basic 头（base64(client_id:client_secret)）与 client_credentials body", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ access_token: "tok-123", token_type: "bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const token = await getAccessToken("www", {
      fetchFn,
      clientId: "my-id",
      clientSecret: "my-secret",
    });

    expect(token).toBe("tok-123");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.warcraftlogs.com/oauth/token");
    expect(init?.method).toBe("POST");

    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Basic bXktaWQ6bXktc2VjcmV0"); // base64(my-id:my-secret)
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(String(init?.body)).toBe("grant_type=client_credentials");
  });

  it("cn 区域使用 cn.warcraftlogs.com 端点", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ access_token: "t" }), { status: 200 }),
    );
    await getAccessToken("cn", { fetchFn, clientId: "id", clientSecret: "secret" });
    expect(fetchFn.mock.calls[0][0]).toBe("https://cn.warcraftlogs.com/oauth/token");
  });

  it("缺少凭证时抛错且不发起请求", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(getAccessToken("www", { fetchFn, clientId: "", clientSecret: "s" })).rejects.toThrow(
      "WCL_CLIENT_ID",
    );
    await expect(
      getAccessToken("www", { fetchFn, clientId: "id", clientSecret: undefined }),
    ).rejects.toThrow("WCL_CLIENT_SECRET");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("未注入凭证时回退读 envConfig，未配置则抛错", async () => {
    // 本测试进程未设置 WCL_CLIENT_ID/WCL_CLIENT_SECRET，envConfig 读取为空串
    await expect(getAccessToken("www", { fetchFn: vi.fn<typeof fetch>() })).rejects.toThrow(
      "WCL_CLIENT_ID",
    );
  });
});
