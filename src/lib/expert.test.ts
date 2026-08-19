import { afterEach, describe, expect, it } from "vitest";
import { authorizeExpert, getExpertEmails, isExpert } from "@/lib/expert";
import type { AuthUser } from "@/lib/auth/types";

/**
 * 专家白名单（FR-11 增强）验收：
 *  - EXPERT_EMAILS 解析（逗号分隔、大小写不敏感、去空白）
 *  - isExpert 命中/未命中
 *  - authorizeExpert：未登录 401、非白名单 403、白名单放行
 */

function setExperts(raw: string) {
  process.env.EXPERT_EMAILS = raw;
}

afterEach(() => {
  delete process.env.EXPERT_EMAILS;
});

const expertUser: AuthUser = { id: "u1", email: "expert@example.com" };

describe("白名单解析", () => {
  it("逗号分隔 + 去空白 + 大小写不敏感", () => {
    setExperts(" a@x.com , B@X.com , expert@example.com ");
    const set = getExpertEmails();
    expect(set.size).toBe(3);
    expect(set.has("a@x.com")).toBe(true);
    expect(set.has("b@x.com")).toBe(true);
    expect(set.has("expert@example.com")).toBe(true);
    expect(isExpert("A@X.COM")).toBe(true);
  });

  it("空白名单 → 一律非专家", () => {
    setExperts("");
    expect(getExpertEmails().size).toBe(0);
    expect(isExpert("expert@example.com")).toBe(false);
  });
});

describe("authorizeExpert 门禁", () => {
  it("未登录 → 401", () => {
    const gate = authorizeExpert(null);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.status).toBe(401);
  });

  it("登录但非白名单 → 403", () => {
    setExperts("expert@example.com");
    const gate = authorizeExpert({ id: "u2", email: "outsider@example.com" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.status).toBe(403);
      expect(gate.error).toContain("专家白名单");
    }
  });

  it("白名单用户 → 放行", () => {
    setExperts("expert@example.com");
    expect(authorizeExpert(expertUser).ok).toBe(true);
    // 大小写不敏感
    expect(authorizeExpert({ id: "u3", email: "EXPERT@example.com" }).ok).toBe(true);
  });
});
