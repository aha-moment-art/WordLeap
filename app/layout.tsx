import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./theme.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aha-moment-art.github.io/WordLeap/"),
  title: "WordLeap - 四六级雅思托福背单词",
  description: "用词义选择和语境填空，高效掌握四六级、雅思和托福核心词汇。",
  openGraph: {
    title: "WordLeap - 每一个单词，都是向前的一步",
    description: "覆盖四级、六级、专四、专八、雅思、托福与 PTE 的自适应词汇练习。",
    type: "website",
    locale: "zh_CN",
    images: [
      {
        url: "https://aha-moment-art.github.io/WordLeap/og.png",
        width: 1731,
        height: 909,
        alt: "WordLeap 英语词汇学习网站",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WordLeap - 每一个单词，都是向前的一步",
    description: "自适应英语词汇练习：四级、六级、专四、专八、雅思、托福与 PTE。",
    images: ["https://aha-moment-art.github.io/WordLeap/og.png"],
  },
  icons: {
    icon: "/WordLeap/favicon.svg",
    shortcut: "/WordLeap/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
