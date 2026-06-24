import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download AMPHub Client — Signed MSI & NSIS Installers",
  description: "Download the signed native desktop clients for AMPHub remote desktop, verify SHA-256 cryptographic hashes, and configure automated support nodes.",
};

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
