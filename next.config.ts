import type { NextConfig } from "next";

/**
 * API 路由安全头（L-1）：proxy.ts 的 matcher 排除了 /api 前缀，
 * 故在此为 /api/:path* 单独下发安全头。仅含不破坏 SSE 的头
 * （nosniff / 防点击劫持 / 引用策略 / 权限策略，不覆盖 Cache-Control）。
 */
const apiSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: apiSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
