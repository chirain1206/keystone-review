import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEmailMode, validateProductionEnv } from "@/lib/env";

/**
 * M-2 验收：生产 fail-fast 环境校验。
 * 用"伪造的假值 + 删键"模拟缺失，绝不写入任何真实密钥；
 * 校验结果只含键名/说明，不含密钥值。
 * EMAIL_MODE 影响 RESEND_API_KEY/EMAIL_FROM 是否强制要求。
 */

const BASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPSEEK_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "WCL_CLIENT_ID",
  "WCL_CLIENT_SECRET",
  "EMBEDDING_API_KEY",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
];

const RESEND_KEYS = ["RESEND_API_KEY", "EMAIL_FROM"];

const ALL_KEYS = [...BASE_KEYS, ...RESEND_KEYS, "APP_URL"];

/** 经索引签名写 process.env，绕过 @types/node 对 NODE_ENV 的只读声明。 */
function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved.clear();
  for (const k of [...ALL_KEYS, "NODE_ENV", "EMAIL_MODE"]) saved.set(k, process.env[k]);
});

afterEach(() => {
  for (const [k, v] of saved) setEnv(k, v);
});

describe("getEmailMode（EMAIL_MODE 解析）", () => {
  it("未设置时默认 supabase", () => {
    setEnv("EMAIL_MODE", undefined);
    expect(getEmailMode()).toBe("supabase");
  });

  it("显式 resend → resend（大小写不敏感）", () => {
    setEnv("EMAIL_MODE", "resend");
    expect(getEmailMode()).toBe("resend");
    setEnv("EMAIL_MODE", "Resend");
    expect(getEmailMode()).toBe("resend");
    setEnv("EMAIL_MODE", "RESEND");
    expect(getEmailMode()).toBe("resend");
  });

  it("非法值回退 supabase", () => {
    setEnv("EMAIL_MODE", "smtp");
    expect(getEmailMode()).toBe("supabase");
  });
});

describe("validateProductionEnv（M-2 生产 fail-fast）", () => {
  it("非生产环境恒返回空数组（不触发校验）", () => {
    setEnv("NODE_ENV", "development");
    for (const k of ALL_KEYS) setEnv(k, undefined);
    expect(validateProductionEnv()).toEqual([]);
  });

  it("生产环境（默认 supabase 模式）缺密钥时列出缺失项，且不要求 Resend", () => {
    setEnv("NODE_ENV", "production");
    setEnv("EMAIL_MODE", undefined);
    for (const k of ALL_KEYS) setEnv(k, undefined);

    const missing = validateProductionEnv();
    for (const k of BASE_KEYS) expect(missing).toContain(k);
    expect(missing).toContain("APP_URL（必须以 https:// 开头）");
    // supabase 模式：不强制要求 Resend
    expect(missing).not.toContain("RESEND_API_KEY");
    expect(missing).not.toContain("EMAIL_FROM");
    // 精确 12 项（11 基础 + APP_URL），且绝不携带任何密钥值
    expect([...missing].sort()).toEqual([
      "APP_URL（必须以 https:// 开头）",
      "DEEPSEEK_API_KEY",
      "EMBEDDING_API_KEY",
      "EMBEDDING_BASE_URL",
      "EMBEDDING_MODEL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TURNSTILE_SECRET_KEY",
      "WCL_CLIENT_ID",
      "WCL_CLIENT_SECRET",
    ].sort());
  });

  it("生产环境（resend 模式）缺密钥时强制要求 Resend 两项", () => {
    setEnv("NODE_ENV", "production");
    setEnv("EMAIL_MODE", "resend");
    for (const k of ALL_KEYS) setEnv(k, undefined);

    const missing = validateProductionEnv();
    expect(missing).toContain("RESEND_API_KEY");
    expect(missing).toContain("EMAIL_FROM");
    for (const k of BASE_KEYS) expect(missing).toContain(k);
    expect(missing).toContain("APP_URL（必须以 https:// 开头）");
    expect([...missing].sort()).toEqual([
      "APP_URL（必须以 https:// 开头）",
      "DEEPSEEK_API_KEY",
      "EMAIL_FROM",
      "EMBEDDING_API_KEY",
      "EMBEDDING_BASE_URL",
      "EMBEDDING_MODEL",
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
    setEnv("EMAIL_MODE", undefined);
    for (const k of ALL_KEYS) setEnv(k, "fake-value");
    setEnv("APP_URL", "http://insecure.example.com");

    const missing = validateProductionEnv();
    expect(missing).toContain("APP_URL（必须以 https:// 开头）");
    expect(missing).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("生产环境 supabase 模式配置齐全（无需 Resend）时返回空数组", () => {
    setEnv("NODE_ENV", "production");
    setEnv("EMAIL_MODE", undefined);
    for (const k of BASE_KEYS) setEnv(k, "fake-value");
    setEnv("APP_URL", "https://wow-analyzer.example.com");

    expect(validateProductionEnv()).toEqual([]);
  });

  it("生产环境 resend 模式配置齐全（含 Resend）时返回空数组", () => {
    setEnv("NODE_ENV", "production");
    setEnv("EMAIL_MODE", "resend");
    for (const k of ALL_KEYS) setEnv(k, "fake-value");
    setEnv("APP_URL", "https://wow-analyzer.example.com");

    expect(validateProductionEnv()).toEqual([]);
  });
});
