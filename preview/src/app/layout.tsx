import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "双链笔记名",
  description: "在对话框输入 [[ 时提示笔记名称",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`dark ${geist.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
