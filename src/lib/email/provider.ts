import { envConfig } from "@/lib/env";

/**
 * 邮件适配器（T3）。
 *  - 有 RESEND_API_KEY → 通过 Resend REST API 真实发送
 *  - 无密钥（开发/mock）→ 把邮件内容写到服务端控制台，流程照常走通
 * 部署阶段在 Vercel 配置 RESEND_API_KEY 即可真实发信。
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!envConfig.resendApiKey) {
    // mock 模式：验证码写到服务端日志（开发调试）
    if (envConfig.devLogCodes || process.env.NODE_ENV !== "production") {
      console.log(
        `[email:mock] to=${input.to} subject="${input.subject}"\n${input.text}`,
      );
    }
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envConfig.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: envConfig.emailFrom,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "发送失败" };
  }
}

export async function sendVerificationCodeEmail(to: string, code: string): Promise<boolean> {
  const r = await sendEmail({
    to,
    subject: "你的 WoW M+ AI 复盘教练登录验证码",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#c77800">WoW M+ AI 复盘教练</h2>
        <p>你的登录验证码：</p>
        <p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p>
        <p>验证码 10 分钟内有效。如非本人操作，请忽略本邮件。</p>
      </div>`,
    text: `你的 WoW M+ AI 复盘教练登录验证码：${code}（10 分钟内有效）。如非本人操作，请忽略。`,
  });
  return r.ok;
}
