import { expect, test } from '@playwright/test';

test('loads: page title, Home screen and its two entry points', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Tincan');
  await expect(page.getByRole('heading', { name: 'Tincan', level: 1 })).toBeVisible();
  await expect(page.getByTestId('start-call')).toBeVisible();
  await expect(page.getByTestId('join-toggle')).toBeVisible();
});
