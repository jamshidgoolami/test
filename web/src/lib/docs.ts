import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { DocDocument, DocHeading } from './types';

/**
 * ابزارهای کتابخانهٔ مستندات
 * ----------------------------------------------------------------
 * • لینک‌های `.md` داخل مستندات را به مسیر SPA تبدیل می‌کند تا هیچ لینکی
 *   صفحهٔ ۴۰۴ نگیرد.
 * • عنوان‌ها را با شناسه‌های پایدار (همان شناسه‌هایی که API می‌فرستد) علامت
 *   می‌زند تا فهرست کنار صفحه و لینک‌های لنگر کار کنند.
 * • جست‌وجو روی متن فارسی و انگلیسی، بدون حساسیت به ی/ک عربی انجام می‌شود.
 */

export interface RenderedDoc {
  html: string;
  headings: DocHeading[];
}

export interface DocSearchHit {
  doc: DocDocument;
  heading?: DocHeading;
  excerpt: string;
  score: number;
}

export function normalizeSearch(value: string): string {
  return String(value)
    .toLocaleLowerCase('fa')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyHeading(value: string): string {
  return String(value)
    .toLocaleLowerCase('fa')
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripMarkdown(value: string): string {
  return String(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[>#*+-]+\s*/gm, ' ')
    .replace(/[|*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePath(parts: string[]): string {
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

export interface ResolvedDocLink {
  href: string;
  doc: DocDocument;
  hash: string;
}

/**
 * یک لینک Markdown را نسبت به سند جاری حل می‌کند.
 * فقط لینک‌های `.md` که به یکی از سندهای کتابخانه برسند تبدیل می‌شوند؛
 * لینک‌های خارجی و فایل‌های ناشناخته دست‌نخورده می‌مانند.
 */
export function resolveDocLink(href: string, currentId: string, docs: DocDocument[]): ResolvedDocLink | null {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || /^(https?:|mailto:|tel:|data:|\/\/)/i.test(raw)) return null;
  const [beforeHash, ...hashParts] = raw.split('#');
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  const [beforeQuery] = beforeHash.split('?');
  if (!/\.md$/i.test(beforeQuery)) return null;
  const currentDir = currentId.split('/').slice(0, -1);
  const targetFile = beforeQuery.replace(/^\.\//, '');
  const targetPath = normalizePath([...currentDir, ...targetFile.split('/')]);
  const targetId = targetPath.replace(/\.md$/i, '') + '.md';
  const doc = docs.find((item) => item.id === targetId);
  if (!doc) return null;
  return { href: `/docs/${doc.slug}${hash}`, doc, hash };
}

function headingId(heading: DocHeading, index: number, used: Map<string, number>): string {
  const base = heading.id || slugifyHeading(heading.text) || `section-${index + 1}`;
  const count = (used.get(base) || 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/**
 * Markdown را به HTML امن تبدیل می‌کند و لینک‌های داخلی، شناسهٔ عنوان‌ها و
 * جدول‌های قابل اسکرول را آماده می‌کند. HTML خام مستندات پیش از درج پاک‌سازی
 * می‌شود؛ محتوای محلی هم مرز اعتماد جداگانه ندارد.
 */
export function renderMarkdown(markdown: string, doc: DocDocument, docs: DocDocument[]): RenderedDoc {
  // `async: false` نوع خروجی را رشته می‌کند؛ marked همیشه متن را escape نمی‌کند،
  // بنابراین خروجی پیش از درج در DOM از DOMPurify عبور می‌کند.
  const parsed = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string;
  const safe = DOMPurify.sanitize(parsed, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  const documentNode = new DOMParser().parseFromString(`<div id="docs-render-root">${safe}</div>`, 'text/html');
  const root = documentNode.getElementById('docs-render-root');
  if (!root) return { html: '', headings: [] };

  const headings: DocHeading[] = [];
  const used = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('h2, h3').forEach((element, index) => {
    const source = doc.headings[index];
    const text = (element.textContent || '').trim();
    const level = element.tagName === 'H2' ? 2 : 3;
    const id = headingId(source ?? { id: '', text, level }, index, used);
    element.id = id;
    headings.push({ id, text: text || source?.text || id, level });
    const anchor = documentNode.createElement('a');
    anchor.className = 'docs-heading-anchor';
    anchor.href = `#${id}`;
    anchor.setAttribute('aria-hidden', 'true');
    anchor.tabIndex = -1;
    anchor.textContent = '#';
    element.appendChild(anchor);
  });

  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') || '';
    const target = resolveDocLink(href, doc.id, docs);
    if (target) {
      anchor.href = target.href;
      anchor.dataset.docLink = target.doc.slug;
    } else if (/^https?:/i.test(href)) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  });

  root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    if (table.parentElement?.classList.contains('docs-table-wrap')) return;
    const wrap = documentNode.createElement('div');
    wrap.className = 'docs-table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });

  return { html: root.innerHTML, headings };
}

function excerptAround(text: string, terms: string[]): string {
  const normalized = normalizeSearch(text);
  let index = -1;
  for (const term of terms) {
    const found = normalized.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return text.slice(0, 180);
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + 140);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * جست‌وجوی ساده اما فارسی‌فهم. عنوان بیشترین وزن را دارد، سپس زیرعنوان و متن.
 * عبارت‌های چندکلمه‌ای باید همه در سند باشند.
 */
export function searchDocs(docs: DocDocument[], query: string): DocSearchHit[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(' ').filter(Boolean);
  const hits: DocSearchHit[] = [];
  for (const doc of docs) {
    const title = normalizeSearch(doc.title);
    const summary = normalizeSearch(doc.summary);
    // کدها هم بخشی از مستندات‌اند؛ بنابراین جست‌وجو روی متن خام انجام می‌شود
    // و فقط نمایش excerpt از Markdown پاک‌سازی می‌شود.
    const content = normalizeSearch(doc.content);
    const searchable = `${title} ${summary} ${normalizeSearch(doc.headings.map((h) => h.text).join(' '))} ${content}`;
    if (!terms.every((term) => searchable.includes(term))) continue;
    const heading = doc.headings.find((item) => terms.every((term) => normalizeSearch(item.text).includes(term)));
    let score = 0;
    if (terms.every((term) => title.includes(term))) score += 100;
    if (heading) score += 45;
    if (terms.every((term) => summary.includes(term))) score += 15;
    score += terms.reduce((sum, term) => sum + Math.min(20, content.split(term).length - 1), 0);
    hits.push({
      doc,
      heading,
      excerpt: heading ? heading.text : excerptAround(stripMarkdown(doc.content), terms),
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, 'fa')).slice(0, 30);
}

export function highlightText(text: string, query: string): Array<{ text: string; match: boolean }> {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text, match: false }];
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu');
  const parts = text.split(matcher).filter((part) => part !== '');
  return parts.map((part, index) => ({ text: part, match: index % 2 === 1 }));
}

export function docHref(doc: DocDocument, heading?: DocHeading): string {
  return `/docs/${doc.slug}${heading ? `#${heading.id}` : ''}`;
}


// برای اطمینان از escape نشدن نام فایل‌ها در آینده، این تابع کوچک صادر می‌شود.
export { escapeHtml };
