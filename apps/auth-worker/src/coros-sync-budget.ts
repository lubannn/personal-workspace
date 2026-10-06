/** A local invocation limit, never an upstream HTTP or network failure. */
export class CorosSyncBudgetExceeded extends Error {
  constructor() { super("COROS_SYNC_BUDGET_EXHAUSTED"); }
}
