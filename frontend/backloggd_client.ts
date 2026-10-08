/**
 * Backloggd Client Module
 * Handles direct reverse-engineered communication with Backloggd's internal endpoints.
 */

export interface BackloggdSession {
  cookie: string;
  csrfToken?: string;
  userId?: string;
  username?: string;
}

export interface GameSearchResult {
  gameId: string;
  title: string;
  releaseYear: string;
  coverUrl?: string;
}

export interface PlayDateEntry {
  id: number;
  range_start_date: string; // "YYYY-MM-DD"
  range_end_date: string;   // "YYYY-MM-DD" (next day, FullCalendar exclusive end)
  hours: number;
  minutes: number;
  status: number | null;
  note: string;
  edited: boolean;
  start_date: string | null;
  finish_date: string | null;
  privacy: number | null;
  tags: string[];
}

export interface GameLogStatus {
  isLogged: boolean;
  gameLogId: number | null;
  playthroughId: number | null;
  playthroughTitle: string;
  hoursPlayed: number;
  minsPlayed: number;
  playDates: PlayDateEntry[];
}

export interface SyncResult {
  success: boolean;
  gameId: string;
  dateStr: string;
  hours: number;
  minutes: number;
  accumulated?: boolean;
  error?: string;
}

export class BackloggdClient {
  private static readonly BASE_URL = 'https://backloggd.com';
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  /**
   * BunnyCDN shield in front of backloggd.com rejects requests without
   * browser-like headers (403 + challenge page). Accept-Language is the
   * load-bearing one; include it on every request.
   */
  private static readonly SHIELD_HEADERS: Record<string, string> = {
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
  };

  /**
   * Format a Date into Backloggd's expected YYYY-MM-DD string format
   */
  public static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Calculate next day in YYYY-MM-DD (FullCalendar exclusive end date)
   */
  public static getNextDay(date: Date): string {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return this.formatDate(next);
  }

  /**
   * Parse CSRF token from HTML response
   */
  public static extractCsrfToken(html: string): string | null {
    const match = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }

  /**
   * Parse user profile info (username and user_id) from HTML
   */
  public static extractUserInfo(html: string): { username?: string; userId?: string } {
    let username: string | undefined;
    let userId: string | undefined;

    // 1. Logged-in user's navbar profile link: <a class="dropdown-item..." href="/u/Victoria_/">Profile</a>
    const profileMatch = html.match(/href=["']\/u\/([a-zA-Z0-9_-]+)\/["'][^>]*>Profile<\/a>/i);
    if (profileMatch) {
      username = profileMatch[1];
    }

    // 2. Mobile navbar "My Profile" link: <a href="/u/Victoria_">...My Profile</a>
    if (!username) {
      const myProfileMatch = html.match(/href=["']\/u\/([a-zA-Z0-9_-]+)["'][^>]*>\s*<i[^>]*><\/i>\s*My Profile/i);
      if (myProfileMatch) {
        username = myProfileMatch[1];
      }
    }

    // 3. Quick-logs element on user game cards: <a class="quick-logs..." username="Victoria_">
    if (!username) {
      const quickLogsMatch = html.match(/username=["']([a-zA-Z0-9_-]+)["']/i);
      if (quickLogsMatch) {
        username = quickLogsMatch[1];
      }
    }

    // Extract numeric user_id
    const uidMatch = html.match(/user_id=["'](\d+)["']/i);
    if (uidMatch) {
      userId = uidMatch[1];
    }

    return { username, userId };
  }
  /**
   * Normalize and sanitize raw cookie string from any user copy format.
   * Handles raw values, "Cookie: " headers, "_backloggd_session=" prefixes,
   * trailing semicolons, quotes, and URL-decoded values from browser DevTools.
   */
  public static normalizeCookie(raw: string): string {
    if (!raw) return '';
    let c = raw.trim();

    // Extract specifically _backloggd_session value if a full cookie header was pasted
    const sessionMatch = c.match(/(?:^|;\s*)_backloggd_session=([^;]+)/);
    if (sessionMatch) {
      c = sessionMatch[1].trim();
    } else {
      c = c.replace(/^(?:Cookie:\s*)?(?:_backloggd_session=)?/i, '');
      c = c.split(';')[0].trim();
    }

    // Strip surrounding quotes
    c = c.replace(/^["']|["']$/g, '').trim();

    // If cookie was copied URL-decoded from Chrome DevTools Application tab (has literal / or + and no %)
    if (!c.includes('%') && (c.includes('/') || c.includes('+') || c.includes('='))) {
      c = encodeURIComponent(c);
    }

    return c;
  }
  /**
   * Serialize nested object to application/x-www-form-urlencoded (matching jQuery $.param)
   */
  public static toFormData(obj: unknown, prefix = ''): string {
    if (!obj || typeof obj !== 'object') return '';
    const parts: string[] = [];

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const item = obj[i];
        if (item !== null && typeof item === 'object') {
          parts.push(this.toFormData(item, `${prefix}[${i}]`));
        } else if (item !== undefined && item !== null) {
          parts.push(`${encodeURIComponent(`${prefix}[]`)}=${encodeURIComponent(String(item))}`);
        }
      }
    } else {
      const rec = obj as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        const val = rec[key];
        const propName = prefix ? `${prefix}[${key}]` : key;

        if (val !== null && typeof val === 'object') {
          parts.push(this.toFormData(val, propName));
        } else if (val !== undefined && val !== null) {
          parts.push(`${encodeURIComponent(propName)}=${encodeURIComponent(String(val))}`);
        } else if (val === null) {
          parts.push(`${encodeURIComponent(propName)}=`);
        }
      }
    }

    return parts.filter(Boolean).join('&');
  }

  /**
   * Universal HTTP fetch: uses backend.httpRequest (Millennium libcurl) if running
   * inside Steam CEF (bypassing browser Cookie header stripping), with fallback to fetch.
   */
  public static async request(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<{ status: number; text: () => Promise<string>; json: () => Promise<unknown>; ok: boolean; headers: Headers }> {
    const globalBackend =
      typeof backend !== 'undefined'
        ? backend
        : (window as unknown as { backend?: typeof backend }).backend;
    const mergedHeaders: Record<string, string> = { ...BackloggdClient.SHIELD_HEADERS, ...(options.headers || {}) };

    if (globalBackend?.httpRequest) {
      try {
        const headersJson = JSON.stringify(mergedHeaders);
        const rawResp = await globalBackend.httpRequest(
          url,
          options.method || 'GET',
          headersJson,
          options.body || null
        );

        interface RpcResponseData {
          status: number;
          body: string;
          headers?: Record<string, string>;
          error?: string;
        }

        let resp: RpcResponseData;
        if (typeof rawResp === 'string') {
          resp = JSON.parse(rawResp) as RpcResponseData;
        } else if (rawResp && typeof rawResp === 'object') {
          const obj = rawResp as Record<string, unknown>;
          resp = {
            status: typeof obj.status === 'number' ? obj.status : Number(obj.status) || 0,
            body: typeof obj.body === 'string' ? obj.body : '',
            headers: typeof obj.headers === 'object' && obj.headers ? (obj.headers as Record<string, string>) : undefined,
            error: typeof obj.error === 'string' ? obj.error : undefined,
          };
        } else {
          throw new Error('Invalid backend response: ' + String(rawResp));
        }
        const ok = typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300;
        return {
          status: resp.status || 0,
          ok,
          text: async () => resp.body || '',
          json: async () => JSON.parse(resp.body || '{}'),
          headers: new Headers(resp.headers || {}),
        };
      } catch (err: unknown) {
        console.warn('backend.httpRequest call failed, falling back to fetch:', err);
      }
    }

    // Fallback to native fetch (e.g. unit tests / Bun / Node)
    const res = await fetch(url, { ...options, headers: mergedHeaders });
    return {
      status: res.status,
      ok: res.ok,
      text: () => res.text(),
      json: () => res.json(),
      headers: res.headers,
    };
  }


  /**
   * Fetch a fresh CSRF token from Backloggd homepage
   */
  public static async fetchFreshCsrfToken(cookie: string): Promise<string | null> {
    const cleanCookie = this.normalizeCookie(cookie);
    try {
      const res = await this.request(`${this.BASE_URL}/`, {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Cookie': `_backloggd_session=${cleanCookie}`,
        },
      });
      if (res.ok) {
        const html = await res.text();
        return this.extractCsrfToken(html);
      }
    } catch {
      // Ignore network errors on background token refresh
    }
    return null;
  }


  /**
   * Validate session cookie and retrieve CSRF token and user metadata
   */
  public static async validateSession(
    cookie: string
  ): Promise<{ valid: boolean; userId?: string; username?: string; csrfToken?: string; error?: string }> {
    if (!cookie || !cookie.trim()) {
      return { valid: false, error: 'Session cookie is empty' };
    }

    const cleanCookie = this.normalizeCookie(cookie);
    try {
      // 1. Fetch main page to verify authentication and get initial CSRF
      const res = await this.request(`${this.BASE_URL}/`, {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Cookie': `_backloggd_session=${cleanCookie}`,
        },
      });

      if (res.status === 403) {
        return { valid: false, error: 'Backloggd blocked the request (403 bot check). Update the plugin — or retry; the shield sometimes clears on a second attempt.' };
      }
      if (res.status !== 200) {
        return { valid: false, error: `Backloggd returned status ${res.status}` };
      }

      const html = await res.text();
      if (html.includes('bunny-shield') || html.includes('Establishing a secure connection')) {
        return { valid: false, error: 'Backloggd showed a bot check instead of the site. Retry — the shield usually clears on a second attempt.' };
      }

      // Check if redirected to sign in or if user is unauthenticated
      if (html.includes('/users/sign_in') && !html.includes('/u/')) {
        return { valid: false, error: 'Session expired or invalid (redirected to login)' };
      }

      const csrfToken = this.extractCsrfToken(html);
      if (!csrfToken) {
        return { valid: false, error: 'Failed to extract CSRF token from Backloggd' };
      }

      const { username, userId } = this.extractUserInfo(html);

      // If user_id wasn't on front page, fetch user's journal page where it is always embedded
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        try {
          const settingsRes = await this.request(`${this.BASE_URL}/settings/`, {
            headers: {
              'User-Agent': this.USER_AGENT,
              'Cookie': `_backloggd_session=${cleanCookie}`,
            },
          });
          if (settingsRes.ok) {
            const settingsHtml = await settingsRes.text();
            const settingsInfo = this.extractUserInfo(settingsHtml);
            if (settingsInfo.userId) {
              resolvedUserId = settingsInfo.userId;
            }
          }
        } catch {
          // Fallback to native endpoint if user_id is absent
        }
      }

      return {
        valid: true,
        csrfToken,
        username,
        userId: resolvedUserId,
      };
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return { valid: false, error: errorMsg || 'Network error while contacting Backloggd' };
    }
  }

  /**
   * Search Backloggd games using the internal autocomplete turbo-stream endpoint
   */
  public static async searchGame(
    title: string,
    session: BackloggdSession
  ): Promise<GameSearchResult[]> {
    const cleanCookie = this.normalizeCookie(session.cookie);
    const url = `${this.BASE_URL}/search/autocomplete/?query=${encodeURIComponent(title.trim())}`;

    const headers: Record<string, string> = {
      'User-Agent': this.USER_AGENT,
      'Cookie': `_backloggd_session=${cleanCookie}`,
      'Accept': 'text/vnd.turbo-stream.html',
      'X-Requested-With': 'XMLHttpRequest',
    };

    if (session.csrfToken) {
      headers['X-CSRF-Token'] = session.csrfToken;
    }

    const res = await this.request(url, { headers });
    if (!res.ok) {
      throw new Error(`Backloggd search returned status ${res.status}`);
    }

    const html = await res.text();
    const results: GameSearchResult[] = [];

    // Parse each result block from the turbo-stream HTML
    // Pattern: <a href="/native/log/edit/{game_id}" class="d-contents">...<p class="mb-0 game-title">{title}</p>...<p class="subtitle-text mb-0">{year}</p>
    const itemRegex =
      /<a\s+href=["']\/native\/log\/edit\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const gameId = match[1];
      const block = match[2];

      const titleMatch = block.match(/<p\s+class=["'][^"']*game-title[^"']*["']>([^<]+)<\/p>/i);
      const yearMatch = block.match(/<p\s+class=["'][^"']*subtitle-text[^"']*["']>([^<]*)<\/p>/i);
      const coverMatch = block.match(/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["']/i);

      if (titleMatch) {
        results.push({
          gameId,
          title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
          releaseYear: yearMatch ? yearMatch[1].trim() : '',
          coverUrl: coverMatch ? coverMatch[1] : undefined,
        });
      }
    }

    return results;
  }

  /**
   * Check if a game is already logged and fetch existing playthroughs & play dates
   */
  public static async getGameLogStatus(
    gameId: string,
    session: BackloggdSession
  ): Promise<GameLogStatus> {
    const cleanCookie = this.normalizeCookie(session.cookie);
    const url = `${this.BASE_URL}/log/edit/${gameId}`;

    const headers: Record<string, string> = {
      'User-Agent': this.USER_AGENT,
      'Cookie': `_backloggd_session=${cleanCookie}`,
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };

    if (session.csrfToken) {
      headers['X-CSRF-Token'] = session.csrfToken;
    }

    let res = await this.request(url, { headers });

    // If unauthorized or rejected, attempt one refresh with a fresh CSRF token.
    // Retry whenever the token is missing OR stale (differs from what we sent).
    if (res.status === 401 || res.status === 403 || res.status === 422) {
      const freshCsrf = await this.fetchFreshCsrfToken(cleanCookie);
      if (freshCsrf && freshCsrf !== headers['X-CSRF-Token']) {
        session.csrfToken = freshCsrf;
        headers['X-CSRF-Token'] = freshCsrf;
        res = await this.request(url, { headers });
      }
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Backloggd session expired or unauthorized (status: ${res.status}). Update session cookie in settings.`);
      }
      throw new Error(`Failed to fetch log status for game ${gameId}, status: ${res.status}`);
    }
    interface RawPlaythrough {
      title?: string;
      hours_played?: number;
      mins_played?: number;
      play_dates?: PlayDateEntry[];
    }
    interface RawLogEditResponse {
      most_recent_playthrough_id?: number | string | null;
      game_log?: { id?: number };
      playthroughs?: Record<string, RawPlaythrough>;
    }
    const data = (await res.json()) as RawLogEditResponse;
    const mostRecentPlaythroughId = data.most_recent_playthrough_id;
    if (!mostRecentPlaythroughId || !data.playthroughs || !data.playthroughs[mostRecentPlaythroughId]) {
      return {
        isLogged: false,
        gameLogId: data.game_log?.id ?? null,
        playthroughId: null,
        playthroughTitle: 'Windows PC',
        hoursPlayed: 0,
        minsPlayed: 0,
        playDates: [],
      };
    }

    const pt = data.playthroughs[mostRecentPlaythroughId];
    return {
      isLogged: true,
      gameLogId: data.game_log?.id ?? null,
      playthroughId: Number(mostRecentPlaythroughId),
      playthroughTitle: pt.title || 'Windows PC',
      hoursPlayed: Number(pt.hours_played) || 0,
      minsPlayed: Number(pt.mins_played) || 0,
      playDates: Array.isArray(pt.play_dates) ? pt.play_dates : [],
    };
  }

  /**
   * Log or accumulate a play session to Backloggd's calendar/journal
   */
  public static async syncSession(params: {
    gameId: string;
    durationSec: number;
    session: BackloggdSession;
    date?: Date;
    /** Pre-formatted YYYY-MM-DD; preferred for queued retries (avoids UTC round-trip shift). */
    dateStr?: string;
    note?: string;
  }): Promise<SyncResult> {
    const { gameId, durationSec, session, note } = params;
    const dateStr = params.dateStr || this.formatDate(params.date || new Date());
    const sessionDate = params.date || (params.dateStr ? new Date(`${params.dateStr}T12:00:00`) : new Date());
    const nextDayStr = this.getNextDay(sessionDate);

    // Calculate hours and minutes from duration
    let addHours = Math.floor(durationSec / 3600);
    let addMins = Math.round((durationSec % 3600) / 60);

    // If duration >= 60 seconds but rounded to 0 minutes, grant at least 1 minute
    if (addHours === 0 && addMins === 0 && durationSec >= 60) {
      addMins = 1;
    }

    // 1. Fetch existing log status
    const logStatus = await this.getGameLogStatus(gameId, session);

    let playthroughId: number;
    let playthroughTitle: string;
    let existingDates: PlayDateEntry[] = [];
    let isNewLog = false;
    let accumulated = false;
    let finalSessionHours = addHours;
    let finalSessionMins = addMins;

    if (logStatus.isLogged && logStatus.playthroughId) {
      playthroughId = logStatus.playthroughId;
      playthroughTitle = logStatus.playthroughTitle || 'Windows PC';
      existingDates = [...logStatus.playDates];

      // Check if a session entry already exists for today on this playthrough
      const existingDateIdx = existingDates.findIndex(
        (d) => d.range_start_date === dateStr
      );

      if (existingDateIdx !== -1) {
        // Accumulate onto today's existing session entry
        const existing = existingDates[existingDateIdx];
        const totalMinutes =
          (Number(existing.hours) || 0) * 60 +
          (Number(existing.minutes) || 0) +
          addHours * 60 +
          addMins;

        finalSessionHours = Math.floor(totalMinutes / 60);
        finalSessionMins = totalMinutes % 60;

        existingDates[existingDateIdx] = {
          ...existing,
          hours: finalSessionHours,
          minutes: finalSessionMins,
          edited: true,
          note: note ? (existing.note ? `${existing.note}; ${note}` : note) : existing.note,
        };
        accumulated = true;
      } else {
        // Create new date entry for today
        existingDates.push({
          id: -(existingDates.length + 1),
          range_start_date: dateStr,
          range_end_date: nextDayStr,
          hours: addHours,
          minutes: addMins,
          status: 5,
          note: note || '',
          edited: true,
          start_date: null,
          finish_date: null,
          privacy: null,
          tags: [],
        });
      }
    } else {
      // New log creation for unlogged game
      isNewLog = true;
      playthroughId = -1;
      playthroughTitle = 'Windows PC';
      existingDates = [
        {
          id: -1,
          range_start_date: dateStr,
          range_end_date: nextDayStr,
          hours: addHours,
          minutes: addMins,
          status: 5,
          note: note || '',
          edited: true,
          start_date: null,
          finish_date: null,
          privacy: null,
          tags: [],
        },
      ];
    }

    // Filter only edited dates for the dates dictionary
    const editedDates = existingDates.filter((d) => d.edited);

    // Compute total hours & minutes for playthrough
    let totalMinsAll = 0;
    for (const d of existingDates) {
      totalMinsAll += (Number(d.hours) || 0) * 60 + (Number(d.minutes) || 0);
    }
    const ptHours = Math.floor(totalMinsAll / 60);
    const ptMins = totalMinsAll % 60;

    // Assembles POST payload
    const payload = {
      game_id: Number(gameId),
      playthroughs: [
        {
          id: playthroughId,
          title: playthroughTitle,
          platform: 6, // 6 = Windows PC
          rating: 0,
          sync_sessions: true,
          hours_played: ptHours,
          mins_played: ptMins,
        },
      ],
      dates: {
        [String(playthroughId)]: editedDates,
      },
      log: {
        id: isNewLog ? null : logStatus.gameLogId,
        status: 'playing',
        is_play: false,
        is_playing: true,
        is_backlog: false,
        is_wishlist: false,
        game_liked: false,
      },
      deleted_dates: {},
      deleted_playthroughs: [],
      deleted_library_entries: [],
      deleted_edition_time_entries: [],
      modal_type: 'full',
    };

    // Determine target URL
    const saveUrl = session.userId
      ? `${this.BASE_URL}/api/user/${session.userId}/log/${gameId}`
      : `${this.BASE_URL}/native/log/${gameId}`;

    const cleanCookie = this.normalizeCookie(session.cookie);
    const headers: Record<string, string> = {
      'User-Agent': this.USER_AGENT,
      'Cookie': `_backloggd_session=${cleanCookie}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    };

    if (session.csrfToken) {
      headers['X-CSRF-Token'] = session.csrfToken;
    }

    let res = await this.request(saveUrl, {
      method: 'POST',
      headers,
      body: this.toFormData(payload),
    });

    // If CSRF expired or unauthorized, attempt one refresh and retry
    if (res.status === 422 || (!res.ok && (res.status === 401 || res.status === 403))) {
      const freshCsrf = await this.fetchFreshCsrfToken(cleanCookie);
      if (freshCsrf && freshCsrf !== headers['X-CSRF-Token']) {
        session.csrfToken = freshCsrf;
        headers['X-CSRF-Token'] = freshCsrf;
        res = await this.request(saveUrl, {
          method: 'POST',
          headers,
          body: this.toFormData(payload),
        });
      }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error('Backloggd session expired or unauthorized (401/403)');
      }
      throw new Error(`Failed to save log to Backloggd: HTTP ${res.status} - ${errText.slice(0, 150)}`);
    }

    return {
      success: true,
      gameId,
      dateStr,
      hours: finalSessionHours,
      minutes: finalSessionMins,
      accumulated,
    };
  }
}
