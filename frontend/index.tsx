/**
 * Millennium Plugin Entrypoint: Backloggd Sync
 */

import { definePlugin } from 'millennium';
import React, { useEffect } from 'react';
import { NotificationManager } from './notifications';
import { SessionManager } from './session_manager';
import { SettingsPanel } from './settings';

const PluginIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    fill="#ea377a"
    style={{ width: '16px', height: '16px', display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c53 0 96-43 96-96V320c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H384V64H96C78.3 64 64 78.3 64 96V416c0 8.8 7.2 16 16 16H320V0H96zM480 96c0-17.7-14.3-32-32-32H384V224l48-36 48 36V96z" />
  </svg>
);

const PluginWrapper: React.FC = () => {
  useEffect(() => {
    SessionManager.initialize();

    return () => {
      SessionManager.destroy();
    };
  }, []);

  return <SettingsPanel />;
};

export default definePlugin(() => {
  // Initialize lifecycle listener immediately upon plugin registration
  SessionManager.initialize();

  return {
    title: 'Backloggd Sync',
    icon: <PluginIcon />,
    content: <PluginWrapper />,
  };
});
