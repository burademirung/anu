import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { BUCKET: { get: async (k: string) => (k === "exists" ? { arrayBuffer: async () => new ArrayBuffer(3) } : null) } },
  }),
}));

import { getObjectBytes } from "@/lib/s3";

describe("r2 storage helper", () => {
  it("returns bytes for an existing key", async () => {
    const b = await getObjectBytes("exists");
    expect(b).toBeInstanceOf(ArrayBuffer);
    expect(b!.byteLength).toBe(3);
  });
  it("returns null for a missing key", async () => {
    expect(await getObjectBytes("missing")).toBeNull();
  });
});
