import { NextRequest, NextResponse } from "next/server";
import { createAuthProvider } from "@/lib/auth/provider";

export const maxDuration = 30;

/** POST /api/auth/logout —— 登出并清除会话。 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean }>({ ok: true });
  const auth = createAuthProvider(req, res);
  await auth.signOut();
  return res;
}
