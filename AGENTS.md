- Technical: /__review renders real screens with local fixtures via a fetch shield active only on /__review paths; why: lets visual review run without auth or real data.

- Query keys live in src/lib/query-keys.ts and global QueryClient defaults in QUERY_DEFAULTS; why: one source for cache identity and conservative defaults that per-query options override.
- AuthProvider clears the whole Query cache on SIGNED_OUT or user switch; why: prevents one user's data showing to the next on a shared terminal.
