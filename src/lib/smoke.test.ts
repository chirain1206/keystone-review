import { describe, expect, it } from "vitest";

// 测试框架冒烟测试：验证 vitest + 别名解析可用（T1）
describe("smoke", () => {
  it("vitest 可运行", () => {
    expect(1 + 1).toBe(2);
  });

  it("路径别名 @ 解析正常", async () => {
    const { envConfig } = await import("@/lib/env");
    expect(typeof envConfig.appUrl).toBe("string");
    expect(envConfig.supabaseEnabled).toBe(false); // 测试环境无密钥 → mock 模式
  });
});
