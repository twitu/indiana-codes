---
title: "Chapter 100: The Engine Port — MessageBus v2, DataEngine v2, RiskEngine, ExecutionEngine, Portfolio (2024-08 → 2024-12)"
---
**Period:** 2024-08-02 → 2024-12-25 (~5 months)
**Tags:** `v1.197.0` → `v1.209.0`
**Why this chapter exists:** This is the chapter where the *engine itself*
gets ported to Rust. Not the OrderBook (that was chapter 7), not the network
(also chapter 7), not Redis or the clock (chapter 8). The five components
that *are* the engine — `MessageBus`, `DataEngine`, `RiskEngine`,
`ExecutionEngine`, `Portfolio` — all become Rust-native in five months.
**After this chapter, the Cython kernel is essentially scaffolding for the
Rust kernel.** Everything that follows builds on the Rust kernel.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2024-08-02 | `v1.197.0` | **`MessageBus` v2 in Rust** (#1786). **`DataEngine` v2 in Rust** (#1785). FillModel, FixedFeeModel, MakerTakerFeeModel in Rust (Filip Macek). Postgres native enum mappings in Rust. |
| 2024-08-09 | `v1.198.0` | (chapter 9 — `@customdataclass`) |
| 2024-08-19 | `v1.199.0` | Error modeling overhaul in Rust. Reconciliation robustness. |
| 2024-09-07 | `v1.200.0` | (chapter 9 — dYdX) |
| 2024-10-05 | `v1.203.0` | OrderBook delta processing for `SimulatedExchange` in Rust. Bar processing for `SimulatedExchange` in Rust. |
| 2024-10-22 | `v1.204.0` | **`Throttler` ported to Rust** (#1988). `BettingInstrument` ported to Rust. WebSocket reconnect-on-existing-tasks fix. Standardised log/error message syntax in Rust. Continued porting `SimulatedExchange` and `OrderMatchingEngine`. |
| 2024-11-03 | `v1.205.0` | **Analysis subpackage ported to Rust** (#2016). Tardis Machine + HTTP API integration. Postgres testing improvements. |
| 2024-11-17 | `v1.206.0` | **`RiskEngine` ported to Rust** (#2035). **`ExecutionEngine` ported to Rust** (#2048). Globally shared data channels to send events from engines to Runner. Tardis live data streams. |
| 2024-11-29 | `v1.207.0` | **`Portfolio` and `AccountManager` ported to Rust** (#2058). Improved live engines error logging. |
| 2024-12-15 | `v1.208.0` | `ShutdownSystem` command + `shutdown_system` for system-wide shutdown across backtest/sandbox/live. Type stubs for core, common, model. |
| 2024-12-25 | `v1.209.0` | WebSocket API trading for Bybit. `UUID4::new()` 2.8× faster (no string allocation). |

## Architecture change

### Before (v1.196)

```
                           Python "kernel"
        ┌──────────────────────────────────────────────────────┐
        │   MessageBus (Cython)        DataEngine (Cython)     │
        │   RiskEngine (Cython)        ExecutionEngine (Cython)│
        │   Portfolio (Cython)         AccountManager (Cython) │
        └──────────────┬─────────────────────────┬─────────────┘
                       │                          │
                  Cython ↔ Rust FFI           Cython ↔ Rust FFI
                       │                          │
            ┌──────────┴──────┐         ┌─────────┴─────────────┐
            │   OrderBook,    │         │  HttpClient,          │
            │   value types   │         │  WebSocketClient,     │
            │   (Rust)        │         │  RedisCacheDatabase   │
            └─────────────────┘         └───────────────────────┘
```

The engine's *core logic* was in Cython, calling out to Rust for hot-path
work. Every event still went through the Cython `MessageBus`. Every
risk check ran in Cython.

### After (v1.207)

```
                       Python (thin shell)
                            │ (PyO3)
                            ▼
        ┌────────────────────────────────────────────────────┐
        │              Rust kernel (`crates/`)               │
        │                                                    │
        │   MessageBus v2 ─────► DataEngine v2 ────► Cache    │
        │       │                     │              │      │
        │       ▼                     ▼              ▼      │
        │   RiskEngine ───► ExecutionEngine ──► Portfolio   │
        │                                       AccountMgr  │
        │   ─────────── all on shared channels ───────────  │
        │                                                    │
        │   OrderBook, network, value types (already Rust)   │
        └────────────────────────────────────────────────────┘
```

Strategy code is still Python. Adapter glue is still partly Python. The
*kernel* is Rust.

## Key decisions

### Big-bang Rust kernel: 5 components in 5 months

This is a fast cadence for engine-core work. Reading the PR list:

- v1.197 (#1786, #1785) — MessageBus v2, DataEngine v2.
- v1.204 (#1988) — Throttler.
- v1.205 (#2016) — Analysis.
- v1.206 (#2035) — RiskEngine.
- v1.206 (#2048) — ExecutionEngine.
- v1.207 (#2058) — Portfolio + AccountManager.

The PRs are interdependent: porting `RiskEngine` requires `MessageBus`
v2 to be in place. Porting `Portfolio` requires `ExecutionEngine` to
be ported. The order matters.

**Why it could happen this fast:** the Cache + MessageBus abstractions
(chapter 5) and the `NautilusKernel` unification (chapter 6) had been
designed to support exactly this. After 3+ years of preparing the
ground, the actual port is mostly mechanical.

### Globally shared data channels (Rust v1.206)

Rather than every engine component publishing to the bus and other
components subscribing (which is fine for events but heavy for tick
data), v1.206 introduces *globally shared data channels* — typed
broadcast channels (likely `tokio::sync::broadcast`) for the
high-volume paths. This is an internal optimisation; the bus
abstraction stays the same to the user.

### Type stubs for `core`, `common`, `model` (v1.208)

`.pyi` stub files for the Cython-bound enums and types. This is the
last piece of the IDE-discoverability puzzle: previously, IDE
type-checking couldn't see Cython types. The stubs give VS Code,
PyCharm, and mypy a chance to show the API correctly.

### `ShutdownSystem` command (v1.208)

A single `shutdown_system(...)` works in backtest, sandbox, and live.
This is a small thing but emblematic: the engine's *control plane*
also goes through the message bus, with a uniform shape across
environments.

### `Throttler` and `Analysis` ported

`Throttler` (rate limiter) and the `analysis` subpackage (PnL,
sharpe, drawdown, statistics) get ported alongside the engines.
This brings the *entire post-trade story* into Rust. By the end of
this chapter, you can run a backtest, compute PnL, and write the
catalog without touching Python's hot path.

## Casualties

- **Cython `MessageBus`** — not deleted yet, but second-class and
  dwindling.
- **Cython `DataEngine`** — same.
- **Cython `RiskEngine`** — same.
- **Cython `ExecutionEngine`** — same.
- **Cython `Portfolio`** — same.
- **`PolymarketDataLoader.fetch_orderbook_history`** etc. — much
  later (v1.224, chapter 14) but flagged here as the chapter where
  legacy paths start being marked.
- **Per-component clocks** — superseded by the global atomic clock
  (chapter 8) but the multi-clock test scaffolding has to be retired
  here.
- **`VenueStatus`** (v1.197) — removed; redundant with `InstrumentStatus`.

## Q&A

### Why is `MessageBus` "v2"? What was wrong with v1?

v1 was Cython, called from Python, dispatched by Python. v2 is Rust,
called from Rust *and* Python (via PyO3), dispatched on the Rust
runner. The naming "v2" is significant — it's the second from-scratch
implementation, not a refactor. Topic-matching, subscription
registration, and dispatch are all rewritten. (Topic-matching gets
optimised 100× later in v1.218.)

### Did the port introduce bugs?

Yes — many. Read the v1.197 → v1.209 release notes' "Fixes" sections.
A representative sample:

- v1.197: "Fixed `OrderBook` FFI API to take data by reference instead
  of by value" — a correctness regression introduced by the v1.196
  optimisation.
- v1.199: "Fixed `Position` exception type on duplicate fill (should
  be `KeyError` to align with the same error for `Order`)".
- v1.205: PyO3 deprecations en masse.
- v1.207: "Fixed catalog query mem leak".

This is *normal* for a port of this size. The fact that the bugs are
visible in release notes (not silent) is itself evidence of the
fail-fast policy paying off.

### Could the port have been done in one big atomic PR?

In theory. In practice no — the team would have lost the ability to
release for months, regression-tracking would have collapsed, and
each component's port has its own review surface. The 6-PR cadence
is right.

### Why "AccountManager" appears as a separate concept here?

It existed earlier (in Cython, inside `Portfolio`) but was always
extracted as the ported abstraction. `AccountManager` owns
account-state lifecycle (open, fund, close, balance updates).
`Portfolio` owns position-state and PnL aggregation. They were
intertwined in Cython; the port cleanly separates them.

## Insights for daily work

- After this chapter, the *kernel* is Rust. New engine features land
  in Rust *and* get exposed to Python via PyO3. When you're tempted
  to add logic to a Cython class, stop — ship it in the Rust kernel.
- The "globally shared data channels" mean that publishing data is
  cheaper than publishing events. If you're emitting a high-volume
  custom data type, expect the broadcast channel path; if you're
  emitting an event, expect the topic-matched bus.
- `tokio::sync::broadcast` channels lose old messages if subscribers
  fall behind. The implication: if your strategy callback is slow,
  it can drop ticks. The platform expects strategies to handle data
  fast enough; falling-behind logging exists but no replay.
- Engine-level state machines (`Component` FSM, see chapter 5) are
  enforced *in Rust* now. State transitions through the FSM raise
  Rust-side errors that surface as Python exceptions, not silent
  fallthrough.
- After the port, *backtest performance* is dramatically better.
  This is the chapter where Tardis-scale (100M ticks per backtest)
  and Databento-scale data become routine.
