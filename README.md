# Chronologgd 🎮 📖

> A **Millennium** plugin for Steam that automatically logs your game play sessions directly to your **Backloggd** calendar and journal when you close a game.

---

## ✨ Features

- **Automated Session Tracking**: Detects game launches and exits via Steam's client lifecycle hooks. Calculates your exact playtime and automatically logs it upon closing the game.
- **Backloggd Calendar & Journal Sync**: Creates journal entries with the session date and duration (hours + minutes).
- **Daily Playtime Accumulation**: Automatically respects Backloggd's calendar model—multiple sessions played on the same calendar day accumulate into a single combined session rather than creating colliding entries.
- **Smart Game Matching**: Automatically maps Steam AppIDs to the correct Backloggd game entries using Backloggd's internal search and local caching.
- **Offline & Error Retry Queue**: Lost internet connection or Backloggd maintenance? Unsynced sessions are automatically queued locally and retried upon launching your next game or via manual retry in settings.
- **In-Client Notifications**: Sleek Steam-styled toast alerts confirm whenever a session has been successfully logged (or queued).
- **Native Libcurl Backend Proxy**: Bypasses browser CEF cookie restrictions by dispatching authenticated requests through Millennium's native backend.
- **Millennium Settings Drawer**:
  - Session cookie configuration with connection status indicator.
  - Interactive step-by-step cookie retrieval guide.
  - Configurable minimum session threshold (e.g. ignore accidental launches under 30s).
  - Searchable game mapping manager with manual Backloggd ID overrides.
  - Queue manager with manual retry and sync history log.

---

## 🚀 Installation & Setup

### Prerequisites
- [Millennium](https://steambrew.app/) installed on Steam.
- [Bun](https://bun.sh/) (or Node.js).

### Building from Source

1. Clone this repository:
   ```bash
   git clone https://github.com/victoria-rose/chronologgd.git
   cd chronologgd
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build and install into Millennium:
   ```bash
   bun run build
   ```
   *Starlight will compile the plugin bundle (`.star`) and automatically install it into your Steam client plugins directory.*

---

## 🔑 Backloggd Authentication

Backloggd has no public OAuth API, so Chronologgd authenticates using your browser session cookie:

1. Log into [backloggd.com](https://backloggd.com) in your web browser (Chrome, Edge, Brave, or Firefox).
2. Press `F12` (or right-click anywhere $\to$ **Inspect**).
3. Switch to the **Application** tab (**Storage** tab in Firefox).
4. In the left sidebar, expand **Cookies** $\to$ click `https://backloggd.com`.
5. Double-click the **Value** of `_backloggd_session` and copy it.
6. Open Millennium's plugin drawer in Steam, navigate to **Backloggd Sync**, paste your cookie, and click **Save & Connect**.

---

## 🛠️ Tech Stack

- **Framework**: [Millennium](https://github.com/SteamClientHomebrew/Millennium) (v3.4+)
- **Frontend**: React 19, TypeScript, Steam CEF integration
- **Backend**: Lua, libcurl HTTP proxy, `@ffi` RPC bridge
- **Compiler**: `@steambrew/starlight`

---

## 📄 License

MIT © [Victoria Rose](https://github.com/victoria-rose)
