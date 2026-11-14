/**
 * NetWatch — API پایش سرورها
 */
import express from 'express';
import { routePermission } from '../permissions.js';
import {
  createServer,
  deleteServer,
  getServer,
  getServerDetail,
  getServerRow,
  ingestSnapshot,
  listServers,
  markPollFailure,
  rotateAgentToken,
  seriesFor,
  updateServer,
} from '../server-monitoring/store.js';
import { collectRedfish } from '../server-monitoring/redfish.js';
import { collectIpmi } from '../server-monitoring/ipmi.js';
import { demoSnapshot } from '../server-monitoring/demo.js';

const router = express.Router();

router.use(routePermission({ read: 'servers:read', write: 'servers:write' }));

function fail(res, error, fallback = 'عملیات سرور انجام نشد.') {
  return res.status(Number(error?.status) || 400).json({ error: String(error?.message || fallback) });
}

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listServers());
});

router.post('/demo', (req, res) => {
  try {
    const created = createServer({
      name: req.body?.name || 'سرور نمایشی',
      osHostname: 'demo-win-01',
      osIp: '192.0.2.10',
      vendor: 'Supermicro',
      model: 'SYS-620U-TNR',
      serial: 'DEMO-0001',
      location: 'اتاق سرور نمایشی',
      bmcIp: '192.0.2.11',
      bmcProtocol: 'demo',
      pollIntervalSec: 60,
    });
    res.status(201).json(created);
  } catch (e) {
    fail(res, e);
  }
});

router.get('/:id/metrics', (req, res) => {
  if (!getServer(req.params.id)) return res.status(404).json({ error: 'سرور یافت نشد' });
  const range = String(req.query.range || '1h');
  return res.json(seriesFor(req.params.id, range));
});

router.get('/:id', (req, res) => {
  const detail = getServerDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'سرور یافت نشد' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(detail);
});

router.post('/', (req, res) => {
  try {
    const created = createServer(req.body || {});
    res.status(201).json(created);
  } catch (e) {
    fail(res, e);
  }
});

router.patch('/:id', (req, res) => {
  try {
    const updated = updateServer(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'سرور یافت نشد' });
    res.json(updated);
  } catch (e) {
    fail(res, e);
  }
});

router.post('/:id/rotate-agent-token', (req, res) => {
  const rotated = rotateAgentToken(req.params.id);
  if (!rotated) return res.status(404).json({ error: 'سرور یافت نشد' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(rotated);
});

router.post('/:id/collect', async (req, res) => {
  const row = getServerRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'سرور یافت نشد' });
  if (row.bmc_protocol === 'none') return res.status(400).json({ error: 'برای این سرور پروتکل BMC فعال نیست.' });
  try {
    const snapshot =
      row.bmc_protocol === 'demo' ? demoSnapshot(row) : row.bmc_protocol === 'ipmi' ? await collectIpmi(row) : await collectRedfish(row);
    const source = row.bmc_protocol === 'demo' ? 'demo' : row.bmc_protocol === 'ipmi' ? 'ipmi' : 'redfish';
    ingestSnapshot(row.id, snapshot, source);
    return res.json({
      ok: true,
      source,
      collectedAt: snapshot.collectedAt,
      health: snapshot.metric?.health ?? 'unknown',
      sensors: snapshot.sensors?.length ?? 0,
      disks: snapshot.disks?.length ?? 0,
    });
  } catch (e) {
    markPollFailure(row.id, e.message);
    return res.status(502).json({ error: `خواندن BMC ناموفق بود: ${e.message}` });
  }
});

router.delete('/:id', (req, res) => {
  if (!deleteServer(req.params.id)) return res.status(404).json({ error: 'سرور یافت نشد' });
  res.status(204).end();
});

export default router;
