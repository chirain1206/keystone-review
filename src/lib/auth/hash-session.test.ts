import { describe, expect, it } from "vitest";
import { parseHashSession } from "@/lib/auth/hash-session";

/**
 * FR-7 隐式流增强：隐式流邮件链接回调 hash 解析（纯函数）。
 * 隐式流下 token 挂在 hash：#access_token=...&refresh_token=...&type=magiclink，
 * 无 access_token 时返回 null（维持既有 token_hash/code query 逻辑不变）。
 */
describe("parseHashSession（隐式流 hash 解析）", () => {
  it("解析 access_token + refresh_token", () => {
    expect(parseHashSession("#access_token=at&refresh_token=rt&type=magiclink")).toEqual({
      accessToken: "at",
      refreshToken: "rt",
    });
  });

  it("无 # 前缀也能解析", () => {
    expect(parseHashSession("access_token=at&refresh_token=rt")).toEqual({
      accessToken: "at",
      refreshToken: "rt",
    });
  });

  it("缺少 refresh_token → refreshToken 为空字符串", () => {
    expect(parseHashSession("#access_token=at&type=magiclink")).toEqual({
      accessToken: "at",
      refreshToken: "",
    });
  });

  it("完整隐式流回调 hash（含 expires_in/expires_at/token_type）", () => {
    expect(
      parseHashSession(
        "#access_token=eyJ&expires_in=3600&expires_at=1700000000&refresh_token=rr&token_type=bearer&type=magiclink",
      ),
    ).toEqual({ accessToken: "eyJ", refreshToken: "rr" });
  });

  it("忽略 access_token 前后空白（URL 编码的空格）", () => {
    expect(parseHashSession("#access_token=%20at%20&refresh_token=rt")).toEqual({
      accessToken: "at",
      refreshToken: "rt",
    });
  });

  it("无 access_token → null（不干扰既有 query 逻辑）", () => {
    expect(parseHashSession("")).toBeNull();
    expect(parseHashSession("#type=magiclink")).toBeNull();
    expect(parseHashSession("#refresh_token=rt")).toBeNull();
    expect(parseHashSession("#access_token=")).toBeNull();
  });
});
