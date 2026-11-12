import assert from 'node:assert/strict';
import { test, expect, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD || 'E2ePass!2345' };

async function login(page: Page, creds = ADMIN) {
  await page.goto('/login');
  await page.fill('#username', creds.username);
  await page.fill('#password', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test('map page renders the interactive map container', async ({ page }) => {
  await login(page);
  await page.goto('/map');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
});

test('map keeps zoom, pan, one instance and its layer panel across navigation', async ({ page }) => {
  await login(page);
  await page.goto('/map');
  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible({ timeout: 30_000 });

  const scale = page.locator('.leaflet-control-scale-line');
  const beforeZoom = await scale.textContent();
  await page.locator('.leaflet-control-zoom-in').click();
  await expect.poll(() => scale.textContent(), { timeout: 10_000 }).not.toBe(beforeZoom);

  const pin = page.locator('.leaflet-marker-icon').first();
  await expect(pin).toBeVisible();
  const beforePan = await pin.boundingBox();
  assert(beforePan, 'map marker has a layout box');
  const box = await map.boundingBox();
  assert(box, 'map has a layout box');
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75 - 90, box.y + box.height * 0.75 - 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await pin.boundingBox())?.x, { timeout: 10_000 }).not.toBe(beforePan.x);

  await page.getByRole('button', { name: 'لایه‌های نقشه' }).click();
  await expect(page.locator('#map-layers-panel')).toBeVisible();
  await page.getByRole('button', { name: 'بستن پنل لایه‌ها' }).click();
  await expect(page.locator('#map-layers-panel')).toHaveCount(0);

  await page.goto('/devices');
  await page.goto('/map');
  await expect(page.locator('.leaflet-container')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.leaflet-control-zoom')).toHaveCount(1);
});

test('map loads without any external network request', async ({ page }) => {
  const external = new Set<string>();
  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if (url.protocol !== 'data:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.add(url.origin);
    } catch {
      /* data: URLs and non-URL requests are local */
    }
  });

  await login(page);
  await page.goto('/map');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
  assert.deepEqual([...external], [], 'the map must not require internet access');
});
