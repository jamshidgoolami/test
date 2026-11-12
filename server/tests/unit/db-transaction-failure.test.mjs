/**
 * txDepth باید پس از شکست COMMIT/RELEASE دقیقاً به عمق قبلی برگردد؛
 * کم‌شدن دوباره، تراکنش بیرونی را زودهنگام باز می‌کند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir } from '../helpers.mjs';

const dir = useTempDataDir('db-tx-failure');
const { db, transaction } = await import('../../db.js');

after(() => {
  db.close();
  cleanupDir(dir);
});

test('a failed COMMIT resets depth and leaves the connection usable', () => {
  db.exec('CREATE TABLE IF NOT EXISTS tx_commit_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const originalExec = db.raw.exec;
  try {
    let failed = false;
    db.raw.exec = function failCommit(sql) {
      if (!failed && String(sql) === 'COMMIT') {
        failed = true;
        throw Object.assign(new Error('simulated commit failure'), { code: 'SQLITE_IOERR' });
      }
      return originalExec.call(this, sql);
    };

    assert.throws(
      () => transaction(() => db.prepare("INSERT INTO tx_commit_probe(value) VALUES ('commit')").run()),
      (error) => error.code === 'DB_IO' && /simulated commit failure/.test(error.cause?.message || '')
    );
    assert.equal(db.txDepth, 0, 'COMMIT failure must not leave a nested depth');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM tx_commit_probe').get().c, 0, 'the outer transaction must roll back');

    db.raw.exec = originalExec;
    transaction(() => db.prepare("INSERT INTO tx_commit_probe(value) VALUES ('after')").run());
    assert.deepEqual(
      db.prepare('SELECT value FROM tx_commit_probe ORDER BY id').all().map((r) => r.value),
      ['after'],
      'the connection must accept a new transaction'
    );
  } finally {
    db.raw.exec = originalExec;
    db.exec('DROP TABLE IF EXISTS tx_commit_probe');
  }
});

test('a failed RELEASE keeps the outer transaction and depth intact', () => {
  db.exec('CREATE TABLE IF NOT EXISTS tx_release_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const originalExec = db.raw.exec;
  try {
    let failed = false;
    db.raw.exec = function failRelease(sql) {
      if (!failed && String(sql).startsWith('RELEASE nw_sp_')) {
        failed = true;
        throw new Error('simulated release failure');
      }
      return originalExec.call(this, sql);
    };

    transaction(() => {
      db.prepare("INSERT INTO tx_release_probe(value) VALUES ('outer')").run();
      assert.throws(
        () => transaction(() => db.prepare("INSERT INTO tx_release_probe(value) VALUES ('inner')").run()),
        /simulated release failure/
      );
      assert.equal(db.txDepth, 1, 'outer transaction must still be active after inner RELEASE failure');
      db.prepare("INSERT INTO tx_release_probe(value) VALUES ('after')").run();
    });

    assert.equal(db.txDepth, 0);
    assert.deepEqual(
      db.prepare('SELECT value FROM tx_release_probe ORDER BY id').all().map((r) => r.value),
      ['outer', 'after'],
      'only the inner savepoint should be rolled back'
    );
  } finally {
    db.raw.exec = originalExec;
    db.exec('DROP TABLE IF EXISTS tx_release_probe');
  }
});
