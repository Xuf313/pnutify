import * as cheerio from 'cheerio';
import { extractArticleTitle } from './scrapeNotices';

/** A notice as read inside the app. `html` is rebuilt from a small set of safe tags. */
export type NoticeArticle = {
  title: string | null;
  html: string;
  attachments: { name: string; url: string }[];
  author: string | null;
  date: string | null;
};

type AnyNode = { type: string; name?: string; data?: string; attribs?: Record<string, string>; children?: AnyNode[] };

const BLOCK_RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h4', h2: 'h4', h3: 'h4', h5: 'h4', h6: 'h4' };
const KEEP = new Set(['p', 'div', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'a', 'img', 'h4', 'blockquote', 'hr', 'sup', 'sub']);
/** Dropped together with everything inside them. */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'svg', 'math', 'video', 'audio', 'link', 'meta']);
const VOID = new Set(['br', 'img', 'hr']);
const MAX_HTML = 200_000;

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/** Absolute http(s) URL, or null for anything else (javascript:, data:, mailto: …). */
function safeUrl(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const isBold = (style = '') => /font-weight\s*:\s*(bold|[6-9]00)/i.test(style);

/**
 * Rebuilds article HTML from scratch: only the tags in KEEP survive, with no
 * attributes except checked href/src/alt/colspan/rowspan. Text is escaped.
 * Nothing from the source page is copied through as markup.
 */
export function sanitizeArticleHtml(html: string, baseUrl: string): string {
  const $ = cheerio.load(html, null, false);
  const walk = (nodes: AnyNode[]): string =>
    nodes
      .map((node) => {
        if (node.type === 'text') return escapeText(node.data ?? '');
        if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return '';
        const tag = (node.name ?? '').toLowerCase();
        if (DROP.has(tag)) return '';
        const inner = walk(node.children ?? []);
        const attrs = node.attribs ?? {};

        if (tag === 'span' || tag === 'font') return isBold(attrs.style) && inner.trim() ? `<strong>${inner}</strong>` : inner;
        const name = BLOCK_RENAME[tag] ?? tag;
        if (!KEEP.has(name)) return inner;

        if (name === 'a') {
          const href = safeUrl(attrs.href, baseUrl);
          return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
        }
        if (name === 'img') {
          const src = safeUrl(attrs.src, baseUrl);
          return src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(attrs.alt ?? '')}" loading="lazy">` : '';
        }
        if (name === 'td' || name === 'th') {
          const span = ['colspan', 'rowspan']
            .filter((k) => /^\d{1,2}$/.test(attrs[k] ?? ''))
            .map((k) => ` ${k}="${attrs[k]}"`)
            .join('');
          return `<${name}${span}>${inner}</${name}>`;
        }
        if (VOID.has(name)) return `<${name}>`;
        if (name === 'p' && isBold(attrs.style) && inner.trim()) return `<p><strong>${inner}</strong></p>`;
        return `<${name}>${inner}</${name}>`;
      })
      .join('');

  const out = walk($.root().contents().toArray() as unknown as AnyNode[])
    // The editor splits bold text into many pieces: <strong>20</strong><strong>27</strong>.
    .replace(/<\/strong>(\s?)<strong>/g, '$1')
    // Empty paragraphs and long runs of line breaks are spacing left over from the editor.
    .replace(/<p>(\s|&nbsp;| |<br>)*<\/p>/g, '')
    .replace(/(<br>\s*){3,}/g, '<br><br>')
    .replace(/ /g, ' ')
    .trim();
  return out.length > MAX_HTML ? `${out.slice(0, MAX_HTML)}…` : out;
}

/** Reads a K2Web article page (the CMS behind the PNU boards). */
export function parseArticle(html: string, pageUrl: string, listingTitle = ''): NoticeArticle {
  const $ = cheerio.load(html);
  // K2Web boards (CSE, International) use .board-view; the PNU board uses .board-view-cont.
  const view = $('.board-view, .board-view-cont').first().parent();
  const body = view.find('.board-view .txt, .board-view-contents #boardContents, .board-view-contents').first();

  const detail = (label: string) => {
    const li = view.find('.detail li').filter((_, el) => $(el).find('span').first().text().trim() === label).first();
    if (li.length) {
      const c = li.clone();
      c.find('span').first().remove();
      return c.text().replace(/\s+/g, '').trim() || null;
    }
    // PNU board: <span class="txt">작성일자 2026-11-18</span>
    // Match the whole first word: "작성일" must not match "작성일자".
    const txt = view.find('.vtitle-winfo .txt').filter((_, el) => $(el).text().trim().split(/\s+/)[0] === label).first().text();
    return txt ? txt.trim().slice(label.length).replace(/\s+/g, ' ').trim() || null : null;
  };

  const attachments = view
    .find('.attachment a, .board-view-filelist a')
    .toArray()
    .map((a) => ({ name: $(a).text().replace(/\s+/g, ' ').trim(), url: safeUrl($(a).attr('href'), pageUrl) }))
    .filter((x): x is { name: string; url: string } => Boolean(x.name && x.url && /download(Run)?\.do/.test(x.url)));

  return {
    title: extractArticleTitle(html, listingTitle),
    html: body.length ? sanitizeArticleHtml(body.html() ?? '', pageUrl) : '',
    attachments,
    author: detail('작성자'),
    date: detail('작성일') ?? detail('작성일자'),
  };
}
