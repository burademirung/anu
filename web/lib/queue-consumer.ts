import { getContainer } from "@cloudflare/containers";
import type { ContainerJob } from "@/lib/container-contract";
import type { AnuMLContainer } from "@/containers/anu-ml";
import { callContainer } from "@/lib/container-client";
import { writeReportResult } from "@/lib/report-writer";
import { createDb, type Db } from "@/lib/db";
import { reports } from "@/db/schema";
import { eq } from "drizzle-orm";

type QueueMessage = { body: ContainerJob; ack: () => void; retry: () => void };
type QueueBatch = { messages: QueueMessage[] };
type ConsumerEnv = { DB: unknown; CONTAINER: DurableObjectNamespace<AnuMLContainer> };

/**
 * Process a batch of report jobs. dbFactory is injected for testability;
 * production passes createDb. Each message: processing -> container -> write -> completed.
 * On error: failed + retry() so Cloudflare Queues redelivers (backoff/DLQ via config).
 */
export async function handleQueueBatch(
  batch: QueueBatch,
  env: ConsumerEnv,
  dbFactory: (d1: unknown) => Db = createDb as never,
): Promise<void> {
  const db = dbFactory(env.DB);
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      await db
        .update(reports)
        .set({ status: "processing", processingStartedAt: new Date() })
        .where(eq(reports.id, job.reportId));
      // One container instance per report id (idempotent re-delivery hits the same instance).
      const result = await callContainer(getContainer(env.CONTAINER, job.reportId), job);
      await writeReportResult(db, job.reportId, result);
      msg.ack();
    } catch (err) {
      await db
        .update(reports)
        .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "processing error" })
        .where(eq(reports.id, job.reportId))
        .catch(() => {});
      msg.retry();
    }
  }
}
