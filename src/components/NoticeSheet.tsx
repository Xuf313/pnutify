"use client";

import { useEffect, useState } from "react";
import { CheckCheck, ExternalLink, Share2 } from "lucide-react";
import { Pill, Sheet } from "./ui";
import type { Notice } from "@/lib/client/types";
import { SOURCE_LABEL } from "@/lib/client/types";

type Props = {
  notice: Notice | null;
  /** Id from a notification link, possibly before the list has loaded. */
  pendingId: string | null;
  loading: boolean;
  isRead: boolean;
  onClose: () => void;
  onMarkRead: (ids: string[], value?: boolean) => void;
};

export function NoticeSheet({ notice, pendingId, loading, isRead, onClose, onMarkRead }: Props) {
  const [fullTitle, setFullTitle] = useState<{ id: string; title: string } | null>(null);

  // Board listings truncate long titles; fetch the full one from the article page.
  useEffect(() => {
    if (!notice?.url || !/[.…]$/.test(notice.title)) return;
    let cancelled = false;
    fetch(`/api/notices/notice-detail?url=${encodeURIComponent(notice.url)}&title=${encodeURIComponent(notice.title)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d.title === "string" && d.title) setFullTitle({ id: notice.id, title: d.title });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [notice]);

  if (!pendingId) return null;

  if (!notice) {
    return (
      <Sheet open onClose={onClose} title={loading ? "Loading notice…" : "Notice not found"}>
        {!loading && <p className="text-sm text-muted-foreground">This notice is no longer on the board. It may have been removed or moved.</p>}
      </Sheet>
    );
  }

  const title = fullTitle?.id === notice.id ? fullTitle.title : notice.title;
  const share = async () => {
    const data = { title, text: `${title} (${SOURCE_LABEL[notice.source]} notice)`, url: notice.url };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(notice.url);
    } catch {}
  };

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Pill tone={notice.source === "cse" ? "secondary" : "primary"}>{SOURCE_LABEL[notice.source]}</Pill>
        {notice.pinned && <Pill>Pinned</Pill>}
        <span className="text-sm font-bold text-muted-foreground">Posted {notice.date}</span>
      </div>
      <div className="flex flex-col gap-2">
        {notice.url && (
          <a
            href={notice.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onMarkRead([notice.id])}
            className="cozy-btn flex items-center justify-center gap-2 bg-primary text-primary-foreground font-bold py-3 text-sm"
          >
            Read on the {SOURCE_LABEL[notice.source]} site <ExternalLink size={16} />
          </a>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onMarkRead([notice.id], !isRead)} className="cozy-btn bg-card font-bold py-2.5 text-sm flex items-center justify-center gap-1.5">
            <CheckCheck size={16} /> {isRead ? "Mark unread" : "Mark read"}
          </button>
          <button onClick={share} className="cozy-btn bg-card font-bold py-2.5 text-sm flex items-center justify-center gap-1.5">
            <Share2 size={16} /> Share
          </button>
        </div>
      </div>
    </Sheet>
  );
}
