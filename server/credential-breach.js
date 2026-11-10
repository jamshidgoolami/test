/**
 * NetWatch — سنجش «افشاشده بودن» رمزها، بدون اینترنت
 * ----------------------------------------------------------------
 * برنامه آفلاین است و اجازهٔ تماس با سرویس‌های بیرونی (مثل HIBP) را ندارد؛
 * بنابراین افشا بودن با یک فهرست مرجع محلی از رایج‌ترین رمزهای لو‌رفته و
 * پیش‌فرض تجهیزات سنجیده می‌شود.
 *
 *   • مقایسه پس از نرمال‌سازی (کوچک‌کردن حروف و حذف فاصله/نقطه/زیرخط) انجام
 *     می‌شود تا «Passw0rd!» و «passw0rd» هم پوشش داده شوند.
 *   • نتیجه فقط یک پرچم بولی است؛ خود رمز هرگز در پاسخ یا لاگ نمی‌آید.
 *   • این فهرست «تضمین کامل» نیست و در رابط کاربری هم همین‌طور توضیح داده
 *     می‌شود: نبودن در فهرست به معنی امن بودن قطعی نیست.
 */

const BREACHED_PASSWORDS = [
  // رمزهای پیش‌فرض رایج تجهیزات شبکه
  'admin', 'admin123', 'admin1234', 'admin12345', 'administrator', 'root', 'toor',
  'default', 'guest', 'guest123', 'cisco', 'cisco123', 'cisco1234', 'ubnt', 'ubiquiti',
  'mikrotik', 'netgear', 'dlink', 'tp-link', 'tplink', 'linksys', 'asus', 'zyxel',
  'public', 'private', 'community', 'enable', 'letmein', 'welcome', 'welcome1',
  'welcome123', 'changeme', 'changeme123', 'support', 'service', 'password',
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd',
  'p@ssword', 'pa$$word', 'secret', 'secret123', 'test', 'test123', 'temp123',
  'system', 'manager', 'operator', 'supervisor', 'monitor', 'netwatch', 'netwatch123',
  'snmp', 'snmpv3', 'readonly', 'readwrite', 'switch', 'router', 'firewall',
  'vpn', 'vpn123', 'wifi', 'wifi123', 'wireless', 'internet', 'server', 'server123',
  'user', 'user123', 'user1234', 'login', 'login123', 'access', 'access123',
  // رمزهای پرتکرار در فهرست‌های لو‌رفتهٔ عمومی
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345678910',
  '12345', '1234', '111111', '11111111', '000000', '00000000', '121212', '654321',
  'abc123', 'abc1234', 'abcd1234', 'abcd123456', 'a1b2c3', 'qwerty', 'qwerty1',
  'qwerty12', 'qwerty123', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbnm',
  '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'iloveyou', 'monkey', 'dragon',
  'master', 'shadow', 'sunshine', 'princess', 'football', 'baseball', 'superman',
  'batman', 'trustno1', 'starwars', 'whatever', 'freedom', 'hello', 'hello123',
  'charlie', 'donald', 'jordan', 'michael', 'nicole', 'jessica', 'ashley', 'hunter',
  'summer', 'winter', 'spring', 'autumn', 'flower', 'purple', 'orange', 'banana',
  'cookie', 'pepper', 'ginger', 'hammer', 'silver', 'golden', 'diamond', 'matrix',
  'mustang', 'ferrari', 'porsche', 'chelsea', 'liverpool', 'arsenal', 'barcelona',
  'letmein1', 'letmein123', 'passport', 'pass1234', 'pass12345', 'passwd', 'passwd123',
  'changeme1', 'qazwsx', 'qazwsx123', 'qwe123', 'qweasd', 'qweasdzxc', 'asd123',
  'asdf1234', 'zxcv1234', 'adminadmin', 'rootroot', 'passwordpassword',
];

const NORMALIZED = new Set(
  BREACHED_PASSWORDS.map((value) =>
    String(value)
      .toLowerCase()
      .replace(/[\s._-]+/g, '')
  )
);

/** الگوهای حدسی: رمز پیش‌فرض + چند رقم/نماد، یا تکرار ساده */
const PATTERNS = [
  /^(?:password|passw0rd|p@ssw0rd|admin|root|cisco|welcome|letmein|qwerty|ubnt|mikrotik)[0-9!@#$%^&*]{0,4}$/,
  /^(?:1{5,}|0{5,}|123456(?:7890?)?|abc123(?:4|456)?|qwerty(?:123|12)?)$/,
];

/**
 * آیا این رمز در فهرست مرجع رمزهای افشاشده/پیش‌فرض است؟
 * @param {string} secret
 * @returns {boolean}
 */
export function isBreachedSecret(secret) {
  const value = String(secret ?? '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
  if (!value) return false;
  return NORMALIZED.has(value) || PATTERNS.some((pattern) => pattern.test(value));
}

export const BREACH_REFERENCE_SIZE = NORMALIZED.size;

export default { isBreachedSecret, BREACH_REFERENCE_SIZE };
