export const LAYOUTS = ['classroom', 'theatre', 'boardroom', 'banquet', 'exhibition', 'other'] as const;
export type Layout = typeof LAYOUTS[number];
export interface VenueLayoutValues { layout: Layout; other_description?: string }
export type VenueLayoutRecord = { layout: Layout; other_description: string | null };

/** The full set submitted for a venue: one entry per supported layout, 'other'
 * carrying a short description. Matches the venue_layouts table's own
 * consistency check (SG2-43). */
export function validateVenueLayouts(input: unknown): VenueLayoutValues[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<Layout>();
  const result: VenueLayoutValues[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const body = item as Record<string, unknown>;
    if (typeof body.layout !== 'string' || !(LAYOUTS as readonly string[]).includes(body.layout)) return null;
    const layout = body.layout as Layout;
    if (seen.has(layout)) return null;
    seen.add(layout);
    if (layout === 'other') {
      if (typeof body.other_description !== 'string' || !body.other_description.trim()) return null;
      if (Array.from(body.other_description.trim()).length > 255) return null;
      result.push({ layout, other_description: body.other_description.trim() });
    } else {
      if (body.other_description !== undefined && body.other_description !== null) return null;
      result.push({ layout });
    }
  }
  return result;
}
