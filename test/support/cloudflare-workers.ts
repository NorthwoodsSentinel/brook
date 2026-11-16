// Test shim for the `cloudflare:workers` module, which exists only inside workerd.
// vitest.config.mts aliases the import to this file. It supplies the one export
// src/index.ts uses, the DurableObject base class, with the same constructor shape
// (ctx, env) and the same protected fields. It adds no behavior of its own.
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
