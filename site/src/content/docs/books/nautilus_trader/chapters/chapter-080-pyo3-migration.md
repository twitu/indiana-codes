---
title: "Chapter 080: The PyO3 Migration and Rust Catalog (2023-06 → 2024-01)"
---
**Period:** 2023-06-17 → 2024-01-31 (~7 months)
**Tags:** `v1.176.0` → `v1.184.0`
**Why this chapter exists:** With the OrderBook + network clients in Rust
(chapter 7), the team commits to **PyO3 as the strategic Python binding** and
starts moving everything that isn't yet Rust over. This includes the
Rust-implemented `RedisCacheDatabase`, a global atomic clock, and the core
logging interface. **Cython is no longer being extended; it's being replaced.**
By the end of this chapter, the `infrastructure` Python subpackage (where
Redis lived) is gone, replaced by Rust. The Databento and Bybit adapters
also land here, accelerating chapter 9's adapter boom.

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2023-06-17 | `v1.175.0` | (chapter 7 endpoint — Rust OrderBook + network) |
| 2023-08-22 | `v1.177.0` | (continuing PyO3 work) |
| 2023-10-22 | `v1.179.0` | (continuing PyO3 work) |
| 2023-10-30 | (`3daf12be1b`) | First commits in `adapters/databento`. |
| 2023-11-03 | `v1.180.0` | |
| 2023-12-04 | (`b3e2f9a261`) | First commits in `adapters/bybit`. |
| 2023-12-23 | **`v1.182.0`** | **`CacheDatabaseFacade` + `CacheDatabaseAdapter`** abstract Redis from Python. **`RedisCacheDatabase` implemented in Rust** with separate MPSC channel thread. **TA-Lib integration**. **`infrastructure` subpackage removed** (now redundant with Rust impl). `redis` and `hiredis` dependencies dropped from Python. |
| 2024-01-12 | **`v1.183.0`** | **Core logging interface implemented via Rust `log` crate.** **Global atomic clock implemented in Rust** (improves performance and ensures monotonic timestamps in real-time). **Optimised Arrow encoding** (~100× faster Parquet writes). |
| 2024-01-29 | `v1.184.0` | (continuing) |

## Architecture change

### Before

```
                  Python
                    │
            Cython glue layer
            ┌───────┼─────────┐
            │       │         │
       Cython ── Cython ── Rust (OrderBook,
       Cache       (state)    network)
            │
       Python: `redis` lib + `hiredis`
       Python: stdlib `logging`
       Python: `datetime.now()` + ad-hoc clock objects
```

The hot path was Rust for OrderBook + network. The rest still climbed
through Python and the `redis`/`hiredis` libraries.

### After (v1.183)

```
                       Python (thin layer, often just imports)
                                │
              ┌─────── PyO3 bindings ───────┐
              │                              │
              │    Rust core (`crates/`)     │
              │  ┌─────────────────────────┐ │
              │  │ Atomic clock (one global)│ │
              │  │ Logger (log crate, sink  │ │
              │  │  via tracing-subscriber)│ │
              │  │ RedisCacheDatabase      │ │
              │  │   + MPSC tokio task     │ │
              │  │ Arrow / Parquet writer  │ │
              │  └─────────────────────────┘ │
              └──────────────────────────────┘
        No more Python `redis`/`hiredis`.
        No more Python stdlib `logging` for hot path.
```

## Key decisions

### PyO3 wins as the binding strategy

The C-ABI route from chapter 7 had its place — it lets you swap in Rust
*under* an existing Cython surface — but PyO3 is the future for new Rust
modules. PyO3 0.18+ (2023) had stabilised enough that the maintainer
committed to it. From this chapter onward, *new* Rust subsystems get
PyO3 bindings, not Cython glue. Old Cython surfaces will be peeled back
later (a process that's still ongoing in 2026 — see `interactive_brokers_pyo3`
sitting alongside `interactive_brokers` in `nautilus_trader/adapters/`).

**Why:** PyO3 gives you Rust types as first-class Python objects without
the C-ABI hand-coding. It also handles GIL release annotations
(`#[pyo3(text_signature = "...")]`) so async callbacks don't accidentally
hold the GIL during long Rust work.

### `RedisCacheDatabase` in Rust with an MPSC tokio task

This is a *substantial* change. Before, every Redis interaction was a
synchronous call from Cython into the `redis` Python lib (through
`hiredis`). After, every Redis op is sent over an MPSC channel to a
dedicated tokio task that batches and writes asynchronously. The Python
caller gets back-pressure if the channel is full, but typically just
sends and continues.

**Why:** Redis writes were on the hot path of every order/event. The
synchronous Python-side call could block the engine thread for tens of
milliseconds during slow Redis or network hiccups. Moving to an async
tokio task isolates the engine from Redis latency.

### Global atomic clock

Pre-v1.183, every component that needed a timestamp called
`Clock.timestamp_ns()` on its own clock instance. This was *mostly*
fine but had race conditions in multi-threaded contexts (a thread could
see a timestamp older than one already published by another thread).
The fix is one global `AtomicTime` in Rust, monotonic by construction.

**Why:** the v1.183 release notes are blunt: "ensures properly
monotonic timestamps in real-time". Non-monotonic timestamps in event
streams break replay, break ordering invariants, break reconciliation.

### Logging via the Rust `log` crate

Python's stdlib `logging` is fine for app code but high-volume
trading systems generate thousands of log events per second. The
overhead of the Python logger (string interpolation, formatter
chains, handler lookups) was measurable. Switching the *core* logger
to Rust's `log` crate (with `tracing-subscriber` for output) removes
that cost; the Python wrapper still exists for user-side strategy
code.

**Why:** consistent log output, faster path, and (later, chapter 13)
opens the door for tracing integration with external tools.

### `infrastructure` subpackage is *deleted*

When Redis access moves to Rust, the entire `nautilus_trader/infrastructure/`
Python subpackage becomes redundant. The team deletes it rather than
leaving it as a husk. This is the first major Python subpackage *deletion*
in the project's history. It signals that Rust ports aren't additive — they
remove obligation from the Python side.

### Arrow encoding optimisation (~100× faster)

The Parquet writer was a big win source: profiling showed the encoding
of `OrderBookDelta` arrays through pandas / pyarrow was the bottleneck
for backtest data ingestion. Re-implementing the writer in Rust with
explicit FixedSizeBinary fields gave roughly 100× speedup on writes.
This is what makes large Tardis / Databento backtests practical.

## Casualties

- **`infrastructure` Python subpackage** — deleted entirely.
- **`redis` and `hiredis` Python deps** — gone from `pyproject.toml`.
- **Python stdlib `logging` on the hot path** — replaced by Rust log
  crate.
- **`Ticker` data type** — removed in v1.183 (release notes: "not a
  type which can be practically normalised and so becomes adapter
  specific generic data"). Bybit and others ship per-venue Ticker types
  instead.
- **Various Cython memory leaks** — fixed as the underlying types moved
  to Rust drop semantics.
- **`AssetType`** — renamed to `InstrumentClass` (v1.183).
- **`AssetClass.METAL` / `AssetClass.ENERGY`** — removed (futures
  category, not asset class).
- **`TracingConfig`** — removed (redundant with new logging impl).

## Q&A

### Was deleting `infrastructure` a backwards-compatibility break for users?

Yes — anyone importing from `nautilus_trader.infrastructure` had to
move to the new config-based access. The release notes flag it as a
breaking change. The maintainer's pattern is consistent: when a subpackage's
*reason for existence* (Redis interop in Python) goes away, the package goes
away. No backwards-compatibility shims.

### Why was the global atomic clock so hard to get right?

Because there are at least three time concepts in trading: wall time
(when did this *really* happen?), event time (when did the venue say it
happened?), and engine time (when did Nautilus see it?). The atomic
clock is for *engine time* — strict monotonicity, used as the
default `ts_init`. For *event time* (`ts_event`), the venue's
timestamp is preserved as-is. Mixing the two is a recurring bug
class — you'll see "fixed time-event ordering" fixes in many later
release notes.

### Why TA-Lib at v1.182 if it's deprecated by v1.211?

TA-Lib was added on user request as a way to use a battle-tested
indicator library. It was deprecated when *every TA-Lib indicator
that mattered* had been ported to Rust (chapter 9–10). The
deprecation is a "we have native versions now, the C library is no
longer worth the dependency" call.

### Why now and not earlier on the Arrow encoder?

Because before v1.175 the OrderBook wasn't in Rust, so Rust couldn't
encode it directly. The encoder optimisation requires both ends of
the pipe (in-memory representation + writer) to be in Rust.

## Insights for daily work

- New code goes through PyO3, not Cython. If you're tempted to add a
  `cdef class` for a new feature, stop — write it in Rust and bind
  with PyO3.
- When you see two implementations of the same thing in the codebase
  (e.g. `interactive_brokers/` and `interactive_brokers_pyo3/`), the
  PyO3 one is the future. Don't add features to the Cython one
  without coordinating.
- The Rust logger is configured via `LoggingConfig` from Python.
  Rust-side `tracing` macros (chapter 13+) feed into the same sink.
  The advice: log from Python with the `Logger` adapter; *never*
  call Python's stdlib `logging` for hot-path events.
- The MPSC channel between Python and the Redis tokio task means
  Redis errors are *asynchronous*. If a strategy writes to the cache
  and Redis is down, the Python call returns successfully — the
  failure surfaces in the engine log. Don't assume `cache.add(...)`
  is durable until a flush.
