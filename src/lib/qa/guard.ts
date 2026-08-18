/**
 * 违规内容守卫（T7，FR-6）：代练 / RMT / 账号交易 / 陪玩等请求一律礼貌拒绝。
 * 规则关键词 + 归一化匹配（纯函数，可单测）。真实模型侧还有提示词层守卫（双保险）。
 */

export const VIOLATION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /代练|代打|上号|帮打|刷分|刷等级/, label: "代练" },
  { re: /账号交易|卖号|买号|出售账号|收购账号|租号/, label: "账号交易" },
  { re: /陪玩|陪练服务|下单陪/, label: "陪玩" },
  { re: /rmt|现实货币|现金交易|微信转账|支付宝转账|人民币交易|金币交易|出金|买金/, label: "现金交易" },
  { re: /工作室|脚本|外挂|作弊|宏脚本代打/, label: "违规工具" },
  { re: /共享账号|借号|出租战网/, label: "账号共享" },
];

export interface ViolationResult {
  violated: boolean;
  label?: string;
}

export function detectViolation(question: string): ViolationResult {
  const q = question.toLowerCase();
  for (const p of VIOLATION_PATTERNS) {
    if (p.re.test(q)) return { violated: true, label: p.label };
  }
  return { violated: false };
}

export const REFUSAL_MESSAGE =
  "抱歉，本产品定位是帮助玩家「自己进步」：只提供基于本人战斗日志的复盘与练习建议，" +
  "不提供也不讨论代练、账号交易、陪玩、现金交易等服务。如有其他问题，欢迎继续提问。";
