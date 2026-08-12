import type { Metadata } from "next";
import "./globals.css";
import "./realistic-forklift-final.css";

export const metadata: Metadata = {
  title: "포스코퓨처엠 지게차 디지털 트윈 및 실시간 시뮬레이션",
  description: "포스코퓨처엠 현장 지게차 실시간 모니터링 대시보드",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
