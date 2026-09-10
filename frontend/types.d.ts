/**
 * Type declarations for Millennium and Steam Client CEF globals
 */

declare module 'millennium' {
  import React from 'react';

  export interface PluginDefinition {
    title: string;
    icon?: React.ReactNode;
    content: React.ReactNode;
  }

  export function definePlugin(factory: () => PluginDefinition): () => PluginDefinition;

  export interface FieldProps {
    label?: string;
    description?: string;
    children?: React.ReactNode;
  }

  export const Field: React.FC<FieldProps>;
}

export interface BackendRpcResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
  error?: string;
}



interface Window {
  backend?: typeof backend;
  SteamClient?: {
    Apps?: {
      GetAppOverviewByAppID?: (appId: number) => { display_name?: string } | undefined;
    };
    GameSessions?: {
      RegisterForAppLifetimeNotifications?: (
        callback: (data: { unAppID: number; bRunning: boolean; nInstanceID?: number }) => void
      ) => { unregister?: () => void } | undefined;
    };
    Overlay?: {
      ShowNotification?: (title: string, message: string) => void;
    };
    Notifications?: {
      ShowNotification?: (title: string, message: string) => void;
    };
  };
}
