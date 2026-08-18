import type { Metadata, Viewport } from "next";
import Link from "next/link";
import TopBar from "@/components/TopBar";
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
      <body>
        <div className="container">
          <TopBar />
          {children}
        </div>
        <div className="container">
          <footer className="footer-note">
            非暴雪官方产品，与暴雪娱乐无关。本项目仅用于个人学习与分析，不销售任何游戏内容。
            <br />
            <Link href="/legal/privacy">隐私政策</Link> ·{" "}
            <Link href="/legal/terms">用户协议</Link> ·{" "}
            <Link href="/legal/disclaimer">免责声明</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
