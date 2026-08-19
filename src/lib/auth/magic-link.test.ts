import { describe, expect, it } from "vitest";
import {
  AUTH_LINK_EXPIRED_MESSAGE,
  parseAuthLinkError,
  parseMagicLinkSource,
  parseMagicLinkToken,
} from "@/lib/auth/magic-link";

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

/**
 * parseMagicLinkSource：区分 token 来源（token_hash vs code），
 * 供服务端对老形式 ?code= 做 signup 回退。
 */
describe("parseMagicLinkSource（回调参数来源解析）", () => {
  it("新形式 token_hash → source=token_hash", () => {
    expect(parseMagicLinkSource("?token_hash=abc123&type=email")).toEqual({
      tokenHash: "abc123",
      source: "token_hash",
    });
  });

  it("老形式 code → source=code", () => {
    expect(parseMagicLinkSource("?code=legacy-token")).toEqual({
      tokenHash: "legacy-token",
      source: "code",
    });
  });

  it("token_hash 优先于 code", () => {
    expect(parseMagicLinkSource("?token_hash=new&code=old")).toEqual({
      tokenHash: "new",
      source: "token_hash",
    });
  });

  it("无任何参数 / 空值 → null", () => {
    expect(parseMagicLinkSource("")).toBeNull();
    expect(parseMagicLinkSource("?type=email")).toBeNull();
    expect(parseMagicLinkSource("?token_hash=")).toBeNull();
    expect(parseMagicLinkSource("?code=%20%20")).toBeNull();
  });
});

/**
 * 登录链接失效 / 过期：Supabase 重定向到 ?error=...&error_code=...&error_description=...
 * 纯函数解析，命中返回友好提示文案；未命中返回 null（不影响 6 位验证码路径）。
 */
describe("parseAuthLinkError（登录链接失效提示解析）", () => {
  it("含 error 参数 → 返回友好提示", () => {
    expect(parseAuthLinkError("?error=access_denied&error_code=otp_expired")).toBe(
      AUTH_LINK_EXPIRED_MESSAGE,
    );
  });

  it("仅含 error_description 参数 → 返回友好提示", () => {
    expect(parseAuthLinkError("?error_description=Email+link+is+invalid+or+has+expired")).toBe(
      AUTH_LINK_EXPIRED_MESSAGE,
    );
  });

  it("完整 Supabase 过期回调参数 → 返回友好提示", () => {
    expect(
      parseAuthLinkError(
        "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toBe(AUTH_LINK_EXPIRED_MESSAGE);
  });

  it("无 error / error_description → null（不影响正常登录与 6 位验证码）", () => {
    expect(parseAuthLinkError("")).toBeNull();
    expect(parseAuthLinkError("?token_hash=abc123&type=email")).toBeNull();
    expect(parseAuthLinkError("?code=legacy-token")).toBeNull();
  });
});
