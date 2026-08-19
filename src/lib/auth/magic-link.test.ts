import { describe, expect, it } from "vitest";
import { parseMagicLinkToken } from "@/lib/auth/magic-link";

/**
 * FR-7 增强：邮箱魔法链接回调参数解析（纯函数）。
 * 新形式 ?token_hash=...&type=email，老形式 ?code=...，二者等价。
 */
describe("parseMagicLinkToken（魔法链接回调参数解析）", () => {
  it("新形式 token_hash → 返回 token_hash", () => {
    expect(parseMagicLinkToken("?token_hash=abc123&type=email")).toBe("abc123");
  });

  it("老形式 code → 返回 code", () => {
    expect(parseMagicLinkToken("?code=legacy-token")).toBe("legacy-token");
  });

  it("token_hash 优先于 code", () => {
    expect(parseMagicLinkToken("?token_hash=new&code=old")).toBe("new");
  });

  it("token_hash 为空时回退 code", () => {
    expect(parseMagicLinkToken("?token_hash=&code=old")).toBe("old");
  });

  it("无任何参数 → null", () => {
    expect(parseMagicLinkToken("")).toBeNull();
    expect(parseMagicLinkToken("?type=email")).toBeNull();
    expect(parseMagicLinkToken("?foo=bar")).toBeNull();
  });

  it("空白 token_hash → null", () => {
    expect(parseMagicLinkToken("?token_hash=%20%20")).toBeNull();
  });

  it("忽略 token_hash 前后空白", () => {
    expect(parseMagicLinkToken("?token_hash=%20abc%20")).toBe("abc");
  });
});
