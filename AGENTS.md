- Technical: /__review renders real screens with local fixtures via a fetch shield active only on /__review paths; why: lets visual review run without auth or real data.

- Query keys live in src/lib/query-keys.ts and global QueryClient defaults in QUERY_DEFAULTS; why: one source for cache identity and conservative defaults that per-query options override.
- AuthProvider clears the whole Query cache on SIGNED_OUT or user switch; why: prevents one user's data showing to the next on a shared terminal.
- SaaS phase-1 SQL lives in database/staging outside auto-applied migration paths; why: protects the connected In-Haus database while isolated PostgreSQL/Supabase staging validation is pending.

- Dashboard-specific visual refinements use `.dashboard-view` scoped typography and existing semantic tokens; why: preserve presentation on other operational screens.
- Dashboard opts into query-error reporting in useEpiMetrics and gates indicators on every source dependency; why: distinguish unavailable data from legitimate zero without changing other consumers' behavior.

- C2 containment SQL stays in database/staging/c2_corrections and runs only through the hermetic local runner with a fixed Unix socket, TCP disabled and SQL target guards; why: prevent accidental writes to the connected operational database.
