import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocDocument } from '../src/lib/types.ts';
import { highlightText, resolveDocLink, searchDocs, slugifyHeading } from '../src/lib/docs.ts';

const docs: DocDocument[] = [
  {
    id: 'fa/dev-course/README.md',
    slug: 'dev-course',
    group: 'course',
    title: 'دورهٔ توسعه',
    summary: 'مسیر یادگیری',
    content: '# دورهٔ توسعه\n\n## نقشهٔ فصل‌ها\n\n[فصل اول](01-setup.md)',
    headings: [{ id: 'نقشه-فصل-ها', text: 'نقشهٔ فصل‌ها', level: 2 }],
    words: 20,
    readingMinutes: 1,
  },
  {
    id: 'fa/dev-course/01-setup.md',
    slug: 'dev-course/01-setup',
    group: 'course',
    title: 'راه‌اندازی',
    summary: 'نصب و اجرا',
    content: '# راه‌اندازی\n\n## نصب\n\n`npm ci` را اجرا کنید.',
    headings: [{ id: 'نصب', text: 'نصب', level: 2 }],
    words: 10,
    readingMinutes: 1,
  },
  {
    id: 'fa/02-architecture.md',
    slug: '02-architecture',
    group: 'guides',
    title: 'معماری',
    summary: 'لایه‌ها و جریان درخواست',
    content: '# معماری\n\n## لایه‌ها\n\nسرور و پایگاه‌داده.',
    headings: [{ id: 'لایه-ها', text: 'لایه‌ها', level: 2 }],
    words: 8,
    readingMinutes: 1,
  },
];

test('relative Markdown links resolve to the docs SPA route', () => {
  const sameDirectory = resolveDocLink('01-setup.md', 'fa/dev-course/README.md', docs);
  assert.equal(sameDirectory?.href, '/docs/dev-course/01-setup');
  const parentDirectory = resolveDocLink('../02-architecture.md', 'fa/dev-course/README.md', docs);
  assert.equal(parentDirectory?.href, '/docs/02-architecture');
  const missing = resolveDocLink('missing.md', 'fa/dev-course/README.md', docs);
  assert.equal(missing, null);
});

test('search finds Persian and English text and returns matching headings', () => {
  assert.equal(searchDocs(docs, 'نصب')[0]?.doc.title, 'راه‌اندازی');
  assert.equal(searchDocs(docs, 'npm ci')[0]?.doc.title, 'راه‌اندازی');
  assert.equal(searchDocs(docs, 'معماری')[0]?.doc.title, 'معماری');
  assert.equal(searchDocs(docs, 'پیوندی وجود ندارد').length, 0);
});

test('highlight keeps exact source text and marks the query', () => {
  const parts = highlightText('نصب و npm ci برای راه‌اندازی', 'npm');
  assert.equal(parts.map((part) => part.text).join(''), 'نصب و npm ci برای راه‌اندازی');
  assert.ok(parts.some((part) => part.match && part.text === 'npm'));
});

test('heading slug is stable for Persian and mixed headings', () => {
  assert.equal(slugifyHeading('۱. نصب و راه‌اندازی'), '۱-نصب-و-راه-اندازی');
  assert.equal(slugifyHeading('Backend / API'), 'backend-api');
});
