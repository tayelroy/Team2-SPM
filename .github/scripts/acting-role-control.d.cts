import type { Page } from '@playwright/test';

declare const actingRoleControl: {
  roleControlKind(page: Page): Promise<'single' | 'native' | 'custom'>;
  getCurrentRole(page: Page): Promise<string>;
  getHeldRoles(page: Page): Promise<string[]>;
  selectActingRole(page: Page, role: string): Promise<boolean>;
};

export = actingRoleControl;
