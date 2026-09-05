import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const alienRobot = localFont({
  src: "./fonts/alien-robot.ttf",
  variable: "--font-alien-robot",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Elysium — Booking",
  description: "Reserve your time at Elysium. Sound Recording Field & Creative Abyss.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${alienRobot.variable} min-h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
