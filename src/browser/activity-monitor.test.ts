/**
 * Unit tests for ActivityMonitor
 *
 * Tests:
 * - Visibility change detection
 * - Network state detection
 * - Grace period timing
 *
 * Requirements: 8.4, 8.5, 8.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActivityMonitor } from './activity-monitor.js';

describe('ActivityMonitor', () => {
  let monitor: ActivityMonitor;
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let mockNavigator: { onLine: boolean };
  let visibilityChangeHandler: (() => void) | null = null;
  let onlineHandler: (() => void) | null = null;
  let offlineHandler: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'visibilitychange') {
          visibilityChangeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };

    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'online') {
          onlineHandler = handler;
        } else if (event === 'offline') {
          offlineHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };

    // Mock navigator for online status
    mockNavigator = { onLine: true };

    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', mockNavigator);
  });

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    visibilityChangeHandler = null;
    onlineHandler = null;
    offlineHandler = null;
  });

  describe('visibility change detection', () => {
    it('registers visibility change listener on start', () => {
      monitor = new ActivityMonitor();
      monitor.start();

      expect(mockDocument.addEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('removes visibility change listener on stop', () => {
      monitor = new ActivityMonitor();
      monitor.start();
      monitor.stop();

      expect(mockDocument.removeEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('detects when tab becomes hidden', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();

      // Wait for grace period
      vi.advanceTimersByTime(150);

      expect(inactiveCalled).toBe(true);
    });

    it('detects when tab becomes visible', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      let activeCalled = false;
      monitor.onActive(() => {
        activeCalled = true;
      });
      monitor.start();

      // Tab becomes hidden first
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);

      // Tab becomes visible
      mockDocument.hidden = false;
      visibilityChangeHandler?.();

      expect(activeCalled).toBe(true);
    });

    it('isActive returns correct visibility state', () => {
      monitor = new ActivityMonitor();

      mockDocument.hidden = false;
      expect(monitor.isActive()).toBe(true);

      mockDocument.hidden = true;
      expect(monitor.isActive()).toBe(false);
    });
  });

  describe('network state detection', () => {
    it('registers online/offline listeners on start', () => {
      monitor = new ActivityMonitor();
      monitor.start();

      expect(mockWindow.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });

    it('removes online/offline listeners on stop', () => {
      monitor = new ActivityMonitor();
      monitor.start();
      monitor.stop();

      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });

    it('triggers offline callback when network goes offline', () => {
      monitor = new ActivityMonitor();
      let offlineCalled = false;
      monitor.onNetworkOffline(() => {
        offlineCalled = true;
      });
      monitor.start();

      // Simulate going offline
      mockNavigator.onLine = false;
      offlineHandler?.();

      expect(offlineCalled).toBe(true);
    });

    it('triggers online callback when network comes online', () => {
      monitor = new ActivityMonitor();
      let onlineCalled = false;
      monitor.onNetworkOnline(() => {
        onlineCalled = true;
      });
      monitor.start();

      // First go offline
      mockNavigator.onLine = false;
      offlineHandler?.();

      // Then come back online
      mockNavigator.onLine = true;
      onlineHandler?.();

      expect(onlineCalled).toBe(true);
    });

    it('isOnline returns correct network state', () => {
      monitor = new ActivityMonitor();

      mockNavigator.onLine = true;
      expect(monitor.isOnline()).toBe(true);

      mockNavigator.onLine = false;
      expect(monitor.isOnline()).toBe(false);
    });

    it('does not trigger offline callback if already offline', () => {
      monitor = new ActivityMonitor();
      let offlineCallCount = 0;
      monitor.onNetworkOffline(() => {
        offlineCallCount++;
      });
      monitor.start();

      // Go offline twice
      mockNavigator.onLine = false;
      offlineHandler?.();
      offlineHandler?.();

      expect(offlineCallCount).toBe(1);
    });

    it('does not trigger online callback if already online', () => {
      monitor = new ActivityMonitor();
      let onlineCallCount = 0;
      monitor.onNetworkOnline(() => {
        onlineCallCount++;
      });
      monitor.start();

      // Trigger online while already online
      onlineHandler?.();

      expect(onlineCallCount).toBe(0);
    });
  });

  describe('grace period timing', () => {
    it('waits for grace period before triggering inactive callback', () => {
      const gracePeriod = 500;
      monitor = new ActivityMonitor({ inactivityGracePeriod: gracePeriod });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();

      // Before grace period
      vi.advanceTimersByTime(gracePeriod - 100);
      expect(inactiveCalled).toBe(false);

      // After grace period
      vi.advanceTimersByTime(200);
      expect(inactiveCalled).toBe(true);
    });

    it('cancels grace period when tab becomes active', () => {
      const gracePeriod = 500;
      monitor = new ActivityMonitor({ inactivityGracePeriod: gracePeriod });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();

      // User returns before grace period ends
      vi.advanceTimersByTime(gracePeriod - 100);
      mockDocument.hidden = false;
      visibilityChangeHandler?.();

      // Wait past original grace period
      vi.advanceTimersByTime(200);

      expect(inactiveCalled).toBe(false);
    });

    it('uses default grace period of 5000ms', () => {
      monitor = new ActivityMonitor();
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();

      // Before default grace period (5000ms)
      vi.advanceTimersByTime(4900);
      expect(inactiveCalled).toBe(false);

      // After default grace period
      vi.advanceTimersByTime(200);
      expect(inactiveCalled).toBe(true);
    });

    it('clears grace timer on stop', () => {
      const gracePeriod = 500;
      monitor = new ActivityMonitor({ inactivityGracePeriod: gracePeriod });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();

      // Stop before grace period ends
      vi.advanceTimersByTime(gracePeriod - 100);
      monitor.stop();

      // Wait past grace period
      vi.advanceTimersByTime(200);

      expect(inactiveCalled).toBe(false);
    });

    it('does not start multiple grace timers', () => {
      const gracePeriod = 500;
      monitor = new ActivityMonitor({ inactivityGracePeriod: gracePeriod });
      let inactiveCallCount = 0;
      monitor.onInactive(() => {
        inactiveCallCount++;
      });
      monitor.start();

      // Tab becomes hidden multiple times
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      visibilityChangeHandler?.();
      visibilityChangeHandler?.();

      // Wait for grace period
      vi.advanceTimersByTime(gracePeriod + 100);

      expect(inactiveCallCount).toBe(1);
    });
  });

  describe('configuration', () => {
    it('respects disconnectOnInactive=false', () => {
      monitor = new ActivityMonitor({
        disconnectOnInactive: false,
        inactivityGracePeriod: 100,
      });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);

      expect(inactiveCalled).toBe(false);
    });

    it('respects reconnectOnActive=false', () => {
      monitor = new ActivityMonitor({
        reconnectOnActive: false,
        inactivityGracePeriod: 100,
      });
      let activeCalled = false;
      monitor.onActive(() => {
        activeCalled = true;
      });
      monitor.start();

      // Tab becomes hidden then visible
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);
      mockDocument.hidden = false;
      visibilityChangeHandler?.();

      expect(activeCalled).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('does not register listeners if already started', () => {
      monitor = new ActivityMonitor();
      monitor.start();
      monitor.start();

      expect(mockDocument.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('does not remove listeners if not started', () => {
      monitor = new ActivityMonitor();
      monitor.stop();

      expect(mockDocument.removeEventListener).not.toHaveBeenCalled();
    });

    it('can be restarted after stop', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      let inactiveCalled = false;
      monitor.onInactive(() => {
        inactiveCalled = true;
      });

      monitor.start();
      monitor.stop();
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);

      expect(inactiveCalled).toBe(true);
    });
  });

  describe('callback error handling', () => {
    it('continues executing callbacks even if one throws', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let secondCallbackCalled = false;

      monitor.onInactive(() => {
        throw new Error('Test error');
      });
      monitor.onInactive(() => {
        secondCallbackCalled = true;
      });
      monitor.start();

      // Tab becomes hidden
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);

      expect(secondCallbackCalled).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('multiple callbacks', () => {
    it('supports multiple inactive callbacks', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      let callback1Called = false;
      let callback2Called = false;

      monitor.onInactive(() => {
        callback1Called = true;
      });
      monitor.onInactive(() => {
        callback2Called = true;
      });
      monitor.start();

      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);

      expect(callback1Called).toBe(true);
      expect(callback2Called).toBe(true);
    });

    it('supports multiple active callbacks', () => {
      monitor = new ActivityMonitor({ inactivityGracePeriod: 100 });
      let callback1Called = false;
      let callback2Called = false;

      monitor.onActive(() => {
        callback1Called = true;
      });
      monitor.onActive(() => {
        callback2Called = true;
      });
      monitor.start();

      // Go inactive then active
      mockDocument.hidden = true;
      visibilityChangeHandler?.();
      vi.advanceTimersByTime(150);
      mockDocument.hidden = false;
      visibilityChangeHandler?.();

      expect(callback1Called).toBe(true);
      expect(callback2Called).toBe(true);
    });
  });
});
