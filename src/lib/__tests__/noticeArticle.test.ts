import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArticle, sanitizeArticleHtml } from '../noticeArticle';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
const BASE = 'https://cse.pusan.ac.kr/bbs/cse/2055/1474371/artclView.do';

describe('sanitizeArticleHtml', () => {
  it('drops scripts, event handlers, styles and dangerous links', () => {
    const out = sanitizeArticleHtml(
      `<p onclick="steal()" style="color:red">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a>
       <img src="x" onerror="alert(1)"><a href="data:text/html,<b>">d</a><iframe src="https://evil"></iframe>
       <style>p{}</style><svg onload="alert(1)"></svg><form><input value="pw"></form></p>`,
      BASE,
    );
    expect(out).not.toMatch(/script|onclick|onerror|onload|style=|javascript:|data:|iframe|svg|<form|<input|alert/i);
    expect(out).toContain('<p>Hi');
  });

  it('keeps structure and makes links and images absolute and safe', () => {
    const out = sanitizeArticleHtml(
      `<div><span style="font-weight: bold">Deadline</span> <b>Nov 24</b><br><a href="/bbs/x.do">form</a>
       <img src="/img/a.png" alt="poster"><table><tr><td colspan="2" width="99">A</td></tr></table></div>`,
      BASE,
    );
    expect(out).toContain('<strong>Deadline Nov 24</strong>');
    expect(out).toContain('<a href="https://cse.pusan.ac.kr/bbs/x.do" target="_blank" rel="noopener noreferrer">form</a>');
    expect(out).toContain('<img src="https://cse.pusan.ac.kr/img/a.png" alt="poster" loading="lazy">');
    expect(out).toContain('<td colspan="2">A</td>');
    expect(out).not.toContain('width');
  });

  it('escapes text so it can never become markup', () => {
    expect(sanitizeArticleHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt; 1 &lt; 2</p>', BASE)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; 1 &lt; 2</p>');
  });

  it('removes empty paragraphs and editor spacing', () => {
    expect(sanitizeArticleHtml('<p>&nbsp;</p><p><br></p><p>Text</p><br><br><br><br>', BASE)).toBe('<p>Text</p><br><br>');
  });
});

describe('parseArticle on real pages', () => {
  it('reads the CSE notice with its attachment', () => {
    const a = parseArticle(fixture('cse-article'), BASE);
    expect(a.title).toBe('[장학] 2027.1학기 국가장학금 1차 필수 신청 안내(11/24~1/7)');
    expect(a.date).toBe('2026.11.19');
    expect(a.author).toBe('정*랑');
    expect(a.html).toContain('<strong>2027년 1학기 국가장학금 1차 신청 일정</strong>');
    expect(a.html).not.toMatch(/style=|class=/);
    expect(a.attachments).toEqual([{ name: '붙임2. 2027년 지방 국립대학 전액 장학금 안내.pdf', url: 'https://cse.pusan.ac.kr/bbs/cse/2055/1543954/download.do' }]);
  });

  it('reads the International notice with its table and no attachments', () => {
    const a = parseArticle(fixture('intl-article'), 'https://international.pusan.ac.kr/bbs/international/2081/1474438/artclView.do');
    expect(a.html).toContain('<table>');
    expect(a.html).toContain('Important Notes');
    expect(a.attachments).toEqual([]);
  });
});
