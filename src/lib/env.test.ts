import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateProductionEnv } from "@/lib/env";

/**
 * M-2 验收：生产 fail-fast 环境校验。
 * 用"伪造的假值 + 删键"模拟缺失，绝不写入任何真实密钥；
 * 校验结果只含键名/说明，不含密钥值。
 */

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "DEEPSEEK_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "WCL_CLIENT_ID",
  "WCL_CLIENT_SECRET",
  "APP_URL",
];

/** 经索引签名写 process.env，绕过 @types/node 对 NODE_ENV 的只读声明。 */
function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved.clear();
  for (const k of [...REQUIRED_KEYS, "NODE_ENV"]) saved.set(k, process.env[k]);
});

afterEach(() => {
  for (const [k, v] of saved) setEnv(k, v);
});

describe("validateProductionEnv（M-2 生产 fail-fast）", () => {
  it("非生产环境恒返回空数组（不触发校验）", () => {
    setEnv("NODE_ENV", "development");
    for (const k of REQUIRED_KEYS) setEnv(k, undefined);
    expect(validateProductionEnv()).toEqual([]);
  });

  it("生产环境缺密钥时列出全部缺失项，且不泄露密钥值", () => {
    setEnv("NODE_ENV", "production");
    for (const k of REQUIRED_KEYS) setEnv(k, undefined);

    const missing = validateProductionEnv();
    expect(missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(missing).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(missing).toContain("RESEND_API_KEY");
    expect(missing).toContain("EMAIL_FROM");
    expect(missing).toContain("DEEPSEEK_API_KEY");
    expect(missing).toContain("TURNSTILE_SECRET_KEY");
    expect(missing).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(missing).toContain("WCL_CLIENT_ID");
    expect(missing).toContain("WCL_CLIENT_SECRET");
    expect(missing).toContain("APP_URL（必须以 https:// 开头）");
    // 返回值只含键名/说明（精确 11 项），绝不携带任何密钥值
    expect([...missing].sort()).toEqual([
      "APP_URL（必须以 https:// 开头）",
      "DEEPSEEK_API_KEY",
      "EMAIL_FROM",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "RESEND_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TURNSTILE_SECRET_KEY",
      "WCL_CLIENT_ID",
      "WCL_CLIENT_SECRET",
    ].sort());
  });

  it("APP_URL 非 https 时单独列入缺失项", () => {
    setEnv("NODE_ENV", "production");
    for (const k of REQUIRED_KEYS) setEnv(k, "fake-value");
    setEnv("APP_URL", "http://insecure.example.com");

    const missing = validateProductionEnv();
    expect(missing).toContain("APP_URL（必须以 https:// 开头）");
    expect(missing).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("生产环境配置齐全（含 https APP_URL）时返回空数组", () => {
    setEnv("NODE_ENV", "production");
    for (const k of REQUIRED_KEYS) setEnv(k, "fake-value");
    setEnv("APP_URL", "https://wow-analyzer.example.com");

    expect(validateProductionEnv()).toEqual([]);
  });
});
