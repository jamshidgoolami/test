/**
 * آزمون واحد تولید رمز، سنجش قدرت و رمزنگاری AAD اعتبارنامه‌ها.
 * هیچ پایگاه‌داده‌ای لازم نیست؛ ماژول‌ها خالص‌اند (کلید از env خوانده می‌شود).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NETWATCH_CREDENTIAL_KEY = 'a'.repeat(64);

const { assessSecret, STRENGTH_LABELS } = await import('../../credential-strength.js');
const { generatePassword, generatePassphrase, generateSecret, normalizeGeneratorOptions, GENERATOR_LIMITS, WORD_LIST } =
  await import('../../password-generator.js');
const { encryptSecret, decryptSecret, tryDecryptSecret } = await import('../../credential-crypto.js');

/* ----------------------------- generator ----------------------------- */

test('generated passwords honour length and the selected character classes', () => {
  for (const length of [8, 16, 24, 48]) {
    const out = generatePassword({ length, lower: true, upper: true, digits: true, symbols: false, avoidAmbiguous: false });
    assert.equal(out.value.length, length);
    assert.match(out.value, /[a-z]/, 'حروف کوچک');
    assert.match(out.value, /[A-Z]/, 'حروف بزرگ');
    assert.match(out.value, /\d/, 'رقم');
    assert.ok(out.entropyBits > 0);
  }
});

test('avoiding ambiguous characters removes look-alikes', () => {
  for (let i = 0; i < 25; i++) {
    const out = generatePassword({ length: 32, avoidAmbiguous: true });
    assert.doesNotMatch(out.value, /[Il1O0o|`]/, out.value);
  }
});

test('a single enabled class still produces a usable password', () => {
  const out = generatePassword({ length: 14, lower: false, upper: false, digits: true, symbols: false });
  assert.equal(out.value.length, 14);
  assert.match(out.value, /^\d+$/);
});

test('options are clamped to safe bounds', () => {
  const tiny = normalizeGeneratorOptions({ length: 1 });
  const huge = normalizeGeneratorOptions({ length: 9999 });
  assert.equal(tiny.length, GENERATOR_LIMITS.minLength);
  assert.equal(huge.length, GENERATOR_LIMITS.maxLength);
  const none = normalizeGeneratorOptions({ lower: false, upper: false, digits: false, symbols: false });
  assert.ok(none.lower || none.upper || none.digits || none.symbols, 'دستهٔ نویسه باید پیش‌فرض امن داشته باشد');
});

test('passphrases use the requested number of distinct words and an accepted separator', () => {
  const out = generatePassphrase({ words: 5, separator: '-', addNumber: false, capitalize: false });
  const words = out.value.split('-');
  assert.equal(words.length, 5);
  assert.equal(new Set(words).size, 5, 'کلمهٔ تکراری در یک عبارت مجاز نیست');
  for (const word of words) assert.ok(WORD_LIST.includes(word), word);
  assert.ok(words.every((w) => w === w.toLowerCase()));
});

test('passphrase options add a number and capitalisation when asked', () => {
  const out = generatePassphrase({ words: 4, separator: '.', addNumber: true, capitalize: true });
  const parts = out.value.split('.');
  assert.equal(parts.length, 5);
  assert.match(parts[4], /^\d{2}$/);
  assert.equal(parts[0][0], parts[0][0].toUpperCase());
});

test('generateSecret routes to the right mode', () => {
  assert.ok(generateSecret({ mode: 'passphrase', words: 4 }).value.includes('-'));
  assert.equal(generateSecret({ mode: 'random', length: 12 }).value.length, 12);
});

/* ------------------------------ strength ------------------------------ */

test('common device defaults are reported as very weak', () => {
  for (const secret of ['admin', 'cisco', '123456', 'password', 'qwerty']) {
    const result = assessSecret(secret);
    assert.equal(result.score, 0, secret);
    assert.equal(result.weak, true, secret);
    assert.ok(result.reasons.length > 0);
  }
});

test('short secrets stay in the warning range even with mixed characters', () => {
  const result = assessSecret('Ab3!xy');
  assert.ok(result.score <= 1);
  assert.equal(result.weak, true);
  assert.match(result.reasons.join(' '), /کوتاه‌تر از/);
});

test('long random secrets score high and are not flagged', () => {
  const result = assessSecret(generatePassword({ length: 24 }).value);
  assert.ok(result.score >= 3, `score=${result.score}`);
  assert.equal(result.weak, false);
});

test('secrets derived from the label, username or host are warned about', () => {
  const label = assessSecret('Coreswitch2024!', { label: 'CoreSwitch' });
  assert.ok(label.score <= 1);
  assert.match(label.reasons.join(' '), /عنوان تجهیز/);

  const username = assessSecret('netadmin!2024', { username: 'netadmin' });
  assert.ok(username.score <= 1);
  assert.match(username.reasons.join(' '), /نام کاربری/);

  const host = assessSecret('gw-192.168.1.1', { host: '192.168.1.1' });
  assert.ok(host.weak);
});

test('strength labels match the score scale', () => {
  assert.equal(STRENGTH_LABELS.length, 5);
  const result = assessSecret('x');
  assert.equal(result.label, STRENGTH_LABELS[result.score]);
});

test('an empty secret is flagged and never scores', () => {
  const result = assessSecret('');
  assert.equal(result.score, 0);
  assert.equal(result.weak, true);
  assert.equal(result.entropyBits, 0);
});

/* ------------------------------ crypto ------------------------------- */

test('secrets round-trip with per-record AAD', () => {
  const aad = 'cred:7';
  const payload = encryptSecret('s3cret-value', aad);
  assert.match(payload, /^v2:/);
  assert.equal(decryptSecret(payload, aad), 's3cret-value');
});

test('a ciphertext moved to another record fails authentication', () => {
  const payload = encryptSecret('s3cret-value', 'cred:7');
  assert.throws(() => decryptSecret(payload, 'cred:8'));
  assert.equal(tryDecryptSecret(payload, 'cred:8'), '', 'خواندن تلورانت باید خالی برگرداند');
});

test('legacy v1 payloads (device credentials) still decrypt', () => {
  const legacy = encryptSecret('legacy-secret');
  assert.match(legacy, /^v1:/);
  assert.equal(decryptSecret(legacy), 'legacy-secret');
  assert.equal(decryptSecret(legacy, 'ignored-aad'), 'legacy-secret');
});

test('empty values stay empty and tampered payloads are rejected', () => {
  assert.equal(encryptSecret(''), '');
  assert.equal(decryptSecret(''), '');
  const payload = encryptSecret('abc', 'cred:1');
  const parts = payload.split(':');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('xyz').toString('base64')].join(':');
  assert.throws(() => decryptSecret(tampered, 'cred:1'));
});
