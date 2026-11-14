/**
 * NetWatch — زمان‌بند Polling سرورها
 * ----------------------------------------------------------------
 * Agent داده را Push می‌کند؛ BMC را NetWatch با فاصلهٔ هر سرور می‌خواند.
 * تیک هر ۵ ثانیه است تا سرورهای مختلف با فاصلهٔ طبیعی پخش شوند، اما هر
 * پروفایل فقط وقتی last_poll_at از interval آن گذشته باشد خوانده می‌شود.
 */
import { db } from '../db.js';
import { logEvent } from '../logger.mjs';
import { collectRedfish } from './redfish.js';
import { collectIpmi } from './ipmi.js';
import { demoSnapshot } from './demo.js';
import { ingestSnapshot, markPollFailure, pruneServerMetrics } from './store.js';

const TICK_MS = 5000;
const CONCURRENCY = 2;
const PRUNE_MS = 6 * 60 * 60 * 1000;

let timer = null;
let tickRunning = false;
let lastPruneAt = 0;

async function pollOne(row) {
  const now = Date.now();
  // قبل از شبکه علامت می‌زنیم تا دو تیک هم‌زمان یک سرور را دوبار Poll نکنند.
  db.prepare('UPDATE servers SET last_poll_at = ? WHERE id = ?').run(now, row.id);
  try {
    const snapshot =
      row.bmc_protocol === 'demo'
        ? demoSnapshot(row, now)
        : row.bmc_protocol === 'ipmi'
          ? await collectIpmi(row)
          : await collectRedfish(row);
    const source = row.bmc_protocol === 'demo' ? 'demo' : row.bmc_protocol === 'ipmi' ? 'ipmi' : 'redfish';
    ingestSnapshot(row.id, snapshot, source);
  } catch (e) {
    const message = String(e?.message || e).slice(0, 500);
    markPollFailure(row.id, message);
    logEvent('warn', 'server_poll_failed', { serverId: row.id, protocol: row.bmc_protocol, message });
  }
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const now = Date.now();
    if (now - lastPruneAt > PRUNE_MS) {
      lastPruneAt = now;
      try {
        const days = Number(process.env.NETWATCH_SERVER_METRICS_DAYS) || 30;
        pruneServerMetrics(days);
      } catch (e) {
        logEvent('warn', 'server_metrics_prune_failed', { message: e.message });
      }
    }
    const due = db
      .prepare(
        `SELECT * FROM servers
         WHERE enabled = 1 AND bmc_protocol IN ('redfish','ipmi','demo')
           AND (last_poll_at IS NULL OR last_poll_at + poll_interval_sec * 1000 <= ?)
         ORDER BY COALESCE(last_poll_at, 0) ASC, id ASC
         LIMIT 8`
      )
      .all(now);
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      await Promise.all(due.slice(i, i + CONCURRENCY).map(pollOne));
    }
  } catch (e) {
    logEvent('error', 'server_poller_tick_failed', { message: e.message });
  } finally {
    tickRunning = false;
  }
}

export function startServerPoller() {
  if (String(process.env.NETWATCH_SERVER_POLL || '1') === '0') {
    return { stop() {} };
  }
  if (timer) return { stop() {} };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  void tick();
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
