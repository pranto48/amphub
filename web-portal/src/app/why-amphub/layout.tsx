import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why AMPHub — Features Comparison and TCO Cost Calculator",
  description: "Calculate your annual licensing cost savings by switching from TeamViewer, AnyDesk, and Splashtop to self-hosted AMPHub.",
};

export default function WhyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
