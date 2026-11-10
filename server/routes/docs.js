/**
 * NetWatch — کتابخانهٔ مستندات درون‌برنامه‌ای
 * ----------------------------------------------------------------
 * محتوای Markdown از پوشهٔ docs خوانده می‌شود و همراه با فهرست فصل‌ها و
 * زیرعنوان‌ها به رابط کاربری برمی‌گردد. این مسیر پشت احراز هویت است و هیچ
 * مسیر یا نام فایلی از سمت کلاینت نمی‌گیرد؛ فهرست فایل‌ها همان فهرست ثابت
 * مستندات پروژه است.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS_ROOT = path.join(ROOT, 'docs');

const GROUPS = [
  {
    id: 'course',
    label: 'دورهٔ توسعهٔ NetWatch',
    description: 'از نصب و ابزارها تا موتور، امنیت، تست و استقرار',
    directories: ['fa/dev-course'],
    files: [],
  },
  {
    id: 'guides',
    label: 'راهنمای مرجع',
    description: 'مستندات کاربری، عملیاتی و فنی نسخهٔ جاری',
    directories: ['fa'],
    files: [],
  },
  {
    id: 'reports',
    label: 'گزارش‌های پروژه',
    description: 'نتیجهٔ راستی‌آزمایی، عملکرد و تغییرات نسخه',
    directories: [],
    files: ['verification-report.md', 'performance-report.md', 'changelog.md'],
  },
];

function listMarkdownFiles(relativeDir) {
  const dir = path.join(DOCS_ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(relativeDir, entry.name))
    .sort((a, b) => {
      const aName = path.basename(a);
      const bName = path.basename(b);
      if (aName === 'README.md') return -1;
      if (bName === 'README.md') return 1;
      return aName.localeCompare(bName, 'fa');
    });
}

function stripInlineMarkdown(value) {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainText(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[>#*+-]+\s*/gm, ' ')
    .replace(/[|*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value)
    .toLocaleLowerCase('fa')
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function visibleLines(markdown) {
  const lines = [];
  let fenced = false;
  let fenceMarker = '';
  for (const line of String(markdown).split(/\r?\n/)) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!fenced) {
        fenced = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        fenced = false;
      }
      continue;
    }
    if (!fenced) lines.push(line);
  }
  return lines;
}

function extractTitle(markdown, fallback) {
  const heading = visibleLines(markdown).find((line) => /^#\s+/.test(line));
  return heading ? stripInlineMarkdown(heading.replace(/^#\s+/, '')) : fallback;
}

function extractSummary(markdown) {
  const lines = visibleLines(markdown);
  const start = lines.findIndex((line) => /^>\s?/.test(line));
  if (start >= 0) {
    const quote = [];
    for (let i = start; i < lines.length && /^>\s?/.test(lines[i]); i += 1) {
      quote.push(lines[i].replace(/^>\s?/, ''));
    }
    const summary = stripInlineMarkdown(quote.join(' '));
    if (summary) return summary.slice(0, 260);
  }
  const paragraph = lines.find((line) => line.trim() && !/^#|^\s*[-*+]|^\s*\d+\.|^\|/.test(line));
  return paragraph ? stripInlineMarkdown(paragraph).slice(0, 260) : '';
}

function extractSections(markdown) {
  const sections = [];
  const used = new Map();
  for (const line of visibleLines(markdown)) {
    const match = line.match(/^(##|###)\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;
    const base = slugify(text);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    sections.push({ id: count === 1 ? base : `${base}-${count}`, text, level });
  }
  return sections;
}

function docSlug(id) {
  if (id === 'fa/README.md') return 'fa-overview';
  return id
    .replace(/^fa\//, '')
    .replace(/\.md$/, '')
    .replace(/\/README$/, '');
}

function readDoc(relativePath, groupId) {
  const fullPath = path.join(DOCS_ROOT, relativePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const fallback = path.basename(relativePath, '.md');
  const title = extractTitle(content, fallback);
  const headings = extractSections(content);
  const words = plainText(content).split(/\s+/).filter(Boolean).length;
  const id = relativePath.split(path.sep).join('/');
  return {
    id,
    slug: docSlug(id),
    group: groupId,
    title,
    summary: extractSummary(content),
    content,
    headings,
    words,
    readingMinutes: Math.max(1, Math.round(words / 200)),
  };
}

export function buildDocsLibrary() {
  const docs = [];
  const groups = [];
  for (const group of GROUPS) {
    const relativePaths = [
      ...group.files,
      ...group.directories.flatMap((dir) => listMarkdownFiles(dir)),
    ];
    const seen = new Set();
    const items = [];
    for (const relativePath of relativePaths) {
      const normalized = relativePath.split(path.sep).join('/');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const fullPath = path.join(DOCS_ROOT, relativePath);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const doc = readDoc(relativePath, group.id);
        docs.push(doc);
        items.push(doc.id);
      } catch {
        // یک فایل ناخوانا نباید کل کتابخانه را از کار بیندازد.
      }
    }
    groups.push({
      id: group.id,
      label: group.label,
      description: group.description,
      docIds: items,
    });
  }
  return {
    version: 1,
    generatedAt: Date.now(),
    groups,
    docs,
  };
}

router.get('/', (_req, res) => {
  const library = buildDocsLibrary();
  // محتوای مستندات حساس نیست، اما فقط برای نشست معتبر و بدون کش مشترک است.
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json(library);
});

export default router;
