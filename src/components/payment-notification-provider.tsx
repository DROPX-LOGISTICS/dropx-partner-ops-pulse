"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PaymentNotificationSnapshot } from "@/lib/payment-notification-counts";

const emptySnapshot: PaymentNotificationSnapshot = {
  total: 0,
  badges: {},
  items: []
};

type PaymentNotificationContextValue = {
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  snapshot: PaymentNotificationSnapshot;
};

const PaymentNotificationContext = createContext<PaymentNotificationContextValue>({
  isRefreshing: false,
  refresh: async () => undefined,
  snapshot: emptySnapshot
});

const POLL_MS = 5 * 60 * 1000;

export function PaymentNotificationProvider({
  children,
  initialData,
  enabled = true
}: {
  children: ReactNode;
  initialData: PaymentNotificationSnapshot;
  enabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PaymentNotificationSnapshot>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchAtRef = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (inFlightRef.current) return inFlightRef.current;
    const now = Date.now();
    // Avoid stampedes from focus + visibility + remounts within a short window.
    if (!force && now - lastFetchAtRef.current < 30_000) return;

    const run = (async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch("/api/payment-notifications", { cache: "no-store" });
        if (response.ok) {
          setSnapshot(await response.json());
          lastFetchAtRef.current = Date.now();
        }
      } finally {
        setIsRefreshing(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh(true);

    let intervalId: number | undefined;
    const startPolling = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") void refresh(false);
      }, POLL_MS);
    };
    const stopPolling = () => {
      if (intervalId === undefined) return;
      window.clearInterval(intervalId);
      intervalId = undefined;
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh(false);
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, refresh]);

  const value = useMemo(() => ({
    isRefreshing,
    refresh: () => refresh(true),
    snapshot
  }), [isRefreshing, refresh, snapshot]);

  return (
    <PaymentNotificationContext.Provider value={value}>
      {children}
    </PaymentNotificationContext.Provider>
  );
}

export function usePaymentNotifications() {
  return useContext(PaymentNotificationContext);
}

export function PaymentNavBadge({ code }: { code?: string }) {
  const { snapshot } = usePaymentNotifications();
  if (!code) return null;
  const count = snapshot.badges[code] ?? 0;
  if (count <= 0) return null;
  return <span className="nav-badge">{count > 99 ? "99+" : count}</span>;
}
