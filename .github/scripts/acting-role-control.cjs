const control = page => page.getByRole('banner').getByRole('combobox', { name: 'Acting as', exact: true });
const choices = page => page.getByRole('listbox', { name: 'Available roles', exact: true });
const unavailable = () => new Error('The requested acting role is not listed by this account.');

/** Shared staging can still serve the native control while a PR uses the custom one. */
async function roleControlKind(page) {
  const trigger = control(page);
  if (!await trigger.count()) return 'single';
  return await trigger.evaluate(element => element.tagName) === 'SELECT' ? 'native' : 'custom';
}

async function getCurrentRole(page) {
  const kind = await roleControlKind(page);
  if (kind === 'single') {
    return (await page.getByRole('banner').getByLabel('Your role', { exact: true }).innerText()).trim();
  }
  if (kind === 'native') {
    // SELECT.innerText contains every option, not the role currently selected.
    return control(page).evaluate(select => select.selectedOptions[0]?.label.trim() ?? '');
  }
  return (await control(page).innerText()).trim();
}

async function getHeldRoles(page) {
  const kind = await roleControlKind(page);
  if (kind === 'single') return [await getCurrentRole(page)];
  if (kind === 'native') {
    return control(page).locator('option').evaluateAll(options => options.map(option => option.label.trim()));
  }
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
  // Playwright dispatches a native change even when selectOption receives the
  // existing value. A no-op must preserve the screen, focus and permissions.
  if (await getCurrentRole(page) === role) return false;
  const kind = await roleControlKind(page);
  if (kind === 'single') throw unavailable();
  if (kind === 'native') {
    if (!(await getHeldRoles(page)).includes(role)) throw unavailable();
    await control(page).selectOption({ label: role });
    return true;
  }
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
