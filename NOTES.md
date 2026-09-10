# Backloggd Calendar/Journal Reconnaissance & Architecture Notes

## 1. Executive Summary & Core Recon Findings

### Date vs Timestamp Support
- **Backloggd's calendar DOES NOT store start/end hour:minute timestamps.**
- It stores **date (`YYYY-MM-DD`) + duration (`hours` and `minutes`)**.
- The calendar interface is powered by FullCalendar (`dayGridMonth`) with `allDay: true`.
- Each calendar event maps to a `play_date` object with:
  - `range_start_date`: `"YYYY-MM-DD"` (e.g., `"2026-09-09"`)
  - `range_end_date`: `"YYYY-MM-DD"` (e.g., `"2026-09-10"` - FullCalendar all-day events have exclusive end dates, so 1 day later)
  - `hours`: integer duration in hours
  - `minutes`: integer duration in minutes (0-59)
  - `status`: integer/null (status code, default 5)
  - `note`: string (optional notes)
  - `edited`: boolean (`true` when modified/new)
  - `start_date`: `"YYYY-MM-DD"` (optional flag if this session marks start of playthrough)
  - `finish_date`: `"YYYY-MM-DD"` (optional flag if this session marks completion)
  - `privacy`: integer/null
  - `tags`: array of string tags
- **Daily Overlap Constraint:** FullCalendar is configured with `eventOverlap: false`. Each day in a playthrough can only have **one** session entry. When logging multiple sessions on the same calendar day, playtime must be **accumulated** into the existing date entry (`hours += sessionHours`, `minutes += sessionMinutes`) rather than creating a duplicate entry.

### Log & Playthrough Association
- **A session entry is TIED to a playthrough within a game log.** It cannot exist independently without a parent game log and playthrough.
- Data hierarchy:
  `Game Log` (per game, tracks general status: `playing`, `played`, `backlog`, `wishlist`, `rating`, `game_liked`)
    └── `Playthrough` (tracks specific run, platform e.g. Windows PC = 6, storefront e.g. Steam = 1, title, sync_sessions)
          └── `Play Dates` (the journal entries for specific calendar days)
- If the user already has a log for a game, we fetch the existing playthrough ID and append/merge the new date entry.
- If the user has not logged the game, we create the initial `game_log` (status: `"playing"`), a new `playthrough` (id: `-1`, title: `"Windows PC"`, platform: `6`, sync_sessions: `true`), and attach the `play_date` entry (id: `-1`).

### Date and Timezone Handling
- Date strings are local calendar dates in `YYYY-MM-DD` format (generated client-side via `year + '-' + pad(month) + '-' + pad(day)`).
- No timezone offsets or time strings (no ISO timestamps like `T14:30:00Z`).

---

## 2. Reverse-Engineered Backloggd Endpoints

### A. Authentication
- **Session Cookie:** `_backloggd_session` (HTTP cookie passed in request headers).
- **CSRF Token:** `X-CSRF-Token` header.
  - Can be obtained by parsing `<meta name="csrf-token" content="...">` from any authenticated GET request (such as `GET /` or `GET /u/:username/journal/`).
- **Session Validation:**
  - `GET https://backloggd.com/` with cookie.
  - Check if status is 200 and page HTML contains user profile link `/u/:username/` and CSRF meta tag. If redirected to `/users/sign_in` or 401/403, session has expired.

### B. Game Lookup & Search
- **Endpoint:** `GET https://backloggd.com/search/autocomplete/?query={encodeURIComponent(gameTitle)}`
- **Headers:**
  - `Cookie: _backloggd_session={cookie}`
  - `X-CSRF-Token: {csrfToken}`
  - `Accept: text/vnd.turbo-stream.html`
  - `X-Requested-With: XMLHttpRequest`
- **Response Format:** Turbo-Stream HTML fragment containing matching games:
  ```html
  <a href="/native/log/edit/{game_id}" class="d-contents">
    <div class="row native-search-result">
      <div class="card mx-auto game-cover" game_id="{game_id}">
        <img class="card-img height" src="{cover_url}" alt="{title}">
      </div>
      <p class="mb-0 game-title">{title}</p>
      <p class="subtitle-text mb-0">{release_year}</p>
    </div>
  </a>
  ```
- **Parsing:**
  - Extract each result: `game_id` (numeric string), `title` (text), `year` (text), and `cover_url`.
  - Exact match on `title.toLowerCase().trim() === cleanTitle.toLowerCase().trim()`, or fallback to top result.

### C. Game Log Status Check
- **Endpoint:** `GET https://backloggd.com/log/edit/{game_id}`
- **Headers:**
  - `Cookie: _backloggd_session={cookie}`
  - `X-CSRF-Token: {csrfToken}`
  - `Accept: application/json`
  - `X-Requested-With: XMLHttpRequest`
- **Response Shape (Unlogged Game):**
  ```json
  {
    "playthroughs": {},
    "most_recent_playthrough_id": null
  }
  ```
- **Response Shape (Logged Game):**
  ```json
  {
    "game_log": {
      "id": 88373072,
      "status": "playing",
      "rating": 0,
      "is_play": false,
      "is_playing": true,
      "is_backlog": false,
      "is_wishlist": false,
      "game_liked": false,
      "time_source": 1,
      "total_hours": 0,
      "total_minutes": 0,
      "override_cover_id": null,
      "last_edited_at": null
    },
    "playthroughs": {
      "34704578": {
        "id": 34704578,
        "title": "Windows PC",
        "platform": 6,
        "sync_sessions": true,
        "hours_played": 2,
        "mins_played": 15,
        "play_dates": [
          {
            "id": 12403919,
            "range_start_date": "2026-09-09",
            "range_end_date": "2026-09-10",
            "hours": 1,
            "minutes": 30,
            "status": null,
            "note": "",
            "edited": false,
            "start_date": null,
            "finish_date": null,
            "privacy": null,
            "tags": []
          }
        ]
      }
    },
    "most_recent_playthrough_id": 34704578
  }
  ```

### D. Create or Update Log & Session Entry
- **Endpoint:** `POST https://backloggd.com/api/user/{user_id}/log/{game_id}`
  (Alternative if `user_id` is unknown: `POST https://backloggd.com/native/log/{game_id}`)
- **Headers:**
  - `Cookie: _backloggd_session={cookie}`
  - `X-CSRF-Token: {csrfToken}`
  - `Content-Type: application/x-www-form-urlencoded; charset=UTF-8` (or `application/json`)
  - `Accept: application/json, text/javascript`
  - `X-Requested-With: XMLHttpRequest`
- **Request Body (JSON / URL-encoded):**
  ```json
  {
    "game_id": 71,
    "playthroughs": [
      {
        "id": 34704578,
        "title": "Windows PC",
        "platform": 6,
        "rating": 0,
        "sync_sessions": true,
        "hours_played": 2,
        "mins_played": 45
      }
    ],
    "dates": {
      "34704578": [
        {
          "id": 12403919,
          "range_start_date": "2026-09-09",
          "range_end_date": "2026-09-10",
          "hours": 2,
          "minutes": 45,
          "status": 5,
          "note": "",
          "edited": true,
          "start_date": null,
          "finish_date": null,
          "privacy": null,
          "tags": []
        }
      ]
    },
    "log": {
      "id": 88373072,
      "status": "playing",
      "is_play": false,
      "is_playing": true,
      "is_backlog": false,
      "is_wishlist": false,
      "game_liked": false
    },
    "deleted_dates": {},
    "deleted_playthroughs": [],
    "deleted_library_entries": [],
    "deleted_edition_time_entries": [],
    "modal_type": "full"
  }
  ```
- **New Playthrough / New Game ID Conventions:**
  - When creating a log for a game that wasn't logged before:
    - `log.id`: `null`
    - `playthrough.id`: `-1`
    - `dates["-1"][0].id`: `-1`
    - `playthrough.title`: `"Windows PC"`
    - `playthrough.platform`: `6`
    - `log.status`: `"playing"`
    - `log.is_playing`: `true`

---

## 3. Platform & Storefront Reference IDs
- **Platform 6:** Windows PC (slug: `win`)
- **Platform -1:** Steam Deck (slug: `steam-deck`)
- **Platform 3:** Linux (slug: `linux`)
- **Storefront 1:** Steam (`valid_platform_ids: [6]`)

---

## 4. Steam Client Lifecycle Hook Details (Millennium)
- **API:** `SteamClient.GameSessions.RegisterForAppLifetimeNotifications`
- **Listener Signature:**
  ```typescript
  const registration = SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
    (data: { unAppID: number; bRunning: boolean; nInstanceID?: number }) => {
      if (data.bRunning) {
        // Game launched
      } else {
        // Game exited
      }
    }
  );
  // Cleanup on unload: registration.unregister()
  ```
- **App Name Resolution:**
  1. `window.SteamClient.Apps.GetAppOverviewByAppID(appId)?.display_name`
  2. Fallback: `https://store.steampowered.com/api/appdetails?appids=${appId}` (`data[appId].data.name`)
- **Millennium Plugin Structure:**
  - `millennium.toml`: manifest configuration
  - `package.json`: build scripts (`@steambrew/starlight pack`)
  - `frontend/index.tsx`: Millennium frontend entrypoint (`definePlugin`)
  - Settings panel rendered inside Millennium settings tab.
