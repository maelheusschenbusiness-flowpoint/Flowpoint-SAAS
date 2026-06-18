/**
 * FlowPoint — DataForSEO REST client
 * Handles auth, retry, timeout for SERP, Local Pack, and Maps endpoints.
 */

import { logger } from "../logger.js";
import { TIMEOUTS, RETRY_CONFIG } from "../config.js";

const BASE_URL = 'https://api.dataforseo.com/v3';

function getCredentials(): { login: string; password: string } | null {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

function getAuthHeader(): string {
  const creds = getCredentials();
  if (!creds) return '';
  return 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
}

async function dfsFetch<T>(endpoint: string, body: unknown): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) {
    logger.warn('[DataForSEO] No credentials configured');
    throw new Error('DataForSEO credentials not configured');
  }

  const { maxAttempts, baseDelayMs, maxDelayMs } = RETRY_CONFIG.dataforseo;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUTS.dataforseo);
      try {
        const res = await fetch(`${BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status}`);
        return await res.json() as T;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        logger.warn({ attempt, delay }, '[DataForSEO] Retrying');
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  logger.error({ err: lastErr }, '[DataForSEO] All retries exhausted');
  throw lastErr;
}

export interface SERPResult {
  keyword: string; rank: number; url: string; title: string; domain: string;
}

export async function getSERPRanking(params: {
  keyword: string; locationCode?: number; languageCode?: string; domain: string;
}): Promise<SERPResult[]> {
  if (!getCredentials()) return [];
  try {
    const res = await dfsFetch<{ tasks?: Array<{ result?: Array<{ items?: Array<{ type: string; rank_absolute: number; url?: string; title?: string; domain?: string }> }> }> }>(
      '/serp/google/organic/live/advanced',
      [{ keyword: params.keyword, location_code: params.locationCode ?? 2250, language_code: params.languageCode ?? 'fr', device: 'desktop', os: 'windows', depth: 100 }]
    );
    const items = res.tasks?.[0]?.result?.[0]?.items ?? [];
    return items
      .filter(i => i.type === 'organic' && i.url?.includes(params.domain))
      .map(i => ({ keyword: params.keyword, rank: i.rank_absolute, url: i.url ?? '', title: i.title ?? '', domain: params.domain }));
  } catch (err) {
    logger.error({ err, keyword: params.keyword }, '[DataForSEO] SERP ranking failed');
    return [];
  }
}

export async function getLocalPack(params: {
  keyword: string; locationCode?: number; languageCode?: string;
}): Promise<Array<{ name: string; place_id: string; rating: number; reviews: number; rank: number }>> {
  if (!getCredentials()) return [];
  try {
    const res = await dfsFetch<{ tasks?: Array<{ result?: Array<{ items?: Array<{ type: string; title?: string; place_id?: string; rating?: number; rating_count?: number; rank_absolute: number }> }> }> }>(
      '/serp/google/local_pack/live/advanced',
      [{ keyword: params.keyword, location_code: params.locationCode ?? 2250, language_code: params.languageCode ?? 'fr' }]
    );
    const items = res.tasks?.[0]?.result?.[0]?.items ?? [];
    return items
      .filter(i => i.type === 'local_pack')
      .map(i => ({ name: i.title ?? '', place_id: i.place_id ?? '', rating: i.rating ?? 0, reviews: i.rating_count ?? 0, rank: i.rank_absolute }));
  } catch (err) {
    logger.error({ err }, '[DataForSEO] Local pack failed');
    return [];
  }
}

export async function getGeoGridRanking(params: {
  keyword: string; lat: number; lng: number; locationCode?: number;
}): Promise<number | null> {
  if (!getCredentials()) return null;
  try {
    const results = await getSERPRanking({ keyword: params.keyword, locationCode: params.locationCode, domain: '' });
    return results[0]?.rank ?? null;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return !!getCredentials();
}
