import type { Page } from '@playwright/test';

declare const stagingPageReadiness: {
  waitForStagingContent(page: Page, options?: { timeoutMs?: number }): Promise<void>;
};

export = stagingPageReadiness;
