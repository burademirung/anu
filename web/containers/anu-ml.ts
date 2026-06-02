import { Container } from "@cloudflare/containers";

/**
 * Durable-Object-backed Cloudflare Container running the Anu ML pipeline
 * (FastAPI/uvicorn on port 8000, exposing POST /process). The queue consumer
 * obtains an instance via `getContainer(env.CONTAINER)` and calls its `.fetch`.
 *
 * Containers don't get Workers bindings, so the R2 credentials (and optional
 * Mapbox token) are forwarded from the Worker's secrets into the container's
 * process environment via `envVars`.
 */
export class AnuMLContainer extends Container<CloudflareEnv> {
  // uvicorn listens on 8000 inside the ml-service image.
  defaultPort = 8000;
  // Keep a warm instance for 10 minutes of idleness before sleeping.
  sleepAfter = "10m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: CloudflareEnv) {
    super(ctx, env);
    this.envVars = {
      R2_ENDPOINT: env.R2_ENDPOINT ?? "",
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
      R2_BUCKET: env.R2_BUCKET ?? "anu",
      MAPBOX_ACCESS_TOKEN: env.MAPBOX_ACCESS_TOKEN ?? "",
    };
  }
}
