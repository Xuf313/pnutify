import { Globe, Landmark, Monitor } from "lucide-react";
import type { NoticeSource } from "@/lib/client/types";

/** The icon for a notice board. */
export function BoardIcon({ source, size = 16, className }: { source: NoticeSource | string; size?: number; className?: string }) {
  if (source === "cse") return <Monitor size={size} className={className} />;
  if (source === "international") return <Globe size={size} className={className} />;
  return <Landmark size={size} className={className} />;
}
