import { Container } from "@cloudflare/containers";

/**
 * Durable-Object-backed Cloudflare Container running the Anu ML pipeline
 * (FastAPI/uvicorn on port 8000, exposing POST /process). The queue consumer
 * obtains an instance via `getContainer(env.CONTAINER)` and calls its `.fetch`.
 *
 * The live container only runs once deployed (Plan 5); here we wire the binding
 * so it type-checks and ships.
 */
export class AnuMLContainer extends Container {
  // uvicorn listens on 8000 inside the ml-service image.
  defaultPort = 8000;
  // Keep a warm instance for 10 minutes of idleness before sleeping.
  sleepAfter = "10m";
}
