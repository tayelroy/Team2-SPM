import { Router, Request, Response } from 'express';
import { requireUser } from '../middleware/auth';
import { fetchProfile, updateProfile, Profile, ProfileUpdateInput } from '../db/profiles';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;
const VALID_CHANNELS = new Set(['email', 'sms', 'phone', 'none']);

export type ProfileValidation =
  | { valid: true; value: ProfileUpdateInput }
  | { valid: false; errors: string[] };

/**
 * Validates a profile update payload (SG2-27 AC: invalid contact details are
 * rejected with a message explaining why).
 */
export function validateProfileInput(body: unknown): ProfileValidation {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) {
    errors.push('Name is required.');
  }

  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!email || !EMAIL_RE.test(email)) {
    errors.push('Email address is not valid.');
  }

  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (!phone || !PHONE_RE.test(phone)) {
    errors.push('Phone number is not valid.');
  }

  let communicationPreferences: string[] = [];
  if (b.communication_preferences !== undefined) {
    const prefs = b.communication_preferences;
    const isValidList =
      Array.isArray(prefs) && prefs.every((c) => typeof c === 'string' && VALID_CHANNELS.has(c));
    if (!isValidList) {
      errors.push(`Communication preferences must be a list from: ${[...VALID_CHANNELS].join(', ')}.`);
    } else {
      communicationPreferences = prefs as string[];
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: { name, email, phone, communication_preferences: communicationPreferences } };
}

/**
 * Shapes the API response. Internal users additionally see their department
 * (SG2-27 AC); external users' responses omit the field entirely.
 */
function toResponseBody(profile: Profile, isInternal: boolean): Record<string, unknown> {
  const { id, name, email, phone, communication_preferences } = profile;
  const body: Record<string, unknown> = { id, name, email, phone, communication_preferences };
  if (isInternal) {
    body.department = profile.department ?? null;
  }
  return body;
}

router.get('/', requireUser, async (req: Request, res: Response) => {
  const result = await fetchProfile(req.user!.id);
  if (result.status === 'unavailable') {
    res.status(503).json({ error: 'Profile service is unavailable' });
    return;
  }
  if (result.status === 'not_found') {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  res.status(200).json(toResponseBody(result.profile, req.user!.isInternal));
});

router.put('/', requireUser, async (req: Request, res: Response) => {
  const validated = validateProfileInput(req.body);
  if (!validated.valid) {
    res.status(400).json({ error: 'Invalid profile details', details: validated.errors });
    return;
  }

  const result = await updateProfile(req.user!.id, validated.value);
  if (result.status === 'unavailable') {
    res.status(503).json({ error: 'Profile service is unavailable' });
    return;
  }
  if (result.status === 'not_found') {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  res.status(200).json(toResponseBody(result.profile, req.user!.isInternal));
});

export default router;
