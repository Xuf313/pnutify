import type { Metadata, Viewport } from "next";
import "./globals.css";

const description =
  "Your department's notices and International notices in one place, deadline reminders and a daily briefing — made by a PNU student for PNU students. No PLATO password needed.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.pnutify.app"),
  title: { default: "PNUtify", template: "%s · PNUtify" },
  description,
  applicationName: "PNUtify",
  keywords: ["Pusan National University", "PNU", "부산대", "department notices", "international students", "deadlines"],
  appleWebApp: { capable: true, title: "PNUtify", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    title: "PNUtify — PNU notices, deadlines & daily briefing",
    description,
    url: "/",
    siteName: "PNUtify",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "PNUtify" }],
    type: "website",
  },
  twitter: { card: "summary", title: "PNUtify", description, images: ["/icon-512.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The default theme's page background; page.tsx updates it when the theme changes.
  themeColor: "#EEF3FD",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
