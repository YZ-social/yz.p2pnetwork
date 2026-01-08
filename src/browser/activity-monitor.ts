/**
 * Activity Monitor - handles browser tab visibility and network state
 * 
 * Monitors:
 * - Tab visibility (Page Visibility API)
 * - Network connectivity (Network Information API)
 * 
 * Triggers disconnect when tab becomes inactive to prevent stale
 * routing entries in other nodes' DHT tables.
 */

import type { ActivityMonitorConfig } from './types.js';
import { DEFAULT_ACTIVITY_MONITOR_CONFIG } from './types.js';

type ActivityCallback = () => void;

/**
 * Monitors browser activity state and triggers callbacks on state changes
 */
export class ActivityMonitor {
  private config: ActivityMonitorConfig;
  private inactiveCallbacks: ActivityCallback[] = [];
  private activeCallbacks: ActivityCallback[] = [];
  private offlineCallbacks: ActivityCallback[] = [];
  private onlineCallbacks: ActivityCallback[] = [];
  
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private wasActive = true;
  private wasOnline = true;

  constructor(config: Partial<ActivityMonitorConfig> = {}) {
    this.config = { ...DEFAULT_ACTIVITY_MONITOR_CONFIG, ...config };
  }

  /**
   * Register callback for when tab becomes inactive
   */
  onInactive(callback: ActivityCallback): void {
    this.inactiveCallbacks.push(callback);
  }

  /**
   * Register callback for when tab becomes active
   */
  onActive(callback: ActivityCallback): void {
    this.activeCallbacks.push(callback);
  }

  /**
   * Register callback for when network goes offline
   */
  onNetworkOffline(callback: ActivityCallback): void {
    this.offlineCallbacks.push(callback);
  }

  /**
   * Register callback for when network comes online
   */
  onNetworkOnline(callback: ActivityCallback): void {
    this.onlineCallbacks.push(callback);
  }

  /**
   * Check if tab is currently active/visible
   */
  isActive(): boolean {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  }

  /**
   * Check if network is currently online
   */
  isOnline(): boolean {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  }

  /**
   * Start monitoring activity state
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.wasActive = this.isActive();
    this.wasOnline = this.isOnline();
    
    // Register visibility change listener
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    // Register network state listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Stop monitoring activity state
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    // Clear any pending grace timer
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    
    // Remove listeners
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Handle visibility change events
   */
  private handleVisibilityChange = (): void => {
    const isNowActive = this.isActive();
    
    if (this.wasActive && !isNowActive) {
      // Tab became inactive - start grace period
      this.startGracePeriod();
    } else if (!this.wasActive && isNowActive) {
      // Tab became active - cancel grace period and trigger active callbacks
      this.cancelGracePeriod();
      
      if (this.config.reconnectOnActive) {
        this.triggerCallbacks(this.activeCallbacks);
      }
    }
    
    this.wasActive = isNowActive;
  };

  /**
   * Handle network online event
   */
  private handleOnline = (): void => {
    if (!this.wasOnline) {
      this.wasOnline = true;
      this.triggerCallbacks(this.onlineCallbacks);
    }
  };

  /**
   * Handle network offline event
   */
  private handleOffline = (): void => {
    if (this.wasOnline) {
      this.wasOnline = false;
      this.triggerCallbacks(this.offlineCallbacks);
    }
  };

  /**
   * Start the grace period timer before triggering inactive callbacks
   */
  private startGracePeriod(): void {
    if (this.graceTimer) return;
    
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      
      if (this.config.disconnectOnInactive && !this.isActive()) {
        this.triggerCallbacks(this.inactiveCallbacks);
      }
    }, this.config.inactivityGracePeriod);
  }

  /**
   * Cancel the grace period timer (user returned to tab)
   */
  private cancelGracePeriod(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  /**
   * Trigger all callbacks in a list
   */
  private triggerCallbacks(callbacks: ActivityCallback[]): void {
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        console.error('Activity monitor callback error:', error);
      }
    }
  }
}
