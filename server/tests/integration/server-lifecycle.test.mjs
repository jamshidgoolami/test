/**
 * آزمون چرخهٔ عمر نقطهٔ ورود:
 *   • ترتیب Startup و شروع یک‌بارهٔ Scheduler/Engine.
 *   • شکست listen (پورت اشغال) با کد ۱ و آزادسازی DB.
 *   • شکست TLS پیش از ساخت Runtime و بستن DB.
 *   • SIGTERM/SIGINT تکراری فقط یک Shutdown ایجاد می‌کند.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, cleanupDir, freePort, startServer, useTempDataDir, waitFor } from '../helpers.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function spawnServer({ dataDir, port, env = {} }) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NETWATCH_DATA_DIR: dataDir,
      PORT: String(port),
      NETWATCH_ENGINE: '0',
      NETWATCH_SEED_DEMO: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d.toString()));
  child.stderr.on('data', (d) => (logs += d.toString()));
  return { child, logs: () => logs };
}

function waitForExit(child, timeout = 8000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeout);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function eventCount(logs, event) {
  return (logs.match(new RegExp(`"event":"${event}"`, 'g')) || []).length;
}

function assertDatabaseHealthy(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'netwatch.db'));
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
  }
}

test('startup starts each scheduler and the engine once, then shuts down once', async () => {
  const dir = useTempDataDir('lifecycle-order');
  const srv = await startServer({
    dataDir: dir,
    engine: true,
    env: {
      NETWATCH_ENGINE_MODE: 'simulate',
      NETWATCH_PING_INTERVAL: '3600',
      NETWATCH_SHUTDOWN_TIMEOUT_MS: '3000',
      NETWATCH_LOCK_RETRY_MS: '100',
    },
  });
  try {
    assert.ok(await waitFor(() => srv.logs().includes('engine_started'), { timeout: 5000 }), srv.logs());
    const started = srv.logs();

    for (const event of [
      'server_listen',
      'retention_scheduler_started',
      'backup_scheduler_started',
      'config_loaded',
      'engine_started',
    ]) {
      assert.equal(eventCount(started, event), 1, `${event} must be emitted exactly once`);
    }
    const retention = started.indexOf('retention_scheduler_started');
    const backup = started.indexOf('backup_scheduler_started');
    const config = started.indexOf('config_loaded');
    const engine = started.indexOf('engine_started');
    assert.ok(retention < backup, 'Retention must start before Backup');
    assert.ok(backup < config, 'Schedulers must start before config is logged');
    assert.ok(config < engine, 'Engine must start after config is logged');

    const code = await srv.stop();
    assert.equal(code, 0, srv.logs());
    const stopped = srv.logs();
    assert.equal(eventCount(stopped, 'shutdown_start'), 1);
    assert.equal(eventCount(stopped, 'shutdown_done'), 1);
    assert.equal(eventCount(stopped, 'engine_stopped'), 1);
    const shutdown = stopped.indexOf('shutdown_start');
    const engineStopped = stopped.indexOf('engine_stopped');
    const done = stopped.indexOf('shutdown_done');
    assert.ok(shutdown < engineStopped, 'Engine must stop during shutdown');
    assert.ok(engineStopped < done, 'shutdown_done must be last');
    assertDatabaseHealthy(dir);
  } finally {
    await srv.stop();
    cleanupDir(dir);
  }
});

test('listen failure exits with code 1 and closes the database', async () => {
  const dir = useTempDataDir('lifecycle-port-failure');
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', resolve);
  });
  const { child, logs } = spawnServer({ dataDir: dir, port });
  try {
    const code = await waitForExit(child);
    assert.equal(code, 1, logs());
    assert.match(logs(), new RegExp(`پورت ${port} در حال استفاده است`));
    assert.equal(eventCount(logs(), 'shutdown_start'), 1);
    assert.equal(eventCount(logs(), 'shutdown_done'), 1);
    assertDatabaseHealthy(dir);
  } finally {
    blocker.close();
    if (child.exitCode === null) child.kill('SIGKILL');
    cleanupDir(dir);
  }
});

test('TLS startup failure exits with code 1 after closing the database', async () => {
  const dir = useTempDataDir('lifecycle-tls-failure');
  const port = await freePort();
  const missingTls = path.join(dir, 'missing-tls');
  const { child, logs } = spawnServer({
    dataDir: dir,
    port,
    env: { NETWATCH_TLS_DIR: missingTls },
  });
  try {
    const code = await waitForExit(child);
    assert.equal(code, 1, logs());
    assert.match(logs(), /راه‌اندازی HTTPS ناموفق بود/);
    assertDatabaseHealthy(dir);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    cleanupDir(dir);
  }
});

test('repeated SIGTERM and SIGINT run shutdown only once', async () => {
  const dir = useTempDataDir('lifecycle-signals');
  const srv = await startServer({
    dataDir: dir,
    engine: true,
    env: {
      NETWATCH_ENGINE_MODE: 'simulate',
      NETWATCH_PING_INTERVAL: '3600',
      NETWATCH_SHUTDOWN_TIMEOUT_MS: '3000',
      NETWATCH_LOCK_RETRY_MS: '100',
    },
  });
  try {
    assert.ok(await waitFor(() => srv.logs().includes('engine_started'), { timeout: 5000 }), srv.logs());
    srv.child.kill('SIGTERM');
    await delay(20);
    srv.child.kill('SIGINT');
    const code = await waitForExit(srv.child);
    assert.equal(code, 0, srv.logs());
    const stopped = srv.logs();
    assert.equal(eventCount(stopped, 'shutdown_start'), 1);
    assert.equal(eventCount(stopped, 'shutdown_done'), 1);
    assert.equal(eventCount(stopped, 'engine_stopped'), 1);
    assert.equal(eventCount(stopped, 'engine_started'), 1);
    assert.equal(eventCount(stopped, 'retention_scheduler_started'), 1);
    assert.equal(eventCount(stopped, 'backup_scheduler_started'), 1);
    assertDatabaseHealthy(dir);
  } finally {
    if (srv.child.exitCode === null) srv.child.kill('SIGKILL');
    cleanupDir(dir);
  }
});
