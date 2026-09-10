/**
 * Settings & Management Panel Component
 * User interface for Backloggd authentication, mapping overrides, and retry queue.
 * Optimized for Millennium's slide-out drawer panel.
 */

import React, { useEffect, useState } from 'react';
import { BackloggdClient } from './backloggd_client';
import { GameMatcher } from './game_matcher';
import type { CachedGameMapping } from './game_matcher';
import { NotificationManager } from './notifications';
import { SessionManager } from './session_manager';
import type { PluginSettings, QueuedSession, SyncHistoryEntry } from './session_manager';

export const SettingsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'auth' | 'mappings' | 'queue' | 'history'>('auth');
  const [settings, setSettings] = useState<PluginSettings>(SessionManager.getSettings());
  const [cookieInput, setCookieInput] = useState<string>(settings.cookie || '');
  const [showCookie, setShowCookie] = useState<boolean>(false);
  const [testingAuth, setTestingAuth] = useState<boolean>(false);
  const [showCookieHelp, setShowCookieHelp] = useState<boolean>(false);
  const [authStatusMessage, setAuthStatusMessage] = useState<{
    type: 'success' | 'error' | 'idle';
    text: string;
  }>({
    type: settings.username ? 'success' : 'idle',
    text: settings.username
      ? `Connected: ${settings.username} (${settings.userId || 'ID ok'})`
      : 'Not connected',
  });

  // Mappings state
  const [mappings, setMappings] = useState<Record<number, CachedGameMapping>>(
    GameMatcher.getStoredMappings()
  );
  const [mappingSearch, setMappingSearch] = useState<string>('');
  const [editingAppId, setEditingAppId] = useState<number | null>(null);
  const [editGameIdInput, setEditGameIdInput] = useState<string>('');
  const [editTitleInput, setEditTitleInput] = useState<string>('');

  // Queue and History state
  const [queue, setQueue] = useState<QueuedSession[]>(SessionManager.getQueue());
  const [history, setHistory] = useState<SyncHistoryEntry[]>(SessionManager.getHistory());
  const [drainingQueue, setDrainingQueue] = useState<boolean>(false);

  useEffect(() => {
    const refresh = () => {
      setMappings(GameMatcher.getStoredMappings());
      setQueue(SessionManager.getQueue());
      setHistory(SessionManager.getHistory());
    };

    refresh();
    window.addEventListener('backloggd_data_updated', refresh);
    return () => {
      window.removeEventListener('backloggd_data_updated', refresh);
    };
  }, [activeTab]);

  const handleSaveCookie = async () => {
    const trimmed = cookieInput.trim();
    if (!trimmed) {
      setAuthStatusMessage({ type: 'error', text: 'Cookie input cannot be empty' });
      return;
    }

    setTestingAuth(true);
    const normalized = BackloggdClient.normalizeCookie(trimmed);
    const result = await BackloggdClient.validateSession(normalized);
    setTestingAuth(false);

    if (result.valid) {
      const updated: PluginSettings = {
        ...settings,
        cookie: normalized,
        csrfToken: result.csrfToken,
        userId: result.userId,
        username: result.username,
      };
      setSettings(updated);
      setCookieInput(normalized);
      SessionManager.saveSettings(updated);
      setAuthStatusMessage({
        type: 'success',
        text: `Connected: ${result.username || 'User'} (${result.userId || 'ID ok'})`,
      });
      NotificationManager.showToast('success', 'Backloggd Connected', `Authenticated as ${result.username}`);
      // Auto-drain any queued sessions with the new authenticated session
      void SessionManager.drainQueue().then((drainRes) => {
        setQueue(SessionManager.getQueue());
        setHistory(SessionManager.getHistory());
        if (drainRes.succeeded > 0) {
          NotificationManager.showToast('success', 'Backloggd Sync', `Synced ${drainRes.succeeded} queued session(s)`);
        }
      });
    } else {
      setAuthStatusMessage({
        type: 'error',
        text: result.error || 'Invalid session cookie',
      });
    }
  };

  const handleClearAuth = () => {
    const updated: PluginSettings = {
      ...settings,
      cookie: '',
      csrfToken: undefined,
      userId: undefined,
      username: undefined,
    };
    setSettings(updated);
    setCookieInput('');
    SessionManager.saveSettings(updated);
    setAuthStatusMessage({ type: 'idle', text: 'Not connected' });
  };

  const handleSaveThresholds = (updates: Partial<PluginSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    SessionManager.saveSettings(updated);
  };

  const handleSaveEditMapping = (appId: number) => {
    if (!editGameIdInput.trim()) return;
    GameMatcher.setManualMapping(
      appId,
      editGameIdInput.trim(),
      editTitleInput.trim() || `Game ${editGameIdInput}`
    );
    setMappings(GameMatcher.getStoredMappings());
    setEditingAppId(null);
  };

  const handleDeleteMapping = (appId: number) => {
    GameMatcher.deleteMapping(appId);
    setMappings(GameMatcher.getStoredMappings());
  };

  const handleDrainQueue = async () => {
    setDrainingQueue(true);
    const res = await SessionManager.drainQueue();
    setDrainingQueue(false);
    setQueue(SessionManager.getQueue());
    setHistory(SessionManager.getHistory());

    if (res.succeeded > 0) {
      NotificationManager.showToast(
        'success',
        'Queue Retried',
        `Synced ${res.succeeded} of ${res.total} sessions`
      );
    } else if (res.failed > 0) {
      NotificationManager.showToast(
        'error',
        'Queue Retry Failed',
        `${res.failed} sessions could not be synced`
      );
    }
  };

  const filteredMappings = Object.values(mappings).filter((m) => {
    const q = mappingSearch.toLowerCase();
    return (
      m.steamTitle.toLowerCase().includes(q) ||
      m.backloggdTitle.toLowerCase().includes(q) ||
      String(m.appId).includes(q) ||
      m.gameId.includes(q)
    );
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '14px',
        color: '#c7d5e0',
        fontFamily: '"Motiva Sans", "Segoe UI", system-ui, sans-serif',
        width: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            minWidth: '28px',
            borderRadius: '6px',
            backgroundColor: '#ea377a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '16px',
          }}
        >
          B
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, color: '#ffffff', fontSize: '15px', fontWeight: 600, lineHeight: 1.2 }}>
            Backloggd Sync
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#8f98a0', lineHeight: 1.3 }}>
            Auto-log Steam sessions to journal
          </p>
        </div>
      </div>

      {/* Tab Navigation: 2x2 Segmented Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '5px',
          backgroundColor: '#12181f',
          padding: '4px',
          borderRadius: '6px',
          boxSizing: 'border-box',
        }}
      >
        {[
          { id: 'auth', label: 'Settings' },
          { id: 'mappings', label: `Games (${Object.keys(mappings).length})` },
          { id: 'queue', label: `Queue (${queue.length})` },
          { id: 'history', label: 'History' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as 'auth' | 'mappings' | 'queue' | 'history')}
            style={{
              backgroundColor: activeTab === t.id ? '#2a475e' : 'transparent',
              color: activeTab === t.id ? '#ffffff' : '#8f98a0',
              border: 'none',
              padding: '7px 4px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: activeTab === t.id ? 600 : 500,
              cursor: 'pointer',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'background-color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Auth & Preferences */}
      {activeTab === 'auth' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: '6px',
              backgroundColor:
                authStatusMessage.type === 'success'
                  ? 'rgba(46, 204, 113, 0.1)'
                  : authStatusMessage.type === 'error'
                  ? 'rgba(231, 76, 60, 0.1)'
                  : '#1b2838',
              border: `1px solid ${
                authStatusMessage.type === 'success'
                  ? '#27ae60'
                  : authStatusMessage.type === 'error'
                  ? '#e74c3c'
                  : '#2a3f5a'
              }`,
              boxSizing: 'border-box',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  minWidth: '8px',
                  borderRadius: '50%',
                  backgroundColor:
                    authStatusMessage.type === 'success'
                      ? '#2ecc71'
                      : authStatusMessage.type === 'error'
                      ? '#e74c3c'
                      : '#8f98a0',
                }}
              />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {authStatusMessage.text}
              </span>
            </div>
            {settings.cookie && (
              <button
                type="button"
                onClick={handleClearAuth}
                style={{
                  background: 'transparent',
                  border: '1px solid #c0392b',
                  color: '#e74c3c',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Disconnect
              </button>
            )}
          </div>

          {/* Cookie Input */}
          <div
            style={{
              backgroundColor: '#1b2838',
              borderRadius: '6px',
              padding: '14px',
              border: '1px solid #2a3f5a',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              boxSizing: 'border-box',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <h3 style={{ margin: 0, fontSize: '13px', color: '#ffffff', fontWeight: 600 }}>
                    Backloggd Session Cookie
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCookieHelp(!showCookieHelp)}
                    title="Click for step-by-step guide on how to get your session cookie"
                    style={{
                      backgroundColor: showCookieHelp ? '#ea377a' : '#2a475e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '50%',
                      width: '18px',
                      height: '18px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                      padding: 0,
                      flexShrink: 0,
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    ?
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCookieHelp(!showCookieHelp)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ea377a',
                    fontSize: '11px',
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                    flexShrink: 0,
                  }}
                >
                  {showCookieHelp ? 'Hide guide' : 'How to get this?'}
                </button>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#8f98a0', lineHeight: 1.4 }}>
                Paste your <code>_backloggd_session</code> cookie from browser DevTools.
              </p>
              {showCookieHelp && (
                <div
                  style={{
                    marginTop: '8px',
                    backgroundColor: '#101822',
                    borderRadius: '6px',
                    padding: '12px 14px',
                    border: '1px solid #3d5a80',
                    fontSize: '11px',
                    color: '#c7d5e0',
                    lineHeight: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '12px' }}>
                    How to get your session cookie:
                  </div>
                  <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <li>
                      Open <strong style={{ color: '#ffffff' }}>backloggd.com</strong> in your browser (Chrome, Edge, Brave, or Firefox) and ensure you are logged in.
                    </li>
                    <li>
                      Press <kbd style={{ background: '#2a475e', padding: '1px 5px', borderRadius: '3px', color: '#fff', fontSize: '10.5px' }}>F12</kbd> (or right-click anywhere on the page &gt; <em>Inspect</em>).
                    </li>
                    <li>
                      Click the <strong style={{ color: '#ffffff' }}>Application</strong> tab at the top of DevTools (<strong style={{ color: '#ffffff' }}>Storage</strong> tab in Firefox).
                      <div style={{ color: '#8f98a0', fontSize: '10.5px', marginTop: '2px' }}>
                        * If not visible, click the <code style={{ color: '#ea377a' }}>&gt;&gt;</code> icon in the tab bar.
                      </div>
                    </li>
                    <li>
                      In the left sidebar, expand <strong style={{ color: '#ffffff' }}>Cookies</strong> and click <strong style={{ color: '#ffffff' }}>https://backloggd.com</strong>.
                    </li>
                    <li>
                      Find the cookie with Name <code style={{ color: '#ea377a', background: '#1b2838', padding: '1px 4px', borderRadius: '3px' }}>_backloggd_session</code>.
                    </li>
                    <li>
                      Double-click its <strong style={{ color: '#ffffff' }}>Value</strong> column, copy the entire string (e.g. <code>G58Wmv...==</code>), and paste it below.
                    </li>
                  </ol>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type={showCookie ? 'text' : 'password'}
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                placeholder="Paste _backloggd_session..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '8px 10px',
                  backgroundColor: '#101822',
                  border: '1px solid #2a475e',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowCookie(!showCookie)}
                style={{
                  backgroundColor: '#2a475e',
                  color: '#c7d5e0',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0 10px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  flexShrink: 0,
                }}
              >
                {showCookie ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSaveCookie}
              disabled={testingAuth}
              style={{
                width: '100%',
                backgroundColor: '#ea377a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '9px 12px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: testingAuth ? 'wait' : 'pointer',
                opacity: testingAuth ? 0.7 : 1,
                transition: 'background-color 0.15s',
              }}
            >
              {testingAuth ? 'Verifying...' : 'Save & Connect'}
            </button>
          </div>

          {/* Preferences */}
          <div
            style={{
              backgroundColor: '#1b2838',
              borderRadius: '6px',
              padding: '14px',
              border: '1px solid #2a3f5a',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxSizing: 'border-box',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '13px', color: '#ffffff', fontWeight: 600 }}>Sync Preferences</h3>

            {/* Threshold Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <label style={{ fontWeight: 500, color: '#ffffff' }}>Min Session Duration</label>
                <span style={{ color: '#ea377a', fontWeight: 600, fontSize: '13px' }}>
                  {settings.minSessionSeconds} seconds
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: '#8f98a0', lineHeight: 1.3 }}>
                Shorter sessions (accidental launches) are ignored.
              </p>
              <input
                type="range"
                min="10"
                max="300"
                step="10"
                value={settings.minSessionSeconds}
                onChange={(e) => handleSaveThresholds({ minSessionSeconds: Number(e.target.value) })}
                style={{ width: '100%', accentColor: '#ea377a', cursor: 'pointer', margin: '4px 0' }}
              />
            </div>

            {/* Checkbox: Show Toasts */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.3 }}>
              <input
                type="checkbox"
                checked={settings.showToasts}
                onChange={(e) => handleSaveThresholds({ showToasts: e.target.checked })}
                style={{ accentColor: '#ea377a', width: '15px', height: '15px', marginTop: '1px', flexShrink: 0, cursor: 'pointer' }}
              />
              <span>Show Steam notification toast when session is synced</span>
            </label>

            {/* Checkbox: Auto retry */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.3 }}>
              <input
                type="checkbox"
                checked={settings.autoRetryQueue}
                onChange={(e) => handleSaveThresholds({ autoRetryQueue: e.target.checked })}
                style={{ accentColor: '#ea377a', width: '15px', height: '15px', marginTop: '1px', flexShrink: 0, cursor: 'pointer' }}
              />
              <span>Auto-retry queued sessions on game launch or reconnect</span>
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: Game Mappings */}
      {activeTab === 'mappings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              placeholder="Search mapped games..."
              value={mappingSearch}
              onChange={(e) => setMappingSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 10px',
                backgroundColor: '#1b2838',
                border: '1px solid #2a475e',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '12px',
                outline: 'none',
              }}
            />
            {Object.keys(mappings).length > 0 && (
              <button
                type="button"
                onClick={() => {
                  GameMatcher.clearAllMappings();
                  setMappings({});
                }}
                style={{
                  backgroundColor: '#c0392b',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Clear All
              </button>
            )}
          </div>

          {filteredMappings.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 12px',
                color: '#8f98a0',
                backgroundColor: '#1b2838',
                borderRadius: '6px',
                fontSize: '12px',
                lineHeight: 1.4,
              }}
            >
              No games mapped yet. Games will be auto-matched as you play them.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredMappings.map((m) => (
                <div
                  key={m.appId}
                  style={{
                    backgroundColor: '#1b2838',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    border: '1px solid #2a3f5a',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          color: '#ffffff',
                          fontWeight: 600,
                          fontSize: '13px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.steamTitle}
                      </div>
                      <div style={{ fontSize: '11px', color: '#66c0f4', marginTop: '2px' }}>
                        AppID: {m.appId}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: m.confirmed ? 'rgba(46, 204, 113, 0.15)' : 'rgba(52, 152, 219, 0.15)',
                        color: m.confirmed ? '#2ecc71' : '#3498db',
                        flexShrink: 0,
                      }}
                    >
                      {m.confirmed ? 'Confirmed' : 'Auto'}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: '12px',
                      color: '#c7d5e0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '2px',
                    }}
                  >
                    <span style={{ color: '#8f98a0' }}>Backloggd:</span>
                    <span
                      style={{
                        fontWeight: 500,
                        color: '#ea377a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.backloggdTitle}
                    </span>
                    <span style={{ color: '#8f98a0', fontSize: '11px' }}>({m.gameId})</span>
                  </div>

                  {editingAppId === m.appId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                      <input
                        type="text"
                        value={editTitleInput}
                        onChange={(e) => setEditTitleInput(e.target.value)}
                        placeholder="Backloggd Title"
                        style={{
                          padding: '5px 8px',
                          background: '#101822',
                          color: '#fff',
                          border: '1px solid #2a475e',
                          borderRadius: '3px',
                          fontSize: '11px',
                        }}
                      />
                      <input
                        type="text"
                        value={editGameIdInput}
                        onChange={(e) => setEditGameIdInput(e.target.value)}
                        placeholder="Backloggd Game ID (e.g. 71)"
                        style={{
                          padding: '5px 8px',
                          background: '#101822',
                          color: '#fff',
                          border: '1px solid #2a475e',
                          borderRadius: '3px',
                          fontSize: '11px',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleSaveEditMapping(m.appId)}
                          style={{
                            flex: 1,
                            background: '#27ae60',
                            color: '#fff',
                            border: 'none',
                            padding: '5px 8px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAppId(null)}
                          style={{
                            background: '#2a475e',
                            color: '#c7d5e0',
                            border: 'none',
                            padding: '5px 8px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAppId(m.appId);
                          setEditGameIdInput(m.gameId);
                          setEditTitleInput(m.backloggdTitle);
                        }}
                        style={{
                          flex: 1,
                          background: '#2a475e',
                          color: '#c7d5e0',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        Edit Game ID
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMapping(m.appId)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #7f8c8d',
                          color: '#95a5a6',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Queue */}
      {activeTab === 'queue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#8f98a0', lineHeight: 1.3 }}>
              Pending sessions queued for offline/error retry.
            </p>
          </div>
          {queue.length > 0 && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={handleDrainQueue}
                disabled={drainingQueue}
                style={{
                  flex: 1,
                  backgroundColor: '#ea377a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: drainingQueue ? 'wait' : 'pointer',
                }}
              >
                {drainingQueue ? 'Retrying...' : 'Retry All Now'}
              </button>
              <button
                type="button"
                onClick={() => {
                  SessionManager.clearQueue();
                  setQueue([]);
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #e74c3c',
                  color: '#e74c3c',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}
          {queue.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 12px',
                color: '#2ecc71',
                backgroundColor: '#1b2838',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              Queue is empty! All sessions synced.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {queue.map((q) => (
                <div
                  key={q.id}
                  style={{
                    backgroundColor: '#1b2838',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    border: '1px solid rgba(231, 76, 60, 0.4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '13px' }}>{q.gameTitle}</span>
                    <span style={{ color: '#ea377a', fontWeight: 600, fontSize: '12px' }}>
                      {NotificationManager.formatDuration(q.durationSec)}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#8f98a0' }}>
                    Date: {q.dateStr} | Attempts: {q.attempts}
                  </div>
                  {q.lastError && (
                    <div style={{ fontSize: '11px', color: '#e74c3c', wordBreak: 'break-word', marginTop: '2px' }}>
                      {q.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: History */}
      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#8f98a0' }}>
              Recent play sessions logged to Backloggd.
            </p>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  SessionManager.clearHistory();
                  setHistory([]);
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #7f8c8d',
                  color: '#95a5a6',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 12px',
                color: '#8f98a0',
                backgroundColor: '#1b2838',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              No sessions logged yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    backgroundColor: '#1b2838',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    border: '1px solid #2a3f5a',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: '13px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h.gameTitle}
                    </span>
                    <span style={{ color: '#ea377a', fontWeight: 600, fontSize: '12px', flexShrink: 0 }}>
                      {NotificationManager.formatDuration(h.durationSec)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '11px',
                      color: '#8f98a0',
                      marginTop: '2px',
                    }}
                  >
                    <span>{h.dateStr}</span>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        backgroundColor: h.success ? 'rgba(46, 204, 113, 0.15)' : 'rgba(231, 76, 60, 0.15)',
                        color: h.success ? '#2ecc71' : '#e74c3c',
                      }}
                    >
                      {h.success ? (h.accumulated ? 'Accumulated' : 'Logged') : 'Failed'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
