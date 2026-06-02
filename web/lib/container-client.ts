import type { ContainerJob, ContainerResult } from "@/lib/container-contract";
import { isContainerResult } from "@/lib/container-contract";

/** Invoke the ML container's POST /process and return the validated result. */
export async function callContainer(
  container: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> },
  job: ContainerJob,
): Promise<ContainerResult> {
  const res = await container.fetch("https://container/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      report_id: job.reportId,
      property_id: job.propertyId,
      lat: job.lat,
      lon: job.lon,
    }),
  });
  if (!res.ok) {
    // Surface the container's error detail (FastAPI `{ "detail": … }`) so a
    // failed report records *why*, not just the status code.
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`container /process ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const data: unknown = await res.json();
  if (!isContainerResult(data)) throw new Error("container returned malformed result");
  return data;
}
