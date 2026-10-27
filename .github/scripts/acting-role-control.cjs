const control = page => page.getByRole('banner').getByRole('combobox', { name: 'Acting as', exact: true });
const choices = page => page.getByRole('listbox', { name: 'Available roles', exact: true });
const unavailable = () => new Error('The requested acting role is not listed by this account.');

/** Current multi-role switcher, or the unchanged single-role header. */
async function roleControlKind(page) {
  const trigger = control(page);
  if (!await trigger.count()) return 'single';
  return 'custom';
}

async function getCurrentRole(page) {
  const kind = await roleControlKind(page);
  if (kind === 'single') {
    return (await page.getByRole('banner').getByLabel('Your role', { exact: true }).innerText()).trim();
  }
  return (await control(page).innerText()).trim();
}

async function getHeldRoles(page) {
  const kind = await roleControlKind(page);
  if (kind === 'single') return [await getCurrentRole(page)];
  const trigger = control(page);
  const listbox = choices(page);
  try {
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await listbox.waitFor({ state: 'visible' });
    return (await listbox.getByRole('option').allTextContents()).map(label => label.trim());
  } finally {
    if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.press('Escape');
  }
}

async function selectActingRole(page, role) {
  // A no-op must preserve the screen, focus and permissions.
  if (await getCurrentRole(page) === role) return false;
  const kind = await roleControlKind(page);
  if (kind === 'single') throw unavailable();
  const trigger = control(page);
  const listbox = choices(page);
  try {
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await listbox.waitFor({ state: 'visible' });
    const option = listbox.getByRole('option', { name: role, exact: true });
    if (await option.count() !== 1) throw unavailable();
    await option.click();
    return true;
  } finally {
    if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.press('Escape');
  }
}

module.exports = { roleControlKind, getCurrentRole, getHeldRoles, selectActingRole };
