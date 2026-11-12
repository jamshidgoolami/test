import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { db, getSettings, log, transaction } from '../db.js';
import { routePermission } from '../permissions.js';
import {
  attachmentMaxBytes,
  attachmentPath,
  detectFileType,
  removeAttachmentFile,
  safeDisplayName,
  stageAttachmentRemoval,
  writeAttachmentFile,
} from '../attachments.js';
import {
  DESCRIPTION_MAX,
  DiagramError,
  NAME_MAX,
  descendantIds,
  getRow,
  isSelfOrDescendant,
  normalizeGraph,
  normalizeParent,
  nowMs,
  readGraph,
  serialize,
  serializeSummary,
  text,
} from '../services/diagram-graph.js';
import {
  cleanupDiagramReferences,
  createLink,
  deleteLink,
  graphPayload,
  pruneBrokenDiagramLinks,
  renameLinkLabels,
  syncReciprocalLinks,
  updateLink,
} from '../services/diagram-links.js';

const router = express.Router();

router.use(routePermission({ read: 'diagrams:read', write: 'diagrams:write' }));

/** ساختار درختی برای پنل کنار بوم: فهرست تخت با parentId */
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM diagrams ORDER BY name COLLATE NOCASE').all();
  res.json({ items: rows.map(serializeSummary) });
});

/* ------------------------------------------------------------------ */
/* پیوند دوطرفهٔ دیاگرام‌ها                                             */
/* ------------------------------------------------------------------ */
/* هر پیوند بین دو دیاگرام در هر دو بوم یک جزء «diagram» دارد؛ بنابراین   */
/* حذف/تغییر یک طرف، طرف مقابل را هم همگام می‌کند. برای هر جفت دیاگرام    */
/* تنها یک پیوند نگه داشته می‌شود تا نقشهٔ ارتباط یال تکراری نشان ندهد.    */

/**
 * نقشهٔ ارتباط دیاگرام‌ها.
 *
 * دو نوع رابطه برگردانده می‌شود: ساختار درختی (parentId) و پیوندهای
 * دستی که کاربر با جزء نوع «diagram» روی بوم ساخته است. هر جزء پیوند یک یال
 * مستقل است (نه یک جفت مبدأ/مقصد) تا بتوان چند پیوند به یک مقصد را جدا دید،
 * هر یال را به جزء روی بومش رساند و پیوندهای شکسته را دقیق پاک کرد.
 */

router.get('/graph', (_req, res) => {
  res.json(graphPayload());
});

/* ------------------------------------------------------------------ */
/* مدیریت پیوند بین دیاگرام‌ها بدون باز کردن بوم                        */
/* ------------------------------------------------------------------ */
/* جزء نوع «diagram» همان پیوند است؛ این سه مسیر فقط همان جزء را روی بوم
   مبدأ می‌سازند، تغییر می‌دهند یا حذف می‌کنند، نسخهٔ دیاگرام را بالا می‌برند
   و دیاگرام کامل را برمی‌گردانند تا بوم باز همان لحظه همگام شود. */
router.post('/:id/links', (req, res, next) => {
  try {
    res.status(201).json(serialize(createLink(Number(req.params.id), req.body || {})));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/links/:nodeId', (req, res, next) => {
  try {
    res.json(serialize(updateLink(Number(req.params.id), String(req.params.nodeId ?? ''), req.body || {})));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/links/:nodeId', (req, res, next) => {
  try {
    res.json(serialize(deleteLink(Number(req.params.id), String(req.params.nodeId ?? ''))));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new DiagramError('شناسهٔ دیاگرام نامعتبر است.');
    res.json(serialize(getRow(id)));
  } catch (e) {
    next(e);
  }
});

router.post('/', (req, res, next) => {
  try {
    const name = text(req.body?.name, NAME_MAX);
    if (!name) throw new DiagramError('نام دیاگرام لازم است.');
    const parentId = normalizeParent(req.body?.parentId);
    const ts = nowMs();
    const info = db
      .prepare(
        `INSERT INTO diagrams(parent_id, name, description, data, revision, created_by, created_at, updated_at)
         VALUES (?,?,?,?,1,?,?,?)`
      )
      .run(
        parentId,
        name,
        text(req.body?.description, DESCRIPTION_MAX),
        '{"nodes":[],"edges":[]}',
        text(req.user?.username, 120),
        ts,
        ts
      );
    const row = getRow(Number(info.lastInsertRowid));
    log('info', `دیاگرام «${row.name}» ساخته شد.`);
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const name = req.body?.name === undefined ? row.name : text(req.body.name, NAME_MAX);
    if (!name) throw new DiagramError('نام دیاگرام لازم است.');
    const description =
      req.body?.description === undefined ? row.description : text(req.body.description, DESCRIPTION_MAX);
    let parentId = row.parent_id;
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'parentId')) {
      parentId = normalizeParent(req.body.parentId);
      if (parentId !== null && isSelfOrDescendant(id, parentId)) {
        throw new DiagramError('دیاگرام نمی‌تواند زیرمجموعهٔ خودش یا زیرمجموعه‌هایش باشد.');
      }
    }
    const stamp = nowMs();
    const oldName = row.name;
    db.prepare(`UPDATE diagrams SET name = ?, description = ?, parent_id = ?, updated_at = ? WHERE id = ?`).run(
      name,
      description,
      parentId,
      stamp,
      id
    );
    const relabeled = name !== oldName ? renameLinkLabels(id, oldName, name, stamp) : { nodes: 0, diagrams: [] };
    if (relabeled.nodes) {
      log(
        'info',
        `نام دیاگرام «${oldName}» به «${name}» تغییر کرد و برچسب ${relabeled.nodes} پیوند در ${relabeled.diagrams.length} دیاگرام هم به‌روز شد.`
      );
    }
    res.json({
      ...serialize(getRow(id)),
      relabeledLinks: relabeled.nodes,
      relabeledDiagrams: relabeled.diagrams,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/content', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const revision = Number(req.body?.revision);
    if (!Number.isInteger(revision)) throw new DiagramError('شمارهٔ نسخهٔ دیاگرام لازم است.');
    if (revision !== row.revision) {
      return res.status(409).json({
        error: 'این دیاگرام در جای دیگری تغییر کرده است. برای ادامه، نسخهٔ تازه را بارگذاری کنید.',
        code: 'stale',
        revision: row.revision,
        updatedAt: row.updated_at,
      });
    }
    const graph = normalizeGraph(req.body);
    const previousGraph = readGraph(row);
    // ذخیرهٔ بوم و همگام‌سازی هر دو طرف پیوندها یک تراکنش است؛ اگر ظرفیت یک
    // دیاگرام مقصد پر باشد، ذخیرهٔ مبدأ هم برمی‌گردد و پیوند یک‌طرفه ساخته نمی‌شود.
    const savedRow = transaction(
      () => {
        const nextRevision = row.revision + 1;
        db.prepare('UPDATE diagrams SET data = ?, revision = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(graph),
          nextRevision,
          nowMs(),
          id
        );
        const saved = getRow(id);
        syncReciprocalLinks(saved, previousGraph, graph);
        return getRow(id);
      },
      { label: 'diagram.content.save' }
    );
    res.json(serialize(savedRow));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* پیوست‌های دیاگرام — تصویر/لوگو/نقشهٔ طبقه روی بوم                     */
/* ------------------------------------------------------------------ */
/* همان سامانهٔ پیوست تجهیزات استفاده می‌شود: تشخیص نوع از محتوای واقعی، نام
   تولیدی فایل روی دیسک و سقف حجم از تنظیمات. فقط تصویر پذیرفته می‌شود چون
   کاربرد این پیوست‌ها نمایش روی بوم است. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 + 1, files: 1, fields: 5, parts: 8 },
});

function serializeAttachment(row) {
  return {
    id: row.id,
    diagramId: row.diagram_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    downloadUrl: `/api/diagrams/${row.diagram_id}/attachments/${row.id}/download`,
  };
}

router.get('/:id/attachments', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const items = db
      .prepare('SELECT * FROM diagram_attachments WHERE diagram_id = ? ORDER BY created_at DESC')
      .all(row.id);
    res.json({ items: items.map(serializeAttachment), maxBytes: attachmentMaxBytes(getSettings()) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/attachments', upload.single('file'), (req, res, next) => {
  let written = null;
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    if (!req.file || !req.file.buffer?.length) throw new DiagramError('فایلی دریافت نشد.');
    const maxBytes = attachmentMaxBytes(getSettings());
    if (req.file.size > maxBytes) {
      throw new DiagramError(`حجم فایل بیش از حد مجاز (${Math.round(maxBytes / 1024 / 1024)} مگابایت) است.`, 413);
    }
    const type = detectFileType(req.file.buffer);
    if (!type || type.kind !== 'image') {
      throw new DiagramError('فقط تصویر (PNG/JPEG/GIF/WebP) برای بوم دیاگرام پذیرفته می‌شود.', 415);
    }
    written = writeAttachmentFile(req.file.buffer, type);
    const now = nowMs();
    const info = db
      .prepare(
        `INSERT INTO diagram_attachments(diagram_id, file_name, stored_name, mime, size_bytes, kind, uploaded_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        row.id,
        safeDisplayName(req.file.originalname, type.ext),
        written.storedName,
        type.mime,
        written.sizeBytes,
        type.kind,
        text(req.user?.username, 80),
        now
      );
    const saved = db.prepare('SELECT * FROM diagram_attachments WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json(serializeAttachment(saved));
  } catch (e) {
    // آپلود ناموفق نباید فایل یتیم روی دیسک بگذارد.
    if (written?.storedName) removeAttachmentFile(written.storedName);
    next(e);
  }
});

router.get('/:id/attachments/:attachmentId/download', (req, res, next) => {
  try {
    const row = db
      .prepare('SELECT * FROM diagram_attachments WHERE id = ? AND diagram_id = ?')
      .get(Number(req.params.attachmentId), Number(req.params.id));
    if (!row) throw new DiagramError('تصویر دیاگرام پیدا نشد.', 404);
    const full = attachmentPath(row.stored_name);
    if (!full || !fs.existsSync(full)) throw new DiagramError('فایل تصویر در دسترس نیست.', 404);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(full);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/attachments/:attachmentId', (req, res, next) => {
  try {
    const row = db
      .prepare('SELECT * FROM diagram_attachments WHERE id = ? AND diagram_id = ?')
      .get(Number(req.params.attachmentId), Number(req.params.id));
    if (!row) throw new DiagramError('تصویر دیاگرام پیدا نشد.', 404);
    const isAdmin = String(req.user?.role) === 'admin';
    if (!isAdmin && row.uploaded_by !== String(req.user?.username || '')) {
      throw new DiagramError('حذف تصویر دیگران فقط برای مدیر مجاز است.', 403);
    }
    // همان ترتیب امن پیوست تجهیز: اول فایل کنار گذاشته می‌شود، سپس رکورد.
    const staged = stageAttachmentRemoval(row.stored_name);
    try {
      db.prepare('DELETE FROM diagram_attachments WHERE id = ?').run(row.id);
    } catch (e) {
      if (staged?.restore) staged.restore();
      throw e;
    }
    if (staged?.commit) staged.commit();
    else removeAttachmentFile(row.stored_name);
    res.json({ deleted: 1 });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const ids = descendantIds(id);
    const idSet = new Set(ids);
    const placeholders = ids.map(() => '?').join(',');
    const attachments = db
      .prepare(`SELECT stored_name FROM diagram_attachments WHERE diagram_id IN (${placeholders})`)
      .all(...ids);
    // فایل‌ها پیش از حذف رکوردها کنار گذاشته می‌شوند؛ اگر تراکنش شکست بخورد
    // برگردانده می‌شوند و در غیر این صورت پس از Commit پاک می‌شوند.
    const staged = attachments.map((attachment) => stageAttachmentRemoval(attachment.stored_name)).filter(Boolean);
    let cleanup;
    try {
      cleanup = transaction(
        () => {
          db.prepare(`DELETE FROM diagrams WHERE id IN (${placeholders})`).run(...ids);
          return cleanupDiagramReferences(idSet);
        },
        { label: 'diagram.delete' }
      );
    } catch (e) {
      for (const item of staged) item.restore?.();
      throw e;
    }
    for (const item of staged) item.commit?.();
    log(
      'info',
      `دیاگرام «${row.name}» و ${ids.length - 1} زیرمجموعهٔ آن حذف شد؛ ${cleanup.cleanedLinks} ارجاع در ${cleanup.cleanedDiagrams} دیاگرام پاک‌سازی شد.`
    );
    res.json({ deleted: ids.length, ...cleanup });
  } catch (e) {
    next(e);
  }
});

export { pruneBrokenDiagramLinks };
export default router;

// خطاهای اعتبارسنجی/تعارض، خطای سرور نیستند و نباید در گزارش رویدادها
// به‌عنوان خطای داخلی ثبت شوند.
router.use((err, _req, res, next) => {
  if (!(err instanceof DiagramError)) return next(err);
  res.status(err.status).json({ error: err.message });
});
