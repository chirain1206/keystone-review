import { describe, expect, it } from "vitest";
import { canTransition, feedbackBodySchema, nextStatus } from "@/lib/feedback/domain";
import { FEEDBACK_CONTENT_MAX, FEEDBACK_PAGE_URL_MAX } from "@/lib/feedback/types";

/**
 * FEEDBACK 纯函数验收：
 *  - 提交 body zod 校验（分类枚举 / 内容长度 / 邮箱格式 / page_url 长度）
 *  - 状态流转 new→read→resolved 单向
 */
describe("反馈提交校验（zod）", () => {
  it("合法提交通过", () => {
    const r = feedbackBodySchema.safeParse({
      category: "bug",
      content: "有个 bug",
      email: "",
      page_url: "/reports/abc",
      turnstileToken: "t",
    });
    expect(r.success).toBe(true);
  });

  it("分类必须是枚举值", () => {
    expect(feedbackBodySchema.safeParse({ category: "nope", content: "x" }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ category: "bug", content: "x" }).success).toBe(true);
  });

  it("内容不能为空（含纯空白）", () => {
    expect(feedbackBodySchema.safeParse({ category: "bug", content: "" }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ category: "bug", content: "   " }).success).toBe(false);
  });

  it(`内容超过 ${FEEDBACK_CONTENT_MAX} 字被拒`, () => {
    expect(
      feedbackBodySchema.safeParse({ category: "bug", content: "a".repeat(FEEDBACK_CONTENT_MAX) }).success,
    ).toBe(true);
    expect(
      feedbackBodySchema.safeParse({
        category: "bug",
        content: "a".repeat(FEEDBACK_CONTENT_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("邮箱格式非法被拒；空串与合法邮箱放行", () => {
    expect(
      feedbackBodySchema.safeParse({ category: "bug", content: "x", email: "not-an-email" }).success,
    ).toBe(false);
    expect(feedbackBodySchema.safeParse({ category: "bug", content: "x", email: "" }).success).toBe(true);
    expect(
      feedbackBodySchema.safeParse({ category: "bug", content: "x", email: "a@b.com" }).success,
    ).toBe(true);
  });

  it(`page_url 超过 ${FEEDBACK_PAGE_URL_MAX} 被拒`, () => {
    expect(
      feedbackBodySchema.safeParse({
        category: "bug",
        content: "x",
        page_url: "a".repeat(FEEDBACK_PAGE_URL_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

describe("反馈状态流转（new→read→resolved）", () => {
  it("单向线性流转", () => {
    expect(canTransition("new", "read")).toBe(true);
    expect(canTransition("read", "resolved")).toBe(true);
    expect(canTransition("new", "resolved")).toBe(false);
    expect(canTransition("read", "new")).toBe(false);
    expect(canTransition("resolved", "read")).toBe(false);
    expect(canTransition("resolved", "resolved")).toBe(false);
  });

  it("nextStatus 返回下一步或终态 null", () => {
    expect(nextStatus("new")).toBe("read");
    expect(nextStatus("read")).toBe("resolved");
    expect(nextStatus("resolved")).toBeNull();
  });
});
