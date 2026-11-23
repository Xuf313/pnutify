"use client";

import { useEffect, useState } from "react";
import { CheckCheck, ExternalLink, Paperclip, Share2 } from "lucide-react";
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

type Article = { title: string | null; html: string; attachments: { name: string; url: string }[]; author: string | null; date: string | null };
type Detail = { id: string; ok: true; article: Article } | { id: string; ok: false };

export function NoticeSheet({ notice, pendingId, loading, isRead, onClose, onMarkRead }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);

  // Read the notice inside the app: the server fetches the article, keeps only safe markup, and caches it.
  useEffect(() => {
    if (!notice?.url) return;
    let cancelled = false;
    fetch(`/api/notices/notice-detail?url=${encodeURIComponent(notice.url)}&title=${encodeURIComponent(notice.title)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (typeof d?.html !== "string") throw new Error("no article");
        setDetail({ id: notice.id, ok: true, article: d as Article });
        onMarkRead([notice.id]);
      })
      .catch(() => {
        if (!cancelled) setDetail({ id: notice.id, ok: false });
      });
    return () => {
      cancelled = true;
    };
    // Only refetch when a different notice opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.id]);

  if (!pendingId) return null;

  if (!notice) {
    return (
      <Sheet open onClose={onClose} title={loading ? "Loading notice…" : "Notice not found"}>
        {!loading && <p className="text-sm text-muted-foreground">This notice is no longer on the board. It may have been removed or moved.</p>}
      </Sheet>
    );
  }

  const current = detail?.id === notice.id ? detail : null;
  const article = current?.ok ? current.article : null;
  const title = article?.title || notice.title;
  const site = SOURCE_LABEL[notice.source] ?? "school";

  const share = async () => {
    const data = { title, text: `${title} (${site} notice)`, url: notice.url };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(notice.url);
    } catch {}
  };

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Pill tone={notice.source === "cse" ? "secondary" : "primary"}>{site}</Pill>
        {notice.pinned && <Pill>Pinned</Pill>}
        <span className="text-sm font-semibold text-muted-foreground">
          Posted {article?.date ?? notice.date}
          {article?.author ? ` · ${article.author}` : ""}
        </span>
      </div>

      {/* ---------- the notice itself ---------- */}
      {!current ? (
        <div className="flex flex-col gap-2.5 mb-5" aria-busy="true" aria-label="Loading the notice">
          {[92, 100, 85, 96, 60].map((w, i) => (
            <span key={i} className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : article ? (
        <>
          {article.html ? (
            // Rebuilt on the server from a small set of safe tags (see src/lib/noticeArticle.ts).
            <div className="notice-body mb-5" dangerouslySetInnerHTML={{ __html: article.html }} />
          ) : (
            <p className="text-sm text-muted-foreground mb-5">This notice has no text. It may be an image or only attachments; open it on the {site} site to see it.</p>
          )}
          {article.attachments.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Attachments</p>
              <ul className="flex flex-col gap-1.5">
                {article.attachments.map((a) => (
                  <li key={a.url}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-sm font-semibold text-primary hover:underline">
                      <Paperclip size={15} className="shrink-0 mt-0.5" /> <span className="break-all">{a.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground mb-5">Couldn&apos;t load this notice here right now. You can still read it on the {site} site.</p>
      )}

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onMarkRead([notice.id], !isRead)} className="cozy-btn bg-card font-semibold py-2.5 text-sm flex items-center justify-center gap-1.5">
            <CheckCheck size={16} /> {isRead ? "Mark unread" : "Mark read"}
          </button>
          <button onClick={share} className="cozy-btn bg-card font-semibold py-2.5 text-sm flex items-center justify-center gap-1.5">
            <Share2 size={16} /> Share
          </button>
        </div>
        {notice.url && (
          <a
            href={notice.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onMarkRead([notice.id])}
            className="flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-muted-foreground hover:text-primary"
          >
            Open on the {site} site <ExternalLink size={14} />
          </a>
        )}
      </div>
    </Sheet>
  );
}
