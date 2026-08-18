import type { NextRequest } from "next/server";

/**
 * 取客户端真实 IP（L-5 加固）。
 *  - 优先 x-real-ip（某些代理/平台注入）。
 *  - 其次 x-forwarded-for 的"最右"值：平台（Vercel 等）会在转发链最右追加可信的
 *    直连 IP，最左值可由客户端伪造，故不再信任最左。
 */
export function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return "unknown";

  const parts = fwd
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}
