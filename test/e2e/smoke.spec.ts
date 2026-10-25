import { expect, test } from '@playwright/test';

test('page title and app name', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Tincan');
  await expect(page.getByTestId('app-name')).toHaveText('Tincan');
});
