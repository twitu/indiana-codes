---
title: "Chapter 050: Foundation Refactor — MessageBus, Unified Cache, Parquet, ts_* (2021-05 → 2021-09)"
---
**Period:** 2021-05-01 → 2021-09-30 (~5 months)
**Tags:** `v1.118.0` → `v1.130.0`
**Why this chapter exists:** Three of the four "load-bearing" abstractions in
the modern engine land in this window: a unified `Cache`, the `MessageBus`
pub/sub, and Parquet serialisation. The fourth (`NautilusKernel`) follows
in chapter 6. This is the chapter that ends the "this is a Cython prototype"
era and starts the "this is a platform" era. **If a current contributor
asks "where does the design come from?", the answer is mostly here.**

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2021-05-23 | `v1.120.0` | |
| 2021-05-30 | `v1.121.0` | Cython `inline` removed from method signatures (no perf benefit; reduces noise). |
| 2021-06-06 | **`v1.122.0`** | **Unified Cache.** `TradingStrategy.data` and `.execution` consolidated into `TradingStrategy.cache`. `redis` subpackage moved into `infrastructure/`. Account state hooks added. |
| 2021-06-19 | (parquet first commits) | Parquet path begins. |
| 2021-06-20 | **`v1.123.0`** | **Arrow / Parquet serialization** added. `to_dict()` / `from_dict()` on objects. **`ts_*` naming convention** ("timestamp_ns" → "ts_event_ns", "ts_recv_ns", "ts_filled_ns", etc.) standardised across the codebase. |
| 2021-07-06 | `v1.124.0` | RiskEngine pre-trade checks iteration 2 — actual logic, not just scaffold. |
| 2021-07-18 | **`v1.125.0`** | **`MessageBus` class introduced.** All events flow through Pub/Sub. Order in-flight concept added. `mypy` introduced. |
| 2021-08-02 | `v1.126.0` / `v1.126.1` | |
| 2021-08-15 | (msg bus expand) | Data starts flowing through MessageBus too (was: events only). |
| 2021-08-17 | `v1.127.0` | Accounting / portfolio overhaul. **Betfair adapter completely rewritten** with full async support. Subscription mechanics fixed. |
| 2021-08-30 | `v1.128.0` | `pydantic`-based serializable configuration. Active order concept added. Component degraded/faulted FSM states added. |
| 2021-09-27 | `v1.130.0` | End of chapter. |

## Architecture change

### Before (v1.121, late May 2021)

```
   ┌─────────────────┐         ┌────────────────────┐
   │  Strategy       │         │  ExecutionEngine   │
   │ .data ──→ DataCache       └────────────────────┘
   │ .execution ──→ ExecutionCache
   └────────┬────────┘                  │
            │                           │
   ┌────────▼─────────────────────────────────┐
   │      DataEngine                          │
   │      (point-to-point Cython)             │
   └──────────────────────────────────────────┘
```

Two caches, two ways for components to find each other (callbacks + direct
references), two serialisation formats (msgpack + ad-hoc dicts). Coupling is
high; testing is painful.

### After (v1.130, late Sept 2021)

```
                    ┌─────────────────────────────┐
                    │      MessageBus (Cython)    │
                    │  Pub/Sub  Req/Rep  Cmd/Evt  │
                    └──┬──────────┬─────┬─────────┘
              publish  │          │     │  subscribe
        ┌──────────────┘          │     └──────────────┐
        │                         │                    │
   ┌────▼─────┐    ┌──────────────▼──────────┐    ┌────▼──────┐
   │ Strategy │    │       Cache             │    │ Execution │
   │ (.cache  │    │  (orders, positions,    │    │ Engine    │
   │  read)   │    │   instruments, ticks)   │    │           │
   └──────────┘    └─────────────────────────┘    └───────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │ Parquet / Arrow on disk │
              │ (DataCatalog v1)        │
              └─────────────────────────┘
```

One cache. One bus. One canonical timestamp convention (`ts_event`,
`ts_init`, `ts_recv`, `ts_submitted`, …). Components talk via the bus or
read the cache; they don't need direct references to each other.

## Key decisions

### Unify `Cache` (v1.122)

The unification is one PR's worth of work, but its impact is enormous.
*Every* component now reads the same cache. This is what allows the
`RiskEngine` to look at orders without import cycles, the `Portfolio` to
read positions and instruments together, and (later) the entire engine
to be ported to Rust as a single owner of mutable state. **The unified
cache is the precondition for the Rust port** — you cannot port two
caches that are accessed in 50 different ways without breaking everyone.

**Why:** the v1.122 release notes name it: "Unified data and execution
caches into single `Cache`. Improved configuration options and naming.
Simplified `Portfolio` component registration. Simplified wiring of `Cache`
into components." The phrase "simplified wiring" is the tell — the previous
shape was wiring spaghetti.

### Introduce the `MessageBus` (v1.125)

The MessageBus is announced as a "major re-architecture of the internal
messaging system. A common message bus has been implemented which now
handles all events via a Pub/Sub messaging pattern. The next release will
see all data being handled by the message bus."

The distinction between "events through the bus" (v1.125) and "data through
the bus" (v1.127) matters: the team rolled this out incrementally, *not*
in a single big-bang rewrite. Events first (state changes, easier to
reason about), data second (high-volume, performance-sensitive).

**Why:** to break import cycles, enable Redis-backed external state
streaming (which lands later), and let multiple subscribers consume the
same data without pull-based callback gymnastics. The pattern is straight
out of *enterprise integration patterns* — pub/sub, req/rep, cmd/evt
named explicitly in the docs.

### Standardise `ts_*` naming (v1.123)

A small change with a huge readability payoff: `timestamp_ns` becomes
`ts_event_ns`, `ts_init_ns`, `ts_recv_ns`, `ts_filled_ns`. Every
timestamp in the codebase tells you *what time it represents*. This is
the convention every later chapter follows. The `_ns` suffix is later
dropped (v1.183 area) — the convention becomes `ts_event` (always
nanoseconds).

### Parquet, not just msgpack (v1.123)

Arrow / Parquet adds disk persistence with schema evolution. msgpack
stays for over-the-wire (Redis pub/sub external streams). This is the
seed of the `DataCatalog` (v1) and later `ParquetDataCatalog` (v2 in
chapter 8).

### Configuration with `pydantic` (v1.128)

Configs become typed. This was later replaced by `msgspec` (chapter 6,
v1.139) for performance, then by `bon` builders (chapter 15) for
ergonomics — but the *idea* of "configs are first-class typed objects,
not dicts" lands here.

### Component FSM expanded (v1.128)

`PRE_INITIALIZED`, `DEGRADING`, `DEGRADED`, `FAULTING`, `FAULTED` states
get added. Combined with the `start/stop/reset/dispose` triggers from
earlier, this is the FSM that's still in `docs/concepts/architecture.md`
today. Components no longer just "run" — they have life cycles, and
crashes go through `FAULTED`, not undefined behaviour.

## Casualties

- **Two-cache architecture** — unified into one.
- **`InMemoryExecutionDatabase`** — renamed `BypassCacheDatabase`, then
  removed in v1.125 entirely.
- **`Account.balance()`** — renamed `balance_total()`.
- **`Portfolio.market_value()`** — renamed `net_exposure()`.
- **`OrderInvalid`** state — removed (redundant with `RiskEngine` denial).
- **Cython `inline` decorations** — removed (Cython can't inline cdef methods
  from another module's vtable).
- **Direct `redis` subpackage** — moved under `infrastructure/`.

## Q&A

### Was the rolling-out events-first / data-second a deliberate strategy?

Yes — the v1.125 release notes flag it: "The next release will see all
data being handled by the message bus." Doing events first lets the team
shake out the bus's correctness on lower-volume traffic before subjecting
it to tick-rate data.

### Why pydantic, then msgspec, then bon? Three config systems in five years?

Each step was triggered by a different cost. pydantic was slow at startup
(many configs to parse). msgspec was 5–10× faster but verbose to write.
bon (chapter 15) gave compile-time builders in Rust with friendlier
defaults. The progression is "performance → ergonomics", which mirrors
the broader codebase migration.

### Why did Betfair need a complete rewrite in v1.127?

Betfair's market-stream API is unusual: it's request-response over TLS,
batch-oriented, with sequence numbers. The first Betfair adapter
(March 2021) was synchronous and made callbacks blocking. The rewrite
made it fully async, fixed the subscription mechanics, and let the bus
consume Betfair events the same way as any other adapter. From this
point Betfair is a first-class adapter; before this point it was a
proof-of-concept.

### Why introduce `mypy` only at v1.125?

The codebase is mostly Cython, and mypy doesn't understand `cdef class`.
mypy is mostly checking the Python wrapper layer and configuration code.
The check is real but the coverage is partial. Type stubs (`.pyi`) for
Cython types come much later (chapter 9–10), as part of the PyO3
migration.

## Insights for daily work

- When you see two ways to access the same state — `cache.X` and
  `direct_attribute.X` — prefer `cache.X`. It's the post-v1.122
  convention, and it's what testing infrastructure expects.
- `MessageBus` topics are *strings* (string interning under the hood
  with `Ustr`). Topic conventions like `data.quotes.{venue}.{symbol}`
  are not enforced by the type system; they're enforced by code review.
  Don't invent new topic shapes for adapters — see existing ones.
- `ts_event` is **always** the venue's wall-clock time (when the event
  happened on the venue). `ts_init` is **always** when Nautilus
  constructed the event object. They are not the same and the
  difference matters in reconciliation.
- The `Component` FSM (chapter docs) is real. A component in `FAULTED`
  cannot transition back to `RUNNING` without going through `STOPPED`
  → `RESETTING` → `READY`. Skipping the steps with raw mutation breaks
  the recovery path.
