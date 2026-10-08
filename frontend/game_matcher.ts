/**
 * Game Matcher & Local Cache Module
 * Maps Steam AppIDs to Backloggd Game IDs with persistent caching and fuzzy matching.
 */

import { BackloggdClient } from './backloggd_client';
import type { BackloggdSession, GameSearchResult } from './backloggd_client';

export interface CachedGameMapping {
  appId: number;
  gameId: string;
  steamTitle: string;
  backloggdTitle: string;
  releaseYear?: string;
  coverUrl?: string;
  confirmed: boolean;
  autoMatched: boolean;
  lastUsed: number;
}

interface SteamOverviewResult {
  display_name?: string;
}

interface GlobalSteamClient {
  Apps?: {
    GetAppOverviewByAppID?: (appId: number) => SteamOverviewResult | undefined;
  };
}

export class GameMatcher {
  public static readonly STORAGE_KEY = 'backloggd_steam_mappings';

  /**
   * Clean titles by removing common distribution noise (trademarks, editions, suffixes)
   */
  public static cleanGameTitle(rawTitle: string): string {
    return rawTitle
      .replace(/[™®©]/g, '')
      .replace(/\s*-\s*(?:Digital\s+)?(?:Deluxe|Collector's|Definitive|Game of the Year|GOTY|Enhanced|Special|Director's Cut|Remastered|Edition).*$/i, '')
      .replace(/\s*\((?:Standard|Deluxe|Definitive|Collector's|Enhanced|Remastered|GOTY)\s+Edition\)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Retrieve all saved mappings from localStorage
   */
  public static getStoredMappings(): Record<number, CachedGameMapping> {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<number, CachedGameMapping>;
      }
    } catch {
      // Ignore parse failure, return empty map
    }
    return {};
  }

  /**
   * Save mappings to localStorage
   */
  public static saveStoredMappings(mappings: Record<number, CachedGameMapping>): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(mappings));
    } catch {
      // Ignore storage write failure
    }
  }

  /**
   * Query game title from Steam Client CEF or fallback to public Steam Store API
   */
  public static async fetchSteamGameTitle(appId: number): Promise<string | null> {
    // 1. In-client CEF check: SteamClient.Apps.GetAppOverviewByAppID
    const globalWindow = window as unknown as { SteamClient?: GlobalSteamClient };
    const steamClient = globalWindow.SteamClient;
    if (steamClient?.Apps?.GetAppOverviewByAppID) {
      try {
        const overview = steamClient.Apps.GetAppOverviewByAppID(appId);
        if (overview?.display_name) {
          return overview.display_name.trim();
        }
      } catch {
        // Fall back to Store API
      }
    }

    // 2. Steam Store AppDetails API fallback
    try {
      const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
      if (res.ok) {
        const json: unknown = await res.json();
        if (json && typeof json === 'object') {
          const key = String(appId);
          if (key in json) {
            const appEntry = (json as Record<string, unknown>)[key];
            if (appEntry && typeof appEntry === 'object' && 'data' in appEntry) {
              const dataVal = appEntry.data;
              if (dataVal && typeof dataVal === 'object' && 'name' in dataVal && typeof dataVal.name === 'string') {
                return dataVal.name.trim();
              }
            }
          }
        }
      }
    } catch {
      // Ignore network error on fallback
    }

    return null;
  }

  /**
   * Find the best match among Backloggd search results for a given target title.
   * Only exact and prefix matches are confident enough to auto-cache: substring
   * matches and the top result are often the wrong game ("Doom" vs "Doom Eternal"),
   * and a wrong auto-match silently logs every future session to the wrong title.
   * Returns null when nothing is confident — the caller must ask for manual mapping.
   */
  public static selectBestMatch(
    targetTitle: string,
    results: GameSearchResult[]
  ): GameSearchResult | null {
    if (!results || results.length === 0) return null;

    const normalizedTarget = targetTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Exact normalized match
    for (const r of results) {
      const normalizedResult = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedResult === normalizedTarget) {
        return r;
      }
    }

    // 2. Prefix match
    for (const r of results) {
      const normalizedResult = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedResult.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedResult)) {
        return r;
      }
    }

    // 3. No confident match — do NOT fall back to substring/top result.
    return null;
  }

  /**
   * Resolve a Steam AppID to a Backloggd Game ID using cache, Steam API, and Backloggd search
   */
  public static async resolveGame(
    appId: number,
    session: BackloggdSession
  ): Promise<CachedGameMapping> {
    const mappings = this.getStoredMappings();

    // 1. Cache hit
    if (mappings[appId]) {
      const existing = mappings[appId];
      existing.lastUsed = Date.now();
      this.saveStoredMappings(mappings);
      return existing;
    }

    // 2. Get Steam Title
    const steamTitle = (await this.fetchSteamGameTitle(appId)) || `Steam App ${appId}`;
    const cleanTitle = this.cleanGameTitle(steamTitle);

    // 3. Search Backloggd
    let results = await BackloggdClient.searchGame(cleanTitle, session);
    if (results.length === 0 && cleanTitle !== steamTitle) {
      results = await BackloggdClient.searchGame(steamTitle, session);
    }

    if (results.length === 0) {
      throw new Error(`No matching game found on Backloggd for "${steamTitle}" (AppID: ${appId})`);
    }

    // 4. Pick best match — null means ambiguous, queue for manual mapping instead of guessing
    const bestMatch = this.selectBestMatch(cleanTitle, results);
    if (!bestMatch) {
      const candidates = results.slice(0, 3).map((r) => `"${r.title}"`).join(', ');
      throw new Error(`Ambiguous Backloggd match for "${steamTitle}" (AppID: ${appId}), candidates: ${candidates}. Set the mapping manually in settings.`);
    }

    // 5. Store in cache
    const mapping: CachedGameMapping = {
      appId,
      gameId: bestMatch.gameId,
      steamTitle,
      backloggdTitle: bestMatch.title,
      releaseYear: bestMatch.releaseYear,
      coverUrl: bestMatch.coverUrl,
      confirmed: false,
      autoMatched: true,
      lastUsed: Date.now(),
    };

    mappings[appId] = mapping;
    this.saveStoredMappings(mappings);

    return mapping;
  }

  /**
   * Manually override or confirm a game mapping in settings
   */
  public static setManualMapping(
    appId: number,
    gameId: string,
    backloggdTitle: string,
    steamTitle?: string
  ): CachedGameMapping {
    const mappings = this.getStoredMappings();
    const existing = mappings[appId];

    const updated: CachedGameMapping = {
      appId,
      gameId,
      steamTitle: steamTitle || existing?.steamTitle || `Steam App ${appId}`,
      backloggdTitle,
      releaseYear: existing?.releaseYear,
      coverUrl: existing?.coverUrl,
      confirmed: true,
      autoMatched: false,
      lastUsed: Date.now(),
    };

    mappings[appId] = updated;
    this.saveStoredMappings(mappings);
    return updated;
  }

  /**
   * Delete a cached mapping so it will be re-resolved next time
   */
  public static deleteMapping(appId: number): void {
    const mappings = this.getStoredMappings();
    if (appId in mappings) {
      delete mappings[appId];
      this.saveStoredMappings(mappings);
    }
  }

  /**
   * Clear all mappings from localStorage
   */
  public static clearAllMappings(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}
