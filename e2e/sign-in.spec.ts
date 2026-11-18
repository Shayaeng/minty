import { expect, test } from '@playwright/test';

for (const status of [401, 403]) {
  test(`a ${status} sign-in refusal shows its reason instead of sample transactions and recovers after sign-in`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('minty_lock', JSON.stringify({ state: 'off' })));
    let refused = true;
    await page.route('**/transactions?*', route => refused
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: 'forbidden: email is not in ALLOWED_LOGINS' }) })
      : route.continue());
    await page.goto('/');
    await expect(page.locator('#banner')).toContainText('Minty refused this sign-in');
    await expect(page.locator('#banner')).toContainText('ALLOWED_LOGINS');
    await expect(page.locator('#feed')).toContainText('No transactions: Minty refused this sign-in');
    await expect(page.locator('#ownerSeg')).toBeHidden();
    await expect(page.locator('#totals')).toBeEmpty();
    await expect(page.locator('#banner')).not.toContainText('Showing sample data');
    refused = false;
    await page.reload();
    await expect(page.locator('#ownerSeg')).toBeVisible();
    await expect(page.locator('#feed')).toContainText('Nothing here yet');
    await expect(page.locator('#banner')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
