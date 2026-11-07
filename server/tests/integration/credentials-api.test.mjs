/**
 * آزمون API مخزن اعتبارنامه:
 *   • مجوز جدا برای خواندن، نوشتن و نمایش رمز
 *   • رمز هرگز در فهرست/جزئیات برنمی‌گردد و فقط reveal آن را می‌دهد
 *   • پاسخ reveal کش نمی‌شود و در Audit Log ثبت می‌شود
 *   • سنجش قدرت در فهرست قابل فیلتر است (بدون رمزگشایی)
 *   • اعتبارسنجی ورودی و انتقال یک‌بارهٔ اعتبارنامهٔ تجهیزات
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir, startServer, api, login } from '../helpers.mjs';

const dir = useTempDataDir('credentials-api');
let server;
let created;

before(async () => {
  server = await startServer({ dataDir: dir });
});

after(async () => {
  await server.stop();
  cleanupDir(dir);
});

test('the vault requires authentication and viewer has no access', async () => {
  assert.equal((await api(server.base, 'GET', '/api/credentials', undefined, { auth: false })).status, 401);

  const user = await api(server.base, 'POST', '/api/auth/users', {
    username: 'credviewer',
    password: 'cred-viewer-123456',
    role: 'viewer',
  });
  assert.equal(user.status, 201);

  await login(server.base, 'credviewer', 'cred-viewer-123456');
  assert.equal((await api(server.base, 'GET', '/api/credentials')).status, 403);
  assert.equal((await api(server.base, 'GET', '/api/credentials/1/reveal')).status, 403);

  await login(server.base);
  assert.equal((await api(server.base, 'GET', '/api/credentials')).status, 200);
});

test('a credential is stored without leaking its secret', async () => {
  const res = await api(server.base, 'POST', '/api/credentials', {
    label: 'Core switch SSH',
    kind: 'ssh',
    username: 'netadmin',
    secret: 'netadmin!2024',
    host: '10.0.0.2',
    port: 22,
    tags: ['core', 'ssh'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  created = res.data;
  assert.equal(created.label, 'Core switch SSH');
  assert.equal(created.kind, 'ssh');
  assert.equal(created.username, 'netadmin');
  assert.equal(created.secret, undefined, 'رمز نباید در پاسخ بیاید');
  assert.equal(created.hasSecret, true);
  assert.deepEqual(created.tags, ['core', 'ssh']);
  assert.equal(created.weak, true, 'رمز مشتق از نام کاربری باید هشدار بگیرد');
  assert.ok(created.weakReasons.length > 0);
  assert.ok(created.strengthLabel);

  const list = await api(server.base, 'GET', '/api/credentials');
  assert.equal(list.status, 200);
  assert.ok(list.data.items.every((item) => item.secret === undefined && item.secret_enc === undefined));
  assert.ok(list.data.kindLabels.some((k) => k.id === 'ssh'));
});

test('search covers label, host, tags and encrypted usernames', async () => {
  const byLabel = await api(server.base, 'GET', '/api/credentials?search=Core%20switch');
  assert.equal(byLabel.status, 200);
  assert.equal(byLabel.data.total, 1);

  const byUsername = await api(server.base, 'GET', '/api/credentials?search=netadmin');
  assert.equal(byUsername.data.total, 1, 'جست‌وجوی نام کاربری رمزنگاری‌شده');

  const byHost = await api(server.base, 'GET', '/api/credentials?search=10.0.0');
  assert.equal(byHost.data.total, 1);

  const byTag = await api(server.base, 'GET', '/api/credentials?search=core');
  assert.equal(byTag.data.total, 1);

  const missing = await api(server.base, 'GET', '/api/credentials?search=does-not-exist');
  assert.equal(missing.data.total, 0);
});

test('weak filter and summary read the stored score without decrypting', async () => {
  const weak = await api(server.base, 'GET', '/api/credentials?weak=1');
  assert.equal(weak.status, 200);
  assert.equal(weak.data.total, 1);
  assert.equal(weak.data.items[0].id, created.id);

  const summary = await api(server.base, 'GET', '/api/credentials/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.total, 1);
  assert.equal(summary.data.weak, 1);
  assert.ok(summary.data.kinds.some((k) => k.kind === 'ssh'));
});

test('reveal returns the secret uncached and is audited', async () => {
  const res = await api(server.base, 'GET', `/api/credentials/${created.id}/reveal`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.secret, 'netadmin!2024');
  assert.equal(res.data.username, 'netadmin');
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const audit = await api(server.base, 'GET', '/api/audit?action=credential.reveal&pageSize=5');
  assert.equal(audit.status, 200);
  assert.ok(audit.data.total >= 1, 'نمایش رمز باید در Audit Log ثبت شود');

  const missing = await api(server.base, 'GET', '/api/credentials/99999/reveal');
  assert.equal(missing.status, 404);
});

test('editing the secret recalculates strength and records the rotation time', async () => {
  const patch = await api(server.base, 'PATCH', `/api/credentials/${created.id}`, {
    secret: 'vT7#pQ2!mK9@zR4$wX8&',
    notes: 'فقط از شبکهٔ مدیریت',
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.weak, false);
  assert.ok(patch.data.strength >= 3, `strength=${patch.data.strength}`);
  assert.ok(patch.data.lastRotatedAt > 0);
  assert.equal(patch.data.notes, 'فقط از شبکهٔ مدیریت');

  const reveal = await api(server.base, 'GET', `/api/credentials/${created.id}/reveal`);
  assert.equal(reveal.data.secret, 'vT7#pQ2!mK9@zR4$wX8&');

  const rotated = await api(server.base, 'POST', `/api/credentials/${created.id}/rotated`, { rotateEveryDays: 90 });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.data.rotateEveryDays, 90);
  assert.ok(rotated.data.dueAt > Date.now());
});

test('invalid input is rejected with a clear 400', async () => {
  const cases = [
    { body: { kind: 'ssh', secret: 'x' }, hint: 'بدون عنوان' },
    { body: { label: 'x', kind: 'nope', secret: 'x' }, hint: 'نوع نامعتبر' },
    { body: { label: 'x', kind: 'ssh' }, hint: 'بدون رمز' },
    { body: { label: 'x', kind: 'ssh', secret: 'ok', port: 70000 }, hint: 'پورت نامعتبر' },
    { body: { label: 'x', kind: 'ssh', secret: 'a\u0001b' }, hint: 'نویسهٔ کنترلی' },
    { body: { label: 'x', kind: 'ssh', secret: 'ok', deviceId: 424242 }, hint: 'تجهیز ناموجود' },
  ];
  for (const item of cases) {
    const res = await api(server.base, 'POST', '/api/credentials', item.body);
    assert.equal(res.status, 400, `${item.hint}: ${JSON.stringify(res.data)}`);
  }
});

test('the generator endpoint respects the requested complexity', async () => {
  const res = await api(server.base, 'POST', '/api/credentials/generate', {
    mode: 'random',
    length: 26,
    digits: true,
    symbols: true,
    avoidAmbiguous: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.value.length, 26);
  assert.match(res.data.value, /[A-Z]/);
  assert.match(res.data.value, /\d/);
  assert.doesNotMatch(res.data.value, /[Il1O0o|`]/);
  assert.ok(res.data.assessment.score >= 3);

  const phrase = await api(server.base, 'POST', '/api/credentials/generate', { mode: 'passphrase', words: 5 });
  assert.equal(phrase.status, 200);
  assert.equal(phrase.data.value.split('-').length, 5);
});

test('device credentials can be imported once without duplicates', async () => {
  const device = await api(server.base, 'POST', '/api/devices', {
    name: 'Import switch',
    ip: '10.9.9.9',
    access_username: 'admin',
    access_password: 'legacy-secret-1',
  });
  assert.equal(device.status, 201, JSON.stringify(device.data));

  const first = await api(server.base, 'POST', '/api/credentials/import-devices', {});
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(first.data.created >= 1);

  const second = await api(server.base, 'POST', '/api/credentials/import-devices', {});
  assert.equal(second.data.created, 0, 'اجرای دوباره نباید دادهٔ تکراری بسازد');
  assert.ok(second.data.skipped >= 1);

  const list = await api(server.base, 'GET', `/api/credentials?deviceId=${device.data.id}`);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].deviceName, 'Import switch');
  assert.equal(list.data.items[0].username, 'admin');
  assert.equal(list.data.items[0].secret, undefined);
});

test('recheck recalculates scores and deletes remove the record', async () => {
  const recheck = await api(server.base, 'POST', '/api/credentials/recheck', {});
  assert.equal(recheck.status, 200, JSON.stringify(recheck.data));
  assert.ok(recheck.data.checked >= 2);
  assert.equal(recheck.data.unreadable, 0);

  const removed = await api(server.base, 'DELETE', `/api/credentials/${created.id}`);
  assert.equal(removed.status, 204);
  assert.equal((await api(server.base, 'GET', `/api/credentials/${created.id}`)).status, 404);
  assert.equal((await api(server.base, 'DELETE', `/api/credentials/${created.id}`)).status, 404);
});
