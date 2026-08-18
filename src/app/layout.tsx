import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WoW M+ AI 复盘教练",
    template: "%s · WoW M+ AI 复盘教练",
  },
  description:
    "上传大秘境战斗日志，AI 生成 6 章复盘报告：战术意图识别、可改进点清单、下一步练习建议，并支持针对本场 log 的对话问答。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
