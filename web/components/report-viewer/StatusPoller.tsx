"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the report status JSON endpoint every 2s while the report is in a
 * non-terminal state. On a terminal status (completed/failed) it refreshes the
 * server component to render the finished report, then stops polling.
 */
export default function StatusPoller({
  reportId,
  initialStatus,
}: {
  reportId: string;
  initialStatus: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const isTerminal = (s: string) => s === "completed" || s === "failed";
    if (isTerminal(initialStatus)) return;

    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/reports/${reportId}/status`);
        if (!res.ok) return;
        const data: { status?: string } = await res.json();
        if (stopped) return;
        if (data.status && isTerminal(data.status)) {
          clearInterval(interval);
          router.refresh();
        }
      } catch {
        // transient fetch error; keep polling
      }
    }, 2000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [reportId, initialStatus, router]);

  return null;
}
