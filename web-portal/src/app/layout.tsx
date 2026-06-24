import type { Metadata } from "next";
import Header from "./components/Header";
import Footer from "./components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://amphub.itsupport.com.bd"),
  title: {
    default: "AMPHub — Secure Self-Hosted Remote Desktop Solution",
    template: "%s | AMPHub"
  },
  description: "Switch from TeamViewer, AnyDesk, and Splashtop to AMPHub for a secure, fast, and reliable remote desktop experience using your own self-hosted signaling servers.",
  keywords: "remote desktop, open source, self-hosted, TeamViewer alternative, AnyDesk alternative, WebRTC remote desktop, secure remote support, IT Support BD, Arif Mahmud",
  authors: [
    { name: "Arif Mahmud", url: "https://www.arifmahmud.com" },
    { name: "IT Support BD", url: "https://itsupport.bd" }
  ],
  alternates: {
    canonical: "/"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://amphub.itsupport.com.bd",
    siteName: "AMPHub",
    title: "AMPHub — Secure Self-Hosted Remote Desktop Solution",
    description: "Switch from TeamViewer, AnyDesk, and Splashtop to AMPHub for a secure, fast, and reliable remote desktop experience using your own self-hosted signaling servers.",
    images: [
      {
        url: "/icon.svg",
        width: 512,
        height: 512,
        alt: "AMPHub Logo",
      }
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AMPHub — Secure Self-Hosted Remote Desktop Solution",
    description: "Switch from TeamViewer, AnyDesk, and Splashtop to AMPHub for a secure, fast, and reliable remote desktop experience using your own self-hosted signaling servers.",
    images: ["/icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased scroll-smooth">
      <body className="min-h-full flex flex-col bg-brand-dark text-slate-100 selection:bg-brand-cyan/30 selection:text-white">
        <Header />
        <main className="flex-grow pt-24 md:pt-28">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
