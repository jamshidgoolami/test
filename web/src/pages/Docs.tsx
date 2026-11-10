import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileBarChart,
  FileText,
  LibraryBig,
  ListTree,
  Menu,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/store';
import { APP_VERSION } from '../lib/version';
import type { DocDocument, DocGroup, DocHeading } from '../lib/types';
import {
  docHref,
  escapeHtml,
  highlightText,
  renderMarkdown,
  searchDocs,
} from '../lib/docs';

const GROUP_ICONS: Record<DocGroup['id'], React.ReactNode> = {
  course: <BookOpen size={15} />,
  guides: <LibraryBig size={15} />,
  reports: <FileBarChart size={15} />,
};

function routeSlug(pathname: string): string {
  try {
    return decodeURIComponent(pathname.replace(/^\/docs\/?/, '').replace(/\/+$/, '')) || 'dev-course';
  } catch {
    return 'dev-course';
  }
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightText(text, query).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>
      )}
    </>
  );
}

export default function Docs() {
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [navOpen, setNavOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState('');
  const { data, loading, error, refresh } = useAsync((signal) => api.docs(signal), []);

  const docs = data?.docs ?? [];
  const activeSlug = routeSlug(location.pathname);
  const docsById = useMemo(() => new Map(docs.map((doc) => [doc.id, doc])), [docs]);
  const docsBySlug = useMemo(() => new Map(docs.map((doc) => [doc.slug, doc])), [docs]);
  const activeDoc = docsBySlug.get(activeSlug);
  const activeGroup = data?.groups.find((group) => group.docIds.includes(activeDoc?.id ?? ''));

  const rendered = useMemo(
    () => (activeDoc ? renderMarkdown(activeDoc.content, activeDoc, docs) : { html: '', headings: [] }),
    [activeDoc, docs]
  );
  const searchHits = useMemo(() => searchDocs(docs, query), [docs, query]);

  useEffect(() => {
    if (!activeDoc) return;
    setExpanded((previous) => {
      if (previous.has(activeDoc.id)) return previous;
      const next = new Set(previous);
      next.add(activeDoc.id);
      return next;
    });
  }, [activeDoc]);

  // تزئین کدها، تبدیل بلوک‌های Mermaid و مدیریت لینک‌های داخلی پس از درج HTML.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !activeDoc) return;
    let cancelled = false;

    const mermaidBlocks = Array.from(root.querySelectorAll<HTMLElement>('code.language-mermaid'));
    mermaidBlocks.forEach((code, index) => {
      const pre = code.closest('pre');
      if (!pre) return;
      const source = code.textContent || '';
      const holder = document.createElement('div');
      holder.className = 'docs-mermaid';
      holder.setAttribute('dir', 'ltr');
      holder.innerHTML = '<div class="docs-mermaid-loading">در حال رسم نمودار…</div>';
      pre.replaceWith(holder);
      const renderId = `docs-mermaid-${activeDoc.slug.replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}-${Date.now()}`;
      void import('mermaid')
        .then(async ({ default: mermaid }) => {
          if (cancelled) return;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            fontFamily: 'Vazirmatn, Tahoma, sans-serif',
            themeVariables: {
              fontFamily: 'Vazirmatn, Tahoma, sans-serif',
              primaryColor: '#eff6ff',
              primaryTextColor: '#0f172a',
              primaryBorderColor: '#93c5fd',
              lineColor: '#64748b',
              secondaryColor: '#f8fafc',
              tertiaryColor: '#ffffff',
            },
          });
          const { svg } = await mermaid.render(renderId, source);
          if (!cancelled) holder.innerHTML = svg;
        })
        .catch(() => {
          if (cancelled) return;
          holder.innerHTML = `<div class="docs-mermaid-error"><strong>نمایش نمودار ممکن نشد.</strong><details><summary>متن Mermaid</summary><pre><code>${escapeHtml(
            source
          )}</code></pre></details></div>`;
        });
    });

    root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      if (pre.closest('.docs-code') || pre.parentElement?.classList.contains('docs-mermaid')) return;
      const code = pre.querySelector('code');
      if (!code || code.classList.contains('language-mermaid')) return;
      const language = Array.from(code.classList)
        .find((name) => name.startsWith('language-'))
        ?.replace('language-', '') || 'code';
      const wrapper = document.createElement('div');
      wrapper.className = 'docs-code';
      const head = document.createElement('div');
      head.className = 'docs-code-head';
      const label = document.createElement('span');
      label.className = 'docs-code-lang';
      label.textContent = language;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'docs-copy';
      copy.dataset.copyCode = 'true';
      copy.textContent = 'کپی';
      head.append(label, copy);
      pre.replaceWith(wrapper);
      wrapper.append(head, pre);
    });

    const scrollTimer = window.setTimeout(() => {
      const id = decodeURIComponent(location.hash.replace(/^#/, '') || '');
      const target = id ? document.getElementById(id) : null;
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(scrollTimer);
    };
  }, [activeDoc, rendered.html, location.hash]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h2[id], h3[id]'));
    if (!headings.length) {
      setActiveHeading('');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: '-110px 0px -60% 0px', threshold: [0, 1] }
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [rendered.html, activeDoc?.id]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goDoc = (doc: DocDocument, heading?: DocHeading) => {
    setNavOpen(false);
    navigate(docHref(doc, heading));
  };

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (copy) {
      const code = copy.closest('.docs-code')?.querySelector('code');
      if (!code) return;
      // بازخورد فوری، مستقل از اینکه Clipboard API مجوز بدهد یا نه.
      copy.textContent = 'کپی شد';
      copy.classList.add('is-copied');
      window.setTimeout(() => {
        copy.textContent = 'کپی';
        copy.classList.remove('is-copied');
      }, 1600);
      const area = document.createElement('textarea');
      area.value = code.textContent || '';
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } catch {
        // اگر مرورگر اجازهٔ کپی نداد، متن دکمه دست‌کم بازخورد عملیات را می‌دهد.
      } finally {
        area.remove();
      }
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('/docs/')) {
      event.preventDefault();
      setNavOpen(false);
      navigate(href);
    }
  };

  const toggleDoc = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && !data) return <div className="docs-loading"><div className="docs-loading-dot" />در حال آماده‌سازی کتابخانهٔ مستندات…</div>;

  if (error && !data) {
    return (
      <div className="docs-loading docs-loading-error">
        <p>{error}</p>
        <button type="button" className="btn-soft btn-xs" onClick={() => void refresh()}>
          تلاش دوباره
        </button>
      </div>
    );
  }

  if (!activeDoc) {
    return (
      <div className="docs-loading">
        <p>این سند پیدا نشد یا هنوز در کتابخانه ثبت نشده است.</p>
        <button type="button" className="btn-soft btn-xs" onClick={() => navigate('/docs')}>
          بازگشت به فهرست مستندات
        </button>
      </div>
    );
  }

  const groupDocs: DocDocument[] = activeGroup
    ? (activeGroup.docIds.map((id) => docsById.get(id)).filter(Boolean) as DocDocument[])
    : [];
  const currentIndex = groupDocs.findIndex((doc) => doc.id === activeDoc.id);
  const previousDoc = currentIndex > 0 ? groupDocs[currentIndex - 1] : undefined;
  const nextDoc = currentIndex >= 0 && currentIndex < groupDocs.length - 1 ? groupDocs[currentIndex + 1] : undefined;

  return (
    <div className="docs-shell">
      {navOpen ? <button type="button" className="docs-scrim" aria-label="بستن فهرست" onClick={() => setNavOpen(false)} /> : null}
      <aside className={`docs-sidebar ${navOpen ? 'is-open' : ''}`} aria-label="فهرست مستندات">
        <div className="docs-sidebar-head">
          <div className="flex items-center gap-2">
            <span className="docs-brand-icon"><BookOpen size={17} /></span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-ink-800">کتابخانهٔ دانش</p>
              <p className="text-[10.5px] text-ink-400">NetWatch · نسخهٔ {APP_VERSION}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost btn-xs docs-nav-close" onClick={() => setNavOpen(false)} aria-label="بستن فهرست">
            <X size={15} />
          </button>
        </div>

        <label className="docs-search">
          <Search size={15} className="shrink-0 text-ink-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجو در مستندات…"
            aria-label="جست‌وجو در مستندات"
          />
          <kbd>/</kbd>
        </label>

        <div className="docs-nav-scroll">
          {query.trim() ? (
            <div className="docs-search-results">
              <div className="docs-search-caption">
                {searchHits.length ? `${searchHits.length} نتیجه برای «${query.trim()}»` : 'نتیجه‌ای پیدا نشد'}
              </div>
              {searchHits.map((hit) => (
                <button key={`${hit.doc.id}-${hit.heading?.id ?? ''}`} type="button" className="docs-result" onClick={() => goDoc(hit.doc, hit.heading)}>
                  <span className="docs-result-title">
                    <FileText size={13} /> {hit.doc.title}
                  </span>
                  <span className="docs-result-excerpt">
                    <Highlighted text={hit.excerpt} query={query} />
                  </span>
                  {hit.heading ? <span className="docs-result-section">{hit.heading.text}</span> : null}
                </button>
              ))}
              {searchHits.length ? <p className="docs-search-hint">برای دیدن همهٔ فصل‌ها جست‌وجو را پاک کنید.</p> : null}
            </div>
          ) : (
            <nav className="docs-groups">
              {(data?.groups ?? []).map((group) => {
                const groupItems = group.docIds.map((id) => docsById.get(id)).filter(Boolean) as DocDocument[];
                if (!groupItems.length) return null;
                return (
                  <section key={group.id} className="docs-group">
                    <div className="docs-group-head">
                      <span className="docs-group-icon">{GROUP_ICONS[group.id]}</span>
                      <div className="min-w-0">
                        <p className="docs-group-title">{group.label}</p>
                        <p className="docs-group-desc">{group.description}</p>
                      </div>
                    </div>
                    <div className="docs-group-items">
                      {groupItems.map((doc) => {
                        const isActive = doc.slug === activeDoc.slug;
                        const isOpen = expanded.has(doc.id);
                        return (
                          <div key={doc.id} className={`docs-nav-doc ${isActive ? 'is-active' : ''}`}>
                            <div className="docs-doc-row">
                              <button type="button" className="docs-doc-link" onClick={() => goDoc(doc)} title={doc.title}>
                                <FileText size={13} />
                                <span>{doc.title}</span>
                              </button>
                              {doc.headings.length ? (
                                <button
                                  type="button"
                                  className="docs-doc-toggle"
                                  onClick={() => toggleDoc(doc.id)}
                                  aria-label={isOpen ? 'بستن زیربخش‌ها' : 'نمایش زیربخش‌ها'}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? <ChevronDown size={13} /> : <ChevronLeft size={13} />}
                                </button>
                              ) : null}
                            </div>
                            {isOpen ? (
                              <div className="docs-subitems">
                                {doc.headings.map((heading) => (
                                  <a
                                    key={heading.id}
                                    href={docHref(doc, heading)}
                                    className={`docs-subitem ${heading.level === 3 ? 'is-sub' : ''} ${
                                      isActive && activeHeading === heading.id ? 'is-current' : ''
                                    }`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      goDoc(doc, heading);
                                    }}
                                  >
                                    {heading.text}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </nav>
          )}
        </div>
        <div className="docs-sidebar-foot">
          <Link to="/settings" className="docs-foot-link">
            <Settings2 size={14} /> تنظیمات برنامه
          </Link>
          <span className="docs-foot-note">مستندات آفلاین، همراه همیشه</span>
        </div>
      </aside>

      <article className="docs-article" id="docs-content">
        <div className="docs-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="btn-ghost btn-xs docs-nav-open" onClick={() => setNavOpen(true)} aria-label="نمایش فهرست مستندات">
              <Menu size={16} />
            </button>
            <div className="min-w-0">
              <div className="docs-breadcrumb">
                <Link to="/docs">مستندات</Link>
                <span aria-hidden>/</span>
                <span>{activeGroup?.label ?? 'کتابخانه'}</span>
              </div>
              <h1 className="docs-title">{activeDoc.title}</h1>
            </div>
          </div>
          <div className="docs-top-actions">
            <span className="chip docs-version-chip">v{APP_VERSION}</span>
            <Link to="/settings" className="btn-soft btn-xs">
              <Settings2 size={14} /> تنظیمات
            </Link>
          </div>
        </div>

        <div className="docs-meta">
          <span><Clock3 size={13} /> {activeDoc.readingMinutes} دقیقه مطالعه</span>
          <span><ListTree size={13} /> {activeDoc.headings.length} زیربخش</span>
          <span className="docs-file-path" dir="ltr">{activeDoc.id}</span>
        </div>

        <div
          ref={contentRef}
          className="docs-content"
          dir="rtl"
          onClick={handleContentClick}
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />

        <footer className="docs-pager">
          {previousDoc ? (
            <button type="button" className="docs-pager-link" onClick={() => goDoc(previousDoc)}>
              <span className="docs-pager-label"><ArrowRight size={14} /> سند قبلی</span>
              <span className="docs-pager-title">{previousDoc.title}</span>
            </button>
          ) : <span />}
          {nextDoc ? (
            <button type="button" className="docs-pager-link is-next" onClick={() => goDoc(nextDoc)}>
              <span className="docs-pager-label">سند بعدی <ArrowLeft size={14} /></span>
              <span className="docs-pager-title">{nextDoc.title}</span>
            </button>
          ) : <span />}
        </footer>

        <div className="docs-back-top">
          <a href="#docs-content" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <ChevronLeft size={14} /> بازگشت به بالای صفحه
          </a>
        </div>
      </article>

      <aside className="docs-toc" aria-label="فهرست این صفحه">
        <div className="docs-toc-inner">
          <p className="docs-toc-title"><ListTree size={14} /> در این صفحه</p>
          {rendered.headings.length ? (
            <nav>
              {rendered.headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={`docs-toc-link ${heading.level === 3 ? 'is-sub' : ''} ${activeHeading === heading.id ? 'is-current' : ''}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(heading.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    setActiveHeading(heading.id);
                    window.history.replaceState(null, '', `#${heading.id}`);
                  }}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          ) : (
            <p className="text-[11px] text-ink-400">این سند زیرعنوان ندارد.</p>
          )}
          <div className="docs-toc-rule" />
          <p className="docs-toc-note">برای جست‌وجوی سریع در همهٔ فصل‌ها کلید <kbd>/</kbd> را بزنید.</p>
        </div>
      </aside>
    </div>
  );
}
