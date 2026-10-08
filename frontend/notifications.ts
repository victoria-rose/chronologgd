/**
 * In-Client Toast & Notification System
 * Displays sync confirmations, error alerts, and auth notices inside the Steam Client UI.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface SteamClientWithNotifications {
  Overlay?: {
    ShowNotification?: (title: string, message: string) => void;
  };
  Notifications?: {
    ShowNotification?: (title: string, message: string) => void;
  };
}

export class NotificationManager {
  private static container: HTMLDivElement | null = null;
  private static readonly CONTAINER_ID = 'backloggd-sync-toast-container';

  /**
   * Format seconds into human readable duration string (e.g. "1h 45m" or "25m")
   */
  public static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);

    if (hours > 0 && mins > 0) {
      return `${hours}h ${mins}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${Math.max(1, mins)}m`;
    }
  }

  /**
   * Ensure container exists in DOM
   */
  private static ensureContainer(): HTMLDivElement {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }

    let existing = document.getElementById(this.CONTAINER_ID) as HTMLDivElement | null;
    if (!existing) {
      existing = document.createElement('div');
      existing.id = this.CONTAINER_ID;
      existing.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        max-width: 360px;
        font-family: "Motiva Sans", "Segoe UI", system-ui, sans-serif;
      `;
      document.body.appendChild(existing);
    }

    this.container = existing;
    return existing;
  }

  /**
   * Show toast in Steam client window
   */
  public static showToast(
    type: ToastType,
    title: string,
    message: string,
    durationMs = 4500
  ): void {
    // 1. Try native SteamClient overlay/notification if available
    const globalWindow = window as unknown as { SteamClient?: SteamClientWithNotifications };
    const steam = globalWindow.SteamClient;
    if (steam?.Overlay?.ShowNotification) {
      try {
        steam.Overlay.ShowNotification(title, message);
        return;
      } catch {
        // Fall back to DOM toast
      }
    } else if (steam?.Notifications?.ShowNotification) {
      try {
        steam.Notifications.ShowNotification(title, message);
        return;
      } catch {
        // Fall back to DOM toast
      }
    }

    // 2. DOM Toast fallback
    const container = this.ensureContainer();

    const toast = document.createElement('div');
    const accentColor =
      type === 'success'
        ? '#ea377a' // Backloggd Pink
        : type === 'error'
        ? '#ff4d4f'
        : type === 'warning'
        ? '#faad14'
        : '#1890ff';

    const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    iconPath.setAttribute('d',
      type === 'success'
        ? 'M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97 4.03a.75.75 0 0 0 1.08.02l3.992-4.99a.75.75 0 0 0-1.07-1.05l-3.47 4.337-1.543-1.543a.75.75 0 0 0-1.06 1.06l2.071 2.166z'
        : type === 'error'
        ? 'M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z'
        : 'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('fill', accentColor);
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('style', 'flex-shrink: 0; margin-top: 1px;');
    icon.appendChild(iconPath);

    // Title/message use textContent: game titles come from Steam/Backloggd and must not parse as HTML.
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    titleEl.setAttribute('style', 'font-size: 13px; font-weight: 600; color: #ffffff;');
    const messageEl = document.createElement('span');
    messageEl.textContent = message;
    messageEl.setAttribute('style', 'font-size: 12px; color: #9da3a8; line-height: 1.4;');
    const textWrap = document.createElement('div');
    textWrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 2px;');
    textWrap.appendChild(titleEl);
    textWrap.appendChild(messageEl);

    toast.appendChild(icon);
    toast.appendChild(textWrap);

    container.appendChild(toast);

    // Trigger enter animation
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });

    // Auto dismiss
    setTimeout(() => {
      toast.style.transform = 'translateY(10px)';
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 300);
    }, durationMs);
  }

  public static showSyncSuccessToast(gameTitle: string, durationSec: number): void {
    const formatted = this.formatDuration(durationSec);
    this.showToast('success', 'Backloggd Sync', `Logged ${formatted} of ${gameTitle}`);
  }

  public static showSyncErrorToast(gameTitle: string, reason: string): void {
    this.showToast('error', 'Backloggd Sync Failed', `${gameTitle}: ${reason}`);
  }

  public static showAuthExpiredToast(): void {
    this.showToast('warning', 'Backloggd Re-Auth Required', 'Session expired. Please update your session cookie in settings.');
  }
}
