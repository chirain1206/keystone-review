import { describe, expect, it } from "vitest";
import { shouldShowFightSelector } from "@/lib/wcl/link-preview";

/**
 * FR 本地验收：单场报告自动跳过战斗选择。
 *  - 仅 1 场大秘境 → 隐藏选场列表，直接进入"选复盘对象"；
 *  - 多场（>1）→ 保持战斗列表选择。
 */
describe("shouldShowFightSelector（单场自动跳过战斗选择）", () => {
  it("单场报告：跳过选战斗步骤", () => {
    expect(shouldShowFightSelector([{ id: 7 }])).toBe(false);
  });

  it("多场报告：展示战斗列表供选择", () => {
    expect(
      shouldShowFightSelector([
        { id: 7 },
        { id: 9 },
      ]),
    ).toBe(true);
    expect(shouldShowFightSelector([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(true);
  });

  it("空列表：不展示选场列表（由上层 NO_MYTHIC_FIGHT 兜底）", () => {
    expect(shouldShowFightSelector([])).toBe(false);
  });
});
