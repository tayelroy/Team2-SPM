/** Server-provided permissions for page controls. API routes enforce access separately. */
export interface Access {
  userId: string;
  role: string;
  permissions: string[];
}

export async function loadAccess(accessToken: string | null, signal?: AbortSignal): Promise<Access | null> {
  if (!accessToken) return null;
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Unable to load access permissions');
  const data = await response.json();
  if (!data || typeof data.userId !== 'string' || !data.userId ||
      typeof data.role !== 'string' || !data.role || !Array.isArray(data.permissions) ||
      !data.permissions.every((value: unknown) => typeof value === 'string')) {
    throw new Error('Invalid access response');
  }
  return { userId: data.userId, role: data.role, permissions: data.permissions };
}

export function can(access: Access | null | undefined, action: string): boolean {
  return access?.permissions.includes(action) ?? false;
}
