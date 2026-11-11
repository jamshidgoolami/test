/**
 * آزمون کمک‌کننده‌های تجهیزات: خطای فایل ورودی باید ۴۰۰ باشد و فقط
 * کدهای زیرساختی حفظ شوند؛ همگام‌سازی بدون فیلد دسترسی بی‌اثر است.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { importErrorStatus, syncVaultCredential } from '../../services/device-access.js';

test('import errors preserve infrastructure statuses only', () => {
  for (const status of [413, 415, 429, 503, 504, 507]) {
    assert.equal(importErrorStatus({ status }), status);
  }
  assert.equal(importErrorStatus({ status: 500 }), 400);
  assert.equal(importErrorStatus(new Error('bad file')), 400);
  assert.equal(importErrorStatus(null), 400);
});

test('credential sync ignores bodies without access fields', () => {
  assert.doesNotThrow(() => syncVaultCredential(1, null));
  assert.doesNotThrow(() => syncVaultCredential(1, {}));
  assert.doesNotThrow(() => syncVaultCredential(1, { name: 'device' }));
});
