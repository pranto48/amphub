import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact AMPHub Support & Enterprise Deployment Consultations",
  description: "Send inquiries to the AMPHub open-source maintainers and IT Support BD system administration experts regarding self-hosted Traversal setups.",
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
