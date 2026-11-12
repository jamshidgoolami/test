import { test, expect, type Page } from '@playwright/test';

/**
 * Regression برای ماژول دیاگرام پس از تفکیک Overview/Canvas:
 *   • باز شدن بوم، افزودن جزء و واگرد/ازنو
 *   • ذخیره و بازیابی پس از Reload
 *   • نقشهٔ ارتباط، ساخت پیوند و پاک‌نشدن بوم هنگام ورود دوباره
 */

const ADMIN = { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD || 'E2ePass!2345' };
const RUN = Date.now().toString(36).slice(-5);

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN.username);
  await page.fill('#password', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

async function api<T = unknown>(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(
    async ({ method, path, data }) => {
      const match = document.cookie.match(/(?:^|;\s*)nw_csrf=([^;]+)/);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (match) headers['X-CSRF-Token'] = decodeURIComponent(match[1]);
      const res = await fetch(path, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { method, path, data }
  ) as Promise<{ status: number; body: T }>;
}

async function createDiagram(page: Page, name: string) {
  const res = await api<{ id: number; name: string }>(page, 'POST', '/api/diagrams', { name });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body;
}

test('diagram canvas edits survive undo/redo, save and reload', async ({ page }) => {
  await login(page);
  const diagram = await createDiagram(page, `آزمون بوم ${RUN}`);

  await page.goto(`/diagrams/${diagram.id}`);
  await expect(page.getByRole('heading', { name: diagram.name })).toBeVisible();
  await page.getByRole('group', { name: 'حالت نمایش' }).getByRole('button', { name: 'ویرایش' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'ابزارهای دیاگرام' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'مستطیل', exact: true }).click();

  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  await pane.click({ position: { x: 320, y: 220 } });

  const summary = page.locator('p').filter({ hasText: 'جزء' }).first();
  await expect(summary).toContainText('۱ جزء');

  await page.keyboard.press('Control+z');
  await expect(summary).toContainText('۰ جزء');
  await page.keyboard.press('Control+y');
  await expect(summary).toContainText('۱ جزء');

  await page.keyboard.press('Control+s');
  await expect(page.getByText(/ذخیره‌شده/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: diagram.name })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'جزء' }).first()).toContainText('۱ جزء');
});

test('diagram overview lists diagrams, creates a link and reopens the canvas', async ({ page }) => {
  await login(page);
  const source = await createDiagram(page, `مبدأ ${RUN}`);
  const target = await createDiagram(page, `مقصد ${RUN}`);

  await page.goto(`/diagrams/${source.id}`);
  await page.getByRole('button', { name: 'نقشهٔ ارتباط' }).click();

  const overview = page.getByRole('dialog', { name: 'نقشهٔ ارتباط دیاگرام‌ها' });
  await expect(overview).toBeVisible();
  await expect(overview.getByText(source.name).first()).toBeVisible();
  await expect(overview.getByText(target.name).first()).toBeVisible();

  await overview.getByRole('group', { name: 'حالت نقشهٔ ارتباط' }).getByRole('button', { name: 'ویرایش' }).click();
  await overview.getByRole('button', { name: 'پیوند تازه' }).click();
  await overview.getByLabel('دیاگرام مبدأ').selectOption(String(source.id));
  await overview.getByLabel('دیاگرام مقصد').selectOption(String(target.id));
  await overview.getByRole('button', { name: /ساخت پیوند/ }).click();

  await expect(overview.getByText(/۱ پیوند/).first()).toBeVisible();
  await expect(page.getByText(/متصل شد/).first()).toBeVisible();

  await overview.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(overview).toBeHidden();
  await expect(page.getByRole('heading', { name: source.name })).toBeVisible();
});
