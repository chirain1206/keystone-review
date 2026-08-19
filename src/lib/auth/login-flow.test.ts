import { describe, expect, it } from "vitest";
import {
  LOGIN_EMAIL_SEND_LABEL,
  LOGIN_LINK_RESEND_HINT,
  LOGIN_LINK_SENT_MESSAGE,
  nextStepAfterSend,
} from "@/lib/auth/login-flow";

/**
 * FR-7 统一「邮箱链接登录」：表单文案与流程纯函数。
 *  - 生产：发送后进入「提示查收链接」步骤（不要求输码）
 *  - mock：发送后进入「输码」步骤（保留 6 位验证码）
 */
describe("登录表单文案（链接登录）", () => {
  it("发送按钮文案为「发送登录链接」", () => {
    expect(LOGIN_EMAIL_SEND_LABEL).toBe("发送登录链接");
  });

  it("发送成功提示含「点击邮件中的链接完成登录」", () => {
    expect(LOGIN_LINK_SENT_MESSAGE).toContain("点击邮件中的链接完成登录");
  });

  it("兜底提示含「重新发送」", () => {
    expect(LOGIN_LINK_RESEND_HINT).toContain("重新发送");
  });
});

describe("nextStepAfterSend（发送后流程分支）", () => {
  it("生产（mockMode=false）→ sent：提示查收链接，不再输码", () => {
    expect(nextStepAfterSend(false)).toBe("sent");
  });

  it("mock（mockMode=true）→ code：保留 6 位验证码输入", () => {
    expect(nextStepAfterSend(true)).toBe("code");
  });
});
