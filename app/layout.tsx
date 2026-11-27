import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "课表毒舌评价师 · Schedule Roast Master",
  description: "上传大学课表，让 AI 看看你的学期究竟有多难熬。",
  applicationName: "Schedule Roast Master",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
