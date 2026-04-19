import { Apple, Monitor, Terminal } from "lucide-react";

export function OsIcon({ os, className }: { os: string; className?: string }) {
  if (os === "macos") return <Apple className={className} />;
  if (os === "linux") return <Terminal className={className} />;
  return <Monitor className={className} />;
}
