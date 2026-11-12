/**
 * تایمر Hard Deadline نباید unref شود؛ وگرنه در نبود Handle دیگر، Node پیش از
 * اجرای Timeout خارج می‌شود و Promise معلق می‌ماند.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../../engine-probe.js', import.meta.url).href;

test('the hard deadline runs without any other active handle', () => {
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        const { probeWithDeadline } = await import(${JSON.stringify(moduleUrl)});
        try {
          await probeWithDeadline(
            () => new Promise(() => {}),
            {},
            { timeoutMs: 100, count: 1, retries: 0 },
            80
          );
          process.exit(2);
        } catch (e) {
          console.log('DEADLINE:' + e.code);
          process.exit(e.code === 'PROBE_DEADLINE' ? 7 : 3);
        }
      `,
    ],
    { encoding: 'utf8', timeout: 5000 }
  );

  assert.equal(child.status, 7, `child exited before the deadline:\n${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /DEADLINE:PROBE_DEADLINE/);
  assert.ok(Date.now() - started >= 50, 'the deadline must actually elapse');
});
