# Millennium Backloggd Play Session Sync Plugin Plan

## Context
Build a Millennium plugin for the Steam desktop client that detects game play sessions upon game exit, resolves the Steam game to its Backloggd counterpart, and automatically logs the session date and duration into the user's Backloggd calendar/journal. Since Backloggd has no public API, all sync operations work against reverse-engineered internal endpoints using an authenticated session cookie and CSRF token. The plugin provides automated syncing, offline retry queueing, in-client confirmation toasts, and a settings panel for auth, session thresholds, mapping adjustments, and queue management.

---

## Approach

### 1. Document Internal API Specs (`NOTES.md`)
- Target: `NOTES.md` at repository root.
- Action: Write the finalized reverse-engineered API documentation discovered during Step 1 recon, including:
  - Calendar storage model: `YYYY-MM-DD` date and integer `hours` + `minutes` duration (no hour:minute timestamps; FullCalendar `dayGridMonth` with `eventOverlap: false`).
  - Daily overlap policy: Multiple sessions on the same day must accumulate playtime (`hours += newHours, minutes += newMinutes`) into the existing `play_dates` entry rather than creating conflicting events.
  - Hierarchy: `game_log` -> `playthrough` -> `play_dates` (sessions cannot exist without a parent playthrough).
  - Endpoints, methods, headers (`Cookie: _backloggd_session`, `X-CSRF-Token`, `Accept`, `X-Requested-With`), and JSON request/response structures.

### 2. Scaffold Millennium Plugin Framework
- Target: `millennium.toml`, `package.json`, `tsconfig.json`, `backend/main.lua`.
- Action:
  - `millennium.toml`: Define plugin metadata (`id = "com.victoria.backloggd_sync"`, `name = "Backloggd Sync"`, `version = "1.0.0"`, `description = "Syncs Steam game sessions to Backloggd journal"`, backend entry `backend/main.lua`, frontend entry `frontend/index.tsx`, compiler output `output_path = "auto"`).
  - `package.json`: Configure dependencies (`@steambrew/starlight`, `@types/react: 19.1.1`, `@types/react-dom: 19.1.1`, `typescript`), build scripts (`"dev": "./node_modules/.bin/starlight watch"`, `"build": "./node_modules/.bin/starlight pack"`).
  - `tsconfig.json`: React JSX, ESNext modules, DOM + ESNext lib.
  - `backend/main.lua`: Standard lifecycle exports (`on_load`, `on_unload`, `on_frontend_loaded`).

### 3. Backloggd Reverse-Engineered Client Module (`frontend/backloggd_client.ts`)
- Target: `frontend/backloggd_client.ts`.
- Action: Create a dedicated API client isolating all direct HTTP communication with Backloggd.
- Types & Interfaces:
  ```typescript
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
    range_end_date: string;   // "YYYY-MM-DD" (next day)
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
  ```
- Methods:
  1. `validateSession(cookie: string): Promise<{ valid: boolean; userId?: string; username?: string; csrfToken?: string; error?: string }>`
     - Fetches `GET https://backloggd.com/` with `Cookie: _backloggd_session=${cookie}`.
     - Parses `<meta name="csrf-token" content="...">` and finds profile link `/u/([^/]+)/` or `user_id="(\d+)"`.
     - Returns parsed credentials or `valid: false` if redirected to `/users/sign_in` or HTTP != 200.
  2. `searchGame(title: string, session: BackloggdSession): Promise<GameSearchResult[]>`
     - Fetches `GET https://backloggd.com/search/autocomplete/?query=${encodeURIComponent(title)}`.
     - Headers: `Cookie`, `X-CSRF-Token`, `Accept: text/vnd.turbo-stream.html`, `X-Requested-With: XMLHttpRequest`.
     - Parses turbo-stream HTML for matching results: extracts `game_id`, `game-title`, `subtitle-text` (year), and cover image URL.
  3. `getGameLogStatus(gameId: string, session: BackloggdSession): Promise<GameLogStatus>`
     - Fetches `GET https://backloggd.com/log/edit/${gameId}`.
     - Headers: `Cookie`, `X-CSRF-Token`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest`.
     - If `most_recent_playthrough_id === null`: returns `isLogged: false`.
     - If logged: extracts `game_log.id`, `most_recent_playthrough_id`, playthrough details, and existing `play_dates`.
  4. `syncSession(params: { gameId: string; dateStr: string; durationSec: number; session: BackloggdSession }): Promise<{ success: boolean; error?: string }>`
     - Calls `getGameLogStatus(gameId, session)`.
     - Calculates session hours and minutes: `addHours = Math.floor(durationSec / 3600)`, `addMins = Math.round((durationSec % 3600) / 60)`. If `addHours === 0 && addMins === 0 && durationSec >= 60`, set `addMins = 1`.
     - Checks if a `play_date` already exists with `range_start_date === dateStr`.
       - If exists: accumulate playtime `targetEntry.hours += addHours`, `targetEntry.minutes += addMins`. If `minutes >= 60`, roll over: `targetEntry.hours += Math.floor(minutes / 60)`, `targetEntry.minutes = minutes % 60`. Set `targetEntry.edited = true`.
       - If does not exist: create new `PlayDateEntry` with `id: -1`, `range_start_date: dateStr`, `range_end_date: nextDayStr`, `hours: addHours`, `minutes: addMins`, `status: 5`, `edited: true`, `note: ""`, `start_date: null`, `finish_date: null`, `tags: []`.
     - Assembles POST payload:
       - If game was logged: uses existing `playthroughId` and `gameLogId`.
       - If game was unlogged: sets `log.id = null`, `log.status = "playing"`, `log.is_playing = true`, `playthroughs = [{ id: -1, title: "Windows PC", platform: 6, sync_sessions: true, hours_played: addHours, mins_played: addMins }]`, `dates = { "-1": [newEntry] }`.
     - Sends `POST https://backloggd.com/api/user/${session.userId}/log/${gameId}` (fallback `POST /native/log/${gameId}`).
     - Handles errors defensively: network exceptions, 401/403 session expiration, 423 lock, server errors.

### 4. Game Matching & Persistent Cache (`frontend/game_matcher.ts`)
- Target: `frontend/game_matcher.ts`.
- Action:
  - Cache Store: Use `localStorage.getItem("backloggd_steam_mappings")` (JSON map of `Record<number, { gameId: string; title: string; confirmed: boolean; autoMatched: boolean }>`).
  - Methods:
    - `resolveSteamGame(appId: number, session: BackloggdSession): Promise<{ gameId: string; title: string }>`:
      1. Check cache for `appId`. If found, return cached `gameId` and `title`.
      2. Fetch game title from `window.SteamClient.Apps.GetAppOverviewByAppID(appId)?.display_name`.
      3. Fallback if client API unavailable: `fetch("https://store.steampowered.com/api/appdetails?appids=" + appId)`.
      4. Clean game title (strip standard suffixes like `" - Steam Edition"`, trademark symbols `™`, `®`).
      5. Call `BackloggdClient.searchGame(cleanTitle, session)`.
      6. Match resolution:
         - Check for exact match (case-insensitive title comparison).
         - If no exact match, select first search result.
         - If search returns 0 results, throw `GameMatchNotFoundError`.
      7. Save match to local cache (`confirmed: false`, `autoMatched: true`).
      8. Return `{ gameId, title }`.
    - `getMappings()`, `updateMapping(appId, gameId, title)`, `deleteMapping(appId)`: helpers for settings management.

### 5. Game Lifecycle Monitor & Session Manager (`frontend/session_manager.ts`)
- Target: `frontend/session_manager.ts`.
- Action:
  - Hook into Steam's game lifecycle:
    ```typescript
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
      (data: { unAppID: number; bRunning: boolean; nInstanceID?: number }) => void
    )
    ```
  - State Tracking:
    - In-memory `activeSessions = new Map<number, { startTime: number; appId: number }>()`.
  - On Game Launch (`bRunning === true`):
    - Record `activeSessions.set(data.unAppID, { startTime: Date.now(), appId: data.unAppID })`.
  - On Game Exit (`bRunning === false`):
    - Retrieve session from `activeSessions`. If missing, ignore.
    - Compute `durationMs = Date.now() - session.startTime`.
    - Duration check: Retrieve `minDurationSec` from settings (default: 60s).
    - If `durationSec < minDurationSec`: Discard session (log info: "Session duration below threshold, skipping sync").
    - If `durationSec >= minDurationSec`:
      - Trigger `syncSession(appId, durationSec)`.
  - Retry Queue:
    - Stored in `localStorage.getItem("backloggd_sync_queue")` (`Array<{ id: string; appId: number; gameTitle?: string; dateStr: string; durationSec: number; attempts: number; lastError?: string; timestamp: number }>`).
    - If `syncSession` fails (network error, timeout), append session to queue and show failure toast.
    - Automatic drain: Attempt to process queue on plugin init, network online event, and successful sync of any game.
    - Manual drain: `drainQueue()` callable from Settings UI.

### 6. Notifications & Toasts (`frontend/notifications.ts`)
- Target: `frontend/notifications.ts`.
- Action:
  - Check availability of Steam's built-in notification APIs:
    `window.SteamClient?.Overlay?.ShowNotification` or `window.SteamClient?.Notifications?.ShowNotification`.
  - Fallback: Inject a lightweight animated toast overlay element into `#root` / `body` matching Steam client styling.
  - Toast types:
    - `showSyncSuccessToast(gameTitle: string, durationSec: number)`: e.g. "Logged 1h 25m of Hades to Backloggd".
    - `showSyncErrorToast(gameTitle: string, reason: string)`: e.g. "Backloggd sync failed for Hades (queued for retry)".
    - `showAuthExpiredToast()`: "Backloggd session expired. Click here to re-authenticate."

### 7. Settings UI & Management Panel (`frontend/settings.tsx`)
- Target: `frontend/settings.tsx`.
- Action: Render tabbed or sectional settings component in Millennium settings:
  1. **Authentication Section:**
     - Input field for `_backloggd_session` cookie (masked with reveal toggle).
     - "Test Connection & Save" button: triggers `validateSession(cookie)`.
     - Connection status indicator: Connected as `Victoria_` (UserID: `750057`) / Disconnected / Session Expired.
     - Clear session button.
  2. **Session Threshold Settings:**
     - Minimum session length slider/input (in seconds or minutes, default: 60s).
     - Checkbox: "Show sync confirmation toasts".
  3. **Game Mappings Management:**
     - Table listing cached Steam AppID -> Backloggd Game mappings.
     - Search / filter input.
     - Actions per row: "Edit Game ID" (allows manual slug/ID override) and "Delete Mapping" (forces re-search on next play).
  4. **Sync Queue & History:**
     - List of queued/failed sessions with failure reason and timestamp.
     - "Retry All Failed Sessions" button.
     - "Clear Queue" button.

### 8. Millennium Entrypoint (`frontend/index.tsx`)
- Target: `frontend/index.tsx`.
- Action:
  - Wire plugin initialization:
    - Load settings from storage.
    - Check Backloggd session validity.
    - Register `SteamClient.GameSessions.RegisterForAppLifetimeNotifications` hook.
    - Register window `online` event listener to auto-drain queue when connection returns.
    - Process any pending queued sessions from previous runs.
  - Export `definePlugin`:
    - Title: `"Backloggd Sync"`
    - Settings component: `<SettingsPanel />`
  - Unload cleanup:
    - Unregister lifetime notification listener.

---

## Critical Files & Anchors

1. `local://notes.md` (and working tree `NOTES.md`)
   - Region: Full document.
   - Reason: Source of truth for reverse-engineered Backloggd endpoints, CSRF handling, and FullCalendar data shapes.
2. `frontend/backloggd_client.ts`
   - Region: `syncSession` & `getGameLogStatus`.
   - Reason: Handles playthrough creation, daily playtime accumulation, and Rails POST payload generation.
3. `frontend/session_manager.ts`
   - Region: `RegisterForAppLifetimeNotifications` callback.
   - Reason: Detects game launch/exit, enforces minimum session duration, and triggers the sync or queue pipeline.
4. `frontend/game_matcher.ts`
   - Region: `resolveSteamGame`.
   - Reason: Maps Steam AppID to Backloggd `game_id` with local caching and search fallback.
5. `frontend/settings.tsx`
   - Region: Settings UI form controls.
   - Reason: User-facing panel for session cookie entry, threshold configuration, mapping overrides, and manual queue retry.

---

## Verification

### Automated Unit / Integration Smoke Tests
- Test Script: Node/Bun throwaway test runner (`test_client.ts`) exercising `BackloggdClient` against live Backloggd endpoints using Victoria_'s session cookie:
  1. `validateSession(cookie)`: Verify HTTP 200, valid session extracted, correct CSRF token and username `Victoria_`.
  2. `searchGame("Portal")`: Verify returned results include `gameId: "71"`, title `"Portal"`, release year `"2007"`.
  3. `getGameLogStatus("228539")`: Verify returns `isLogged: true`, valid playthrough ID `34704578`, and existing play dates.
  4. Session sync dry-run / live test:
     - Log a 5-minute session on a test game.
     - Verify response is HTTP 200 `{ ok: true }` or JSON response.
     - Re-fetch `/log/edit/:game_id` and confirm today's date contains the added duration.

### End-to-End Plugin Verification
1. Build Plugin: Run `bun run build` to verify `@steambrew/starlight` compiles TypeScript and pack bundles without errors.
2. Lifecycle Simulation:
   - Simulate `RegisterForAppLifetimeNotifications` event with `unAppID: 400`, `bRunning: true` -> verify session start recorded.
   - Simulate event with `unAppID: 400`, `bRunning: false` after 120s -> verify session duration calculated (2m).
   - Verify `game_matcher` maps AppID 400 to Portal (game_id 71).
   - Verify `syncSession` is invoked with correct date and 2m duration.
   - Verify toast displays: "Logged 2m of Portal to Backloggd".
3. Threshold Check:
   - Simulate launch and exit after 10s (below 60s default threshold) -> verify sync is skipped and no request is dispatched.
4. Offline / Failure Queue Check:
   - Simulate sync with invalid cookie or network offline -> verify session is placed into `queued_sessions`.
   - Call `drainQueue()` with restored connection -> verify queued session completes and is removed from queue.

---

## Assumptions & Contingencies

1. **Session Cookie Lifetime:**
   - *Assumption:* The `_backloggd_session` cookie lasts for several months unless the user explicitly logs out.
   - *Contingency:* If any sync request returns 401/403 or redirects to `/users/sign_in`, the plugin marks the session as expired, queues the failed session, and shows an actionable "Backloggd session expired - click to re-authenticate" toast.
2. **Backloggd Frontend Updates:**
   - *Assumption:* Backloggd endpoint URLs and Turbo-Stream DOM structures may change across site versions.
   - *Contingency:* All endpoints, selectors, and payload generators are strictly encapsulated in `frontend/backloggd_client.ts`. If an endpoint breaks, only that module needs updating without touching game detection, caching, or UI logic.
3. **Steam Client Internal API Availability:**
   - *Assumption:* `window.SteamClient.GameSessions.RegisterForAppLifetimeNotifications` is available in Millennium's CEF frontend environment.
   - *Contingency:* If `SteamClient.GameSessions` is not accessible in a future Steam build, the plugin logs an error, informs the user in settings, and falls back to polling running apps via `SteamClient.Apps` or Millennium backend process inspection.
