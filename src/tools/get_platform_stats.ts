import { entiaClient } from '../client.js';
import type { PlatformStats } from '../types/entity.js';

/**
 * Get real-time ENTIA platform statistics.
 * Public endpoint — no API key required. Cached for 1 hour server-side.
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  return entiaClient.get<PlatformStats>('/api/v1/stats/live');
}
