import { randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';

// The random part of a plan's public link: 12 hex characters
export function newShareToken(): string {
  return randomBytes(6).toString('hex');
}

export function isShareToken(value: string): boolean {
  return /^[0-9a-f]{12}$/.test(value);
}

// Gives a plan saved before share tokens existed its token. Returns it, or null if
// there's no such plan or it already has one. Conditional on the column being empty,
// so two requests at once can't each hand out a different link.
export async function claimShareToken(id: number): Promise<string | null> {
  const [claimed] = await db
    .update(calculations)
    .set({ shareToken: newShareToken() })
    .where(and(eq(calculations.id, id), isNull(calculations.shareToken)))
    .returning({ shareToken: calculations.shareToken });
  return claimed?.shareToken ?? null;
}

// The plan's token, created if it has none yet. Null if there's no such plan.
export async function ensureShareToken(id: number): Promise<string | null> {
  const claimed = await claimShareToken(id);
  if (claimed) return claimed;
  const [row] = await db
    .select({ shareToken: calculations.shareToken })
    .from(calculations)
    .where(eq(calculations.id, id))
    .limit(1);
  return row?.shareToken ?? null;
}
