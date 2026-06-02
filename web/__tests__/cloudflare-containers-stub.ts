// Test-only stub for `@cloudflare/containers`. The real package transitively
// imports the `cloudflare:workers` runtime module, which is not resolvable in
// the node vitest environment. Tests mock the CONTAINER binding as a plain
// `{ fetch }` object, so `getContainer` simply returns the binding it is given.

type FetchLike = { fetch(input: unknown, init?: unknown): Promise<Response> };

export function getContainer<T extends FetchLike>(binding: T): T {
  return binding;
}

export async function getRandom<T extends FetchLike>(binding: T): Promise<T> {
  return binding;
}

// Stand-in base class so a `class extends Container` import does not blow up.
export class Container {}
