import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavigationProgressHost } from "@/components/navigation-progress-host";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Dashboard - DROPX LOGISTICS",
    template: "Dashboard - %s - DROPX LOGISTICS"
  },
  description: "Delivery associate onboarding, Provider ID mapping, earnings, and payroll control",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <NavigationProgressHost />
        {children}
      </body>
    </html>
  );
}
