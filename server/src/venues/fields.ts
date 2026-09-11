export const TEXT_FIELDS = ['name', 'location', 'facilities', 'accessibility_features', 'operating_information'] as const;
export type VenueValues = Record<typeof TEXT_FIELDS[number], string> & { capacity: number };
export type VenueRecord = { venue_id: number; name: string } & {
  [Field in Exclude<keyof VenueValues, 'name'>]: VenueValues[Field] | null
};

/** Create and edit submit the complete record; unknown fields never reach storage. */
export function validateVenue(input: unknown): VenueValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (!TEXT_FIELDS.every(field => typeof body[field] === 'string' && (body[field] as string).trim())) return null;
  if (Array.from((body.name as string).trim()).length > 255) return null;
  if (!Number.isInteger(body.capacity) || (body.capacity as number) < 1 || (body.capacity as number) > 2147483647) return null;
  return {
    name: (body.name as string).trim(), location: (body.location as string).trim(),
    capacity: body.capacity as number, facilities: (body.facilities as string).trim(),
    accessibility_features: (body.accessibility_features as string).trim(),
    operating_information: (body.operating_information as string).trim()
  };
}
