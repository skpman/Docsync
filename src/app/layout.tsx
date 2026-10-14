import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocSync",
  description: "Offline-first collaborative documents",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
