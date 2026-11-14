/**
 * NetWatch — دریافت متریک از Agent ویندوز
 * ----------------------------------------------------------------
 * این Router عمداً پیش از requireAuth سوار می‌شود: Agent یک برنامهٔ سرویسی
 * است و نشست مرورگر/CSRF ندارد. اعتبار آن یک توکن اختصاصی هر سرور است که
 * فقط هش SHA-256 آن در پایگاه‌داده نگه داشته می‌شود.
 */
import express from 'express';
import { ingestSnapshot, serverForAgentToken } from '../server-monitoring/store.js';
import { normalizeAgentPayload } from '../server-monitoring/normalize.js';

const router = express.Router();

function bearer(req) {
  const header = String(req.get('authorization') || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  return String(req.get('x-netwatch-token') || '').trim();
}

router.post('/metrics', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const server = serverForAgentToken(bearer(req));
  if (!server) return res.status(401).json({ error: 'توکن Agent معتبر نیست.' });
  try {
    const snapshot = normalizeAgentPayload(req.body || {});
    const saved = ingestSnapshot(server.id, snapshot, 'agent');
    return res.status(202).json({
      ok: true,
      serverId: server.id,
      receivedAt: saved.ts,
      health: snapshot.metric.health,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

export default router;
