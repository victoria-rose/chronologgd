/**
 * Session Manager & Lifecycle Hook Module
 * Listens to Steam game launch/exit events, tracks durations, and manages sync queue.
 */

import { BackloggdClient } from './backloggd_client';
import type { BackloggdSession } from './backloggd_client';
import { GameMatcher } from './game_matcher';
import { NotificationManager } from './notifications';

export interface PluginSettings {
  cookie: string;
  csrfToken?: string;
  userId?: string;
  username?: string;
  minSessionSeconds: number;
  showToasts: boolean;
  autoRetryQueue: boolean;
}

export interface QueuedSession {
  id: string;
  appId: number;
  gameTitle: string;
  gameId?: string;
  dateStr: string;
  durationSec: number;
  attempts: number;
  lastError?: string;
  timestamp: number;
}

export interface SyncHistoryEntry {
  id: string;
  appId: number;
  gameTitle: string;
  gameId: string;
  dateStr: string;
  durationSec: number;
  timestamp: number;
  accumulated: boolean;
  success: boolean;
  error?: string;
}

interface LifetimeNotificationData {
  unAppID: number;
  bRunning: boolean;
  nInstanceID?: number;
}

interface LifetimeRegistration {
  unregister?: () => void;
}

interface GlobalSteamGameSessions {
  GameSessions?: {
    RegisterForAppLifetimeNotifications?: (
      callback: (data: LifetimeNotificationData) => void
    ) => LifetimeRegistration | undefined;
  };
}

export class SessionManager {
  public static readonly SETTINGS_KEY = 'backloggd_plugin_settings';
  public static readonly QUEUE_KEY = 'backloggd_sync_queue';
  public static readonly HISTORY_KEY = 'backloggd_sync_history';

  private static activeSessions = new Map<number, { startTime: number; appId: number }>();
  private static lifetimeRegistration: LifetimeRegistration | null = null;
  private static isDraining = false;
  public static notifyChange(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('backloggd_data_updated'));
    }
  }

  public static getSettings(): PluginSettings {
    const defaults: PluginSettings = {
      cookie: '',
      minSessionSeconds: 60,
      showToasts: true,
      autoRetryQueue: true,
    };

    try {
      const raw = localStorage.getItem(this.SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Partial<PluginSettings>;
        return {
          cookie: typeof p.cookie === 'string' ? p.cookie : defaults.cookie,
          csrfToken: typeof p.csrfToken === 'string' ? p.csrfToken : undefined,
          userId: typeof p.userId === 'string' ? p.userId : undefined,
          username: typeof p.username === 'string' ? p.username : undefined,
          minSessionSeconds:
            typeof p.minSessionSeconds === 'number' ? p.minSessionSeconds : defaults.minSessionSeconds,
          showToasts: typeof p.showToasts === 'boolean' ? p.showToasts : defaults.showToasts,
          autoRetryQueue:
            typeof p.autoRetryQueue === 'boolean' ? p.autoRetryQueue : defaults.autoRetryQueue,
        };
      }
    } catch {
      // Return defaults on parse error
    }

    return defaults;
  }

  public static saveSettings(settings: PluginSettings): void {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore
    }
  }

  public static getQueue(): QueuedSession[] {
    try {
      const raw = localStorage.getItem(this.QUEUE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as QueuedSession[];
      }
    } catch {
      // Ignore
    }
    return [];
  }

  public static saveQueue(queue: QueuedSession[]): void {
    try {
      localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
      this.notifyChange();
    } catch {
      // Ignore
    }
  }

  public static getHistory(): SyncHistoryEntry[] {
    try {
      const raw = localStorage.getItem(this.HISTORY_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as SyncHistoryEntry[];
      }
    } catch {
      // Ignore
    }
    return [];
  }

  public static appendHistory(entry: SyncHistoryEntry): void {
    const history = this.getHistory();
    history.unshift(entry);
    // Keep last 100 entries
    if (history.length > 100) {
      history.length = 100;
    }
    try {
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
      this.notifyChange();
    } catch {
      // Ignore
    }
  }

  public static clearHistory(): void {
    try {
      localStorage.removeItem(this.HISTORY_KEY);
      this.notifyChange();
    } catch {
      // Ignore
    }
  }

  public static clearQueue(): void {
    try {
      localStorage.removeItem(this.QUEUE_KEY);
      this.notifyChange();
    } catch {
      // Ignore
    }
  }

  /**
   * Register SteamClient AppLifetimeNotifications listener
   */
  public static initialize(): void {
    const globalWindow = window as unknown as { SteamClient?: GlobalSteamGameSessions };
    const gameSessions = globalWindow.SteamClient?.GameSessions;

    if (gameSessions?.RegisterForAppLifetimeNotifications) {
      try {
        this.lifetimeRegistration = gameSessions.RegisterForAppLifetimeNotifications(
          (data: LifetimeNotificationData) => {
            void this.handleLifetimeEvent(data);
          }
        ) || null;
      } catch (err: unknown) {
        console.warn('Failed to register SteamClient.GameSessions listener:', err);
      }
    } else {
      console.warn('SteamClient.GameSessions is not available in current environment');
    }

    // Auto-drain queue on network reconnect
    window.addEventListener('online', () => {
      void this.drainQueue();
    });

    // Auto-drain queue on startup
    void this.drainQueue();
  }

  /**
   * Cleanup listener on plugin unload
   */
  public static destroy(): void {
    if (this.lifetimeRegistration?.unregister) {
      try {
        this.lifetimeRegistration.unregister();
      } catch {
        // Ignore
      }
    }
    this.lifetimeRegistration = null;
    this.activeSessions.clear();
  }

  /**
   * Handle game start and exit events
   */
  public static async handleLifetimeEvent(data: LifetimeNotificationData): Promise<void> {
    const { unAppID, bRunning } = data;
    if (!unAppID) return;

    if (bRunning) {
      // Game Launch
      this.activeSessions.set(unAppID, {
        appId: unAppID,
        startTime: Date.now(),
      });

      // Background drain of previously queued sessions
      const settings = this.getSettings();
      if (settings.autoRetryQueue) {
        void this.drainQueue();
      }
    } else {
      // Game Exit
      const session = this.activeSessions.get(unAppID);
      if (!session) return;

      this.activeSessions.delete(unAppID);

      const elapsedSec = Math.floor((Date.now() - session.startTime) / 1000);
      const settings = this.getSettings();

      // Check minimum session threshold
      if (elapsedSec < settings.minSessionSeconds) {
        console.log(
          `Backloggd Sync: Skipped AppID ${unAppID}, duration (${elapsedSec}s) below threshold (${settings.minSessionSeconds}s)`
        );
        return;
      }

      await this.processSessionSync(unAppID, elapsedSec);
    }
  }

  /**
   * Sync a completed game session to Backloggd
   */
  public static async processSessionSync(
    appId: number,
    durationSec: number
  ): Promise<{ success: boolean; error?: string }> {
    const settings = this.getSettings();
    const dateStr = BackloggdClient.formatDate(new Date());

    // 1. Validate auth presence
    if (!settings.cookie) {
      const errorMsg = 'No Backloggd session configured';
      this.queueSession({
        id: `sess_${Date.now()}_${appId}`,
        appId,
        gameTitle: `App ${appId}`,
        dateStr,
        durationSec,
        attempts: 1,
        lastError: errorMsg,
        timestamp: Date.now(),
      });

      if (settings.showToasts) {
        NotificationManager.showAuthExpiredToast();
      }
      return { success: false, error: errorMsg };
    }

    const session: BackloggdSession = {
      cookie: BackloggdClient.normalizeCookie(settings.cookie),
      csrfToken: settings.csrfToken,
      userId: settings.userId,
      username: settings.username,
    };

    let gameTitle = `App ${appId}`;
    let gameId: string | undefined;

    try {
      // 2. Resolve Steam AppID to Backloggd Game ID
      const mapping = await GameMatcher.resolveGame(appId, session);
      gameTitle = mapping.backloggdTitle || mapping.steamTitle;
      gameId = mapping.gameId;

      // 3. Sync to Backloggd
      const result = await BackloggdClient.syncSession({
        gameId: mapping.gameId,
        durationSec,
        session,
      });

      // 4. Record history
      this.appendHistory({
        id: `hist_${Date.now()}_${appId}`,
        appId,
        gameTitle,
        gameId: mapping.gameId,
        dateStr,
        durationSec,
        timestamp: Date.now(),
        accumulated: !!result.accumulated,
        success: true,
      });

      // 5. Success Toast
      if (settings.showToasts) {
        NotificationManager.showSyncSuccessToast(gameTitle, durationSec);
      }

      // 6. Auto-drain queue
      if (settings.autoRetryQueue) {
        void this.drainQueue();
      }

      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Queue failed session for later retry
      this.queueSession({
        id: `sess_${Date.now()}_${appId}`,
        appId,
        gameTitle,
        gameId,
        dateStr,
        durationSec,
        attempts: 1,
        lastError: errorMsg,
        timestamp: Date.now(),
      });

      // Append failed attempt to history
      this.appendHistory({
        id: `hist_${Date.now()}_${appId}`,
        appId,
        gameTitle,
        gameId: gameId || '',
        dateStr,
        durationSec,
        timestamp: Date.now(),
        accumulated: false,
        success: false,
        error: errorMsg,
      });

      // Error Toast
      if (settings.showToasts) {
        NotificationManager.showSyncErrorToast(gameTitle, errorMsg);
      }

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Queue a failed session locally
   */
  private static queueSession(entry: QueuedSession): void {
    const queue = this.getQueue();
    queue.push(entry);
    this.saveQueue(queue);
  }

  /**
   * Drain and retry all queued sessions
   */
  public static async drainQueue(): Promise<{ total: number; succeeded: number; failed: number }> {
    if (this.isDraining) {
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const queue = this.getQueue();
    if (queue.length === 0) {
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const settings = this.getSettings();
    if (!settings.cookie) {
      return { total: queue.length, succeeded: 0, failed: queue.length };
    }

    this.isDraining = true;
    let succeeded = 0;
    let failed = 0;
    const remainingQueue: QueuedSession[] = [];

    const session: BackloggdSession = {
      cookie: BackloggdClient.normalizeCookie(settings.cookie),
      csrfToken: settings.csrfToken,
      userId: settings.userId,
      username: settings.username,
    };

    for (const item of queue) {
      try {
        let gameId = item.gameId;
        if (!gameId) {
          const mapping = await GameMatcher.resolveGame(item.appId, session);
          gameId = mapping.gameId;
        }

        const syncDate = new Date(item.dateStr);
        const result = await BackloggdClient.syncSession({
          gameId,
          durationSec: item.durationSec,
          date: isNaN(syncDate.getTime()) ? undefined : syncDate,
          session,
        });

        this.appendHistory({
          id: `hist_${Date.now()}_${item.appId}`,
          appId: item.appId,
          gameTitle: item.gameTitle,
          gameId,
          dateStr: item.dateStr,
          durationSec: item.durationSec,
          timestamp: Date.now(),
          accumulated: !!result.accumulated,
          success: true,
        });

        succeeded++;
        if (session.csrfToken && session.csrfToken !== settings.csrfToken) {
          settings.csrfToken = session.csrfToken;
          this.saveSettings(settings);
        }
      } catch (err: unknown) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        remainingQueue.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: errorMsg,
        });
      }
    }

    this.saveQueue(remainingQueue);
    this.isDraining = false;

    return { total: queue.length, succeeded, failed };
  }
}
