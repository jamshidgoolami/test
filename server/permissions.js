/**
 * NetWatch — نقش‌ها و مجوزهای دسترسی (RBAC)
 * ----------------------------------------------------------------
 * سه نقش پایه:
 *   • admin      (Administrator): همهٔ مجوزها
 *   • operator   (Operator): عملیات روزمره (تجهیزات، هشدارها، تعمیرات، Probe)
 *   • viewer     (Viewer): فقط مشاهده
 *
 * مجوزها با نام‌های `<منبع>:<کنش>` تعریف می‌شوند و هر مسیر API پیش از اجرا
 * یکی از آن‌ها را طلب می‌کند. بررسی نقش به‌تنهایی کافی نیست: یک Viewer نباید
 * حتی با GET به Probe (اسکن فعال) دسترسی داشته باشد.
 */

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
});

export const ROLE_LABELS = Object.freeze({
  admin: 'Administrator',
  operator: 'Operator',
  viewer: 'Viewer',
});

/** فهرست کامل مجوزهای شناخته‌شده (برای نمایش در /auth/me و مستندات) */
export const ALL_PERMISSIONS = Object.freeze([
  'dashboard:read',
  'devices:read',
  'devices:write',
  'servers:read',
  'servers:write',
  'credentials:read',
  'credentials:write',
  'credentials:reveal',
  'reports:read',
  'alerts:read',
  'alerts:write',
  'maintenance:read',
  'maintenance:write',
  'inventory:read',
  'inventory:write',
  'markers:read',
  'markers:write',
  'diagrams:read',
  'diagrams:write',
  'settings:read',
  'settings:write',
  'engine:read',
  'engine:control',
  'ops:read',
  'ops:write',
  'probe:run',
  'system:health',
  'users:manage',
  'audit:read',
  'demo:reset',
]);

const VIEWER_PERMISSIONS = Object.freeze([
  'dashboard:read',
  'devices:read',
  'servers:read',
  'reports:read',
  'alerts:read',
  'maintenance:read',
  'inventory:read',
  'markers:read',
  'diagrams:read',
  'settings:read',
  'engine:read',
  'ops:read',
]);

const OPERATOR_PERMISSIONS = Object.freeze([
  ...VIEWER_PERMISSIONS,
  'devices:write',
  'servers:write',
  // اپراتور فهرست و مدیریت اعتبارنامه‌ها را دارد، اما نمایش/خروجی رمز خام
  // پیش‌فرض نیست؛ این مجوز فقط با اعطای صریح مدیر به یک کاربر داده می‌شود.
  'credentials:read',
  'credentials:write',
  'alerts:write',
  'maintenance:write',
  'inventory:write',
  'markers:write',
  'diagrams:write',
  'engine:control',
  'ops:write',
  'probe:run',
  'system:health',
]);

const BY_ROLE = Object.freeze({
  admin: new Set(ALL_PERMISSIONS),
  operator: new Set(OPERATOR_PERMISSIONS),
  viewer: new Set(VIEWER_PERMISSIONS),
});

/**
 * مجوزهایی که می‌توان جدا از نقش، به یک کاربر مشخص داد. عمداً محدود است تا
 * «مجوز اختصاصی» به دری برای ارتقای سطح دسترسی (مثل users:manage) تبدیل نشود.
 */
export const DELEGABLE_PERMISSIONS = Object.freeze(['credentials:reveal']);

/** تبدیل ورودی/ستون JSON به فهرست مجوزهای معتبر و قابل‌اعطا */
export function normalizeExtraPermissions(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const allowed = new Set(DELEGABLE_PERMISSIONS);
  return [...new Set(list.map((item) => String(item)).filter((item) => allowed.has(item)))];
}

/** مجوزهای مؤثر یک کاربر: نقش + مجوزهای اختصاصی معتبر */
export function permissionsForUser(user) {
  const role = normalizeRole(user?.role);
  if (!role) return [];
  const extra = normalizeExtraPermissions(user?.extraPermissions ?? user?.extra_permissions);
  return [...new Set([...BY_ROLE[role], ...extra])];
}

/** پذیرش نام‌های رایج نقش و برگرداندن نام استاندارد؛ نامعتبر → null */
export function normalizeRole(role) {
  const value = String(role ?? '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrator') return ROLES.ADMIN;
  if (value === 'operator') return ROLES.OPERATOR;
  if (value === 'viewer') return ROLES.VIEWER;
  return null;
}

export function isValidRole(role) {
  return normalizeRole(role) !== null;
}

export function permissionsForRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return [];
  return [...BY_ROLE[normalized]];
}

export function hasPermission(user, permission) {
  const normalized = normalizeRole(user?.role);
  if (!normalized) return false;
  const needed = String(permission);
  if (BY_ROLE[normalized].has(needed)) return true;
  return normalizeExtraPermissions(user?.extraPermissions ?? user?.extra_permissions).includes(needed);
}

export function isAdmin(user) {
  return normalizeRole(user?.role) === ROLES.ADMIN;
}

function deny(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: message });
}

/**
 * میدل‌ور مجوز. پس از requireAuth اجرا می‌شود؛ نبود کاربر هم ۴۰۱ است تا
 * مسیرها در صورت جابه‌جایی ترتیب میدل‌ورها بی‌صدا باز نشوند.
 */
export function requirePermission(...permissions) {
  const needed = permissions.flat().filter(Boolean);
  return function permissionGuard(req, res, next) {
    if (!req.user) return deny(res, 401, 'برای دسترسی به این بخش باید وارد شوید.');
    if (needed.every((p) => hasPermission(req.user, p))) return next();
    return deny(res, 403, 'شما مجوز انجام این عملیات را ندارید.');
  };
}

/**
 * محافظ ماژول: GET/HEAD/Optional را با مجوز خواندن و بقیه را با مجوز نوشتن
 * می‌سنجد. برای مسیرهایی که استثنا دارند، مجوز دقیق‌تر در خود مسیر اضافه می‌شود.
 */
export function routePermission({ read, write }) {
  return function moduleGuard(req, res, next) {
    if (!req.user) return deny(res, 401, 'برای دسترسی به این بخش باید وارد شوید.');
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const permission = safe ? read : write;
    if (permission && hasPermission(req.user, permission)) return next();
    return deny(res, 403, 'شما مجوز انجام این عملیات را ندارید.');
  };
}

export default {
  ROLES,
  ROLE_LABELS,
  ALL_PERMISSIONS,
  DELEGABLE_PERMISSIONS,
  normalizeRole,
  isValidRole,
  permissionsForRole,
  permissionsForUser,
  normalizeExtraPermissions,
  hasPermission,
  isAdmin,
  requirePermission,
  routePermission,
};
