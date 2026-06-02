"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "rerun" | "delete">(null);

  async function rerun() {
    if (busy) return;
    setBusy("rerun");
    const res = await fetch(`/api/reports/${reportId}/rerun`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    } else {
      setBusy(null);
      alert("Could not re-run the report. Please try again.");
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirm("Delete this report? This cannot be undone.")) return;
    setBusy("delete");
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard/reports");
      router.refresh();
    } else {
      setBusy(null);
      alert("Could not delete the report. Please try again.");
    }
  }

  return (
    <div className="flex gap-3">
      <button
        onClick={rerun}
        disabled={busy !== null}
        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy === "rerun" ? "Re-running…" : "Re-run report"}
      </button>
      <button
        onClick={remove}
        disabled={busy !== null}
        className="px-4 py-2 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {busy === "delete" ? "Deleting…" : "Delete report"}
      </button>
    </div>
  );
}
