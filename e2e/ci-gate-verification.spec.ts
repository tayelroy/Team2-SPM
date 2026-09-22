import { test, expect } from '@playwright/test';

// Temporary CI-REG-01 probe. Removed after verifying that CI blocks merging.
test('CI-REG-01 verification | deliberate browser assertion failure', () => {
  expect('intentional verification failure').toBe('restored');
});
