import packageJson from '../../../package.json';

/** نسخه از package.json خوانده می‌شود تا با فوتر و بستهٔ انتشار هم‌گام بماند. */
export const APP_VERSION = String(packageJson.version ?? '0.0.0');
