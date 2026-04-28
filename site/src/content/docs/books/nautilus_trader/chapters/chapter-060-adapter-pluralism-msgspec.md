---
title: "Chapter 060: Adapter Pluralism, NautilusKernel, and msgspec (2021-10 → 2022-04)"
---
**Period:** 2021-10-01 → 2022-04-30 (~7 months)
**Tags:** `v1.131.0` → `v1.141.0`
**Why this chapter exists:** The platform stops being "the FX engine with a
few adapters bolted on" and becomes a multi-venue framework. `BinanceFutures`,
the first hand-written Interactive Brokers adapter, FTX (it would later be
removed), and the `OrderEmulator` all land here. `NautilusKernel` is created
to unify backtest and live systems under one orchestrator. `msgspec` replaces
`msgpack`. **This is the chapter where "research-to-live parity" — the
project's defining promise — first actually works**, because backtest and
live are now the same kernel.

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2021-10-10 | `v1.131.0` | |
| 2021-12-13 | `v1.135.0` | |
| 2021-12-29 | `v1.136.0` | OrderEmulator skeleton starts (`32fce64728 Add initial OrderEmulator skeleton`). |
| 2022-02-15 | `v1.138.0` | **`ExecutionId` renamed to `TradeId`** (more standard terminology). `working` orders renamed `open`; `completed` → `closed`. `trigger` → `trigger_price`. Big naming-cleanup release. |
| 2022-03-11 | **`v1.139.0`** | **Initial Binance Futures adapter (beta).** **Initial Interactive Brokers adapter (beta).** **`msgspec` replaces `msgpack`.** New conditional order types: `MARKET_TO_LIMIT`, `MARKET_IF_TOUCHED`, `LIMIT_IF_TOUCHED`. `CryptoFuture` instrument. |
| 2022-03-13 | `v1.140.0` | Pillow security fix (the version was bumped in error). |
| 2022-04-04 | **`v1.141.0`** | **`NautilusKernel` unified across backtest and live.** `BacktestNode.run_sync()` → `.run()`. `flatten_position()` → `close_position()`. Configuration consolidated into `config` subpackage. `BacktestNode` ergonomics overhaul. Docker image builds. |
| 2022-04-24 | (build) | First `**/*.rs` file appears in some path under the workspace; chapter 7 begins. |

## Architecture change

### Before (v1.130)

```
   ┌──────────────────────────────────────┐
   │  Live trading: TradingNode + kernel-y wiring
   │  Backtest:     BacktestEngine + its own wiring
   │  → Different code paths, different bugs.       │
   └──────────────────────────────────────┘
```

`BacktestEngine` and `TradingNode` had subtly different lifecycle code.
The same strategy could behave differently in backtest vs live because
of plumbing differences (clock setup, account initialisation order,
component start order).

### After (v1.141)

```
                ┌──────────────────────────┐
                │     NautilusKernel       │
                │  (one orchestrator)      │
                └──────┬───────────┬───────┘
                       │           │
              ┌────────▼─┐     ┌───▼──────────┐
              │ Backtest │     │  Live        │
              │ Engine   │     │  TradingNode │
              └────────┬─┘     └───┬──────────┘
                       │           │
                       └─── same ──┘
                            kernel,
                            same
                            components,
                            same FSM
```

**Same code path for backtest and live.** Only the clocks and the
data/exec clients change.

## Key decisions

### `OrderEmulator` for venues that don't natively support contingent orders

Most venues don't natively support OCO/OUO/OTO contingent orders, or
trailing stops, or stop-limit. The `OrderEmulator` (introduced v1.157
later in this chapter, conceptually started here) lets the engine emulate
those locally and submit only the active leg to the venue. This is
a substantial decision: it means the *engine*, not the venue, is the
source of truth for many order types.

**Why:** users want to write strategies once with rich order semantics
and have them run on any venue, including primitive ones. The engine
absorbs the heterogeneity.

**Trade-off:** if the engine crashes, the emulated leg disappears; only
the venue-side leg survives. Restart needs to recover the local state.
Hence the persistence story (Cache + Redis) gets stress-tested in this
chapter.

### Naming standardisation: `working`/`completed` → `open`/`closed`

This sounds cosmetic. It isn't. "Working" and "completed" are FX-shop
terminology. "Open" and "closed" are universal. Same for `ExecutionId`
→ `TradeId` (FIX-protocol-aligned), `trigger` → `trigger_price`. Every
later adapter author writes against the renamed terms; older docs and
external tutorials mention the older names for years.

**Why:** as the user base broadened beyond FX, terminology had to
follow.

### `msgspec` over `msgpack`/`json`

`msgspec` is a faster drop-in for `msgpack` and `json` with type-safe
schemas. The release notes call it "faster drop in replacement". The
serialization layer is a hot path (every event, every config, every
Redis write), and going from msgpack-based custom serialization to
msgspec gave measurable wins.

**Why:** msgpack's schema-less nature meant a lot of hand-written
glue. msgspec's struct-based approach matches the codebase's
"every type is well-defined" philosophy.

### Binance Futures + Interactive Brokers in the same release

v1.139 lands both. Binance Futures was the most-requested adapter for
crypto users; Interactive Brokers was the gateway for the entire
TradFi audience. Releasing them together is a deliberate signal: the
platform is *not* a crypto trading library, and *not* a TradFi
library — it's an engine that accommodates both.

### `NautilusKernel` is the single most important decision in this chapter

The unification of backtest and live runtimes under one kernel is *the*
"research-to-live parity" delivery. Until this point, "the same strategy
runs in both" was aspirational; after this point, it is mechanical. Every
engine improvement now lands in both backtest and live with no extra
work.

## Casualties

- **`bracket_order` flatten terminology** — `flatten_position()` →
  `close_position()` (more conventional).
- **`PerformanceAnalyzer`** — renamed `PortfolioAnalyzer`.
- **`hyperopt`** — moved to optional extra; removed as a default
  dependency.
- **CCXT-via-CCXT venues** — the Binance Futures release marks the
  beginning of CCXT's slow death. The hand-written path is preferred.
- **`msgpack` as the primary serialiser** — replaced by msgspec
  (msgpack briefly survives as a niche option).

## Q&A

### Why was FTX integrated and then removed?

FTX was added during this chapter and lived through several releases.
It was **removed in v1.159 (Nov 2022)** — chapter 7's window —
unsurprisingly, just after the FTX exchange itself collapsed. The
maintainer kept the adapter long enough that users with active accounts
could withdraw, then ripped it out. Searching for `Remove FTX integration`
in the git log lands on the killing commit (`e46f886e61`).
Lesson: adapter inclusion is not a long-term promise; venues come and
go.

### Why is `OrderEmulator` part of the *engine* and not part of each adapter?

If every adapter implemented its own emulation, the same bug would be
written 14 times. By centralising emulation in the engine, the venue
adapters can stay thin (they translate native orders only). The cost is
that the matching-core invariants live in the engine, not on the
venue — but that aligns with the "research-to-live parity" goal: backtest
fills and live emulated fills go through the same code.

### Why was `NautilusKernel` not the original design?

It was probably aspirational from chapter 1, but the codebase wasn't
clean enough. Until the Cache was unified (chapter 5) and the
MessageBus existed, there was nothing common enough to extract a
"kernel" out of. Once those two abstractions were in place, the
extraction was almost mechanical. v1.141 simply finishes the job.

### Did the IB adapter ship complete in v1.139?

No — it shipped *beta*. There's a long tail of fixes through chapters
7 and 8 ("Numerous fixes to the Interactive Brokers adapter, thanks
@limx0 and @rsmb7z" appears in nearly every release note for two
years). IB's API surface is enormous; getting it production-ready took
about a year and external contributor effort.

## Insights for daily work

- When you see code branching on `Environment.BACKTEST` vs
  `Environment.LIVE`, that is *post*-v1.141 design. Pre-v1.141
  branching looked like "different class trees".
- `OrderEmulator` is *transparent* to a strategy. The strategy submits
  an OCO; the emulator decides whether to submit one leg or both,
  depending on venue capability. If you're debugging "my order didn't
  go to the venue", check the emulator — it might be holding it.
- `msgspec` `Struct` types are the convention for configs. Don't use
  dataclasses. Don't use Pydantic for new config types. Don't roll
  your own. The serialization layer assumes msgspec.
- `TradeId` (renamed from `ExecutionId` in v1.138) is the venue's
  fill identifier, not Nautilus's internal ID. Don't conflate it with
  `OrderFilled.event_id`.
