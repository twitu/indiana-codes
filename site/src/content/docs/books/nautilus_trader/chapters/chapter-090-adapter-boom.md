---
title: "Chapter 090: Adapter Boom — Databento, Bybit, dYdX, Polymarket, OKX (2023-10 → 2024-09)"
---
**Period:** 2023-10-30 → 2024-09-21 (~11 months)
**Tags:** `v1.181.0` → `v1.200.0`
**Why this chapter exists:** This chapter is about *breadth*. While chapter 8
moves Redis and clocks to Rust (vertical depth), this chapter is the moment
the platform's adapter portfolio explodes. **Five major venues land in 11
months.** Each adapter forces refinements in the platform — `RetryManagerPool`
(common HTTP retry logic), composite bar types, the `@customdataclass`
decorator, OrderBook batching with `F_LAST`, error modeling, and more. By
v1.200 the platform looks like a serious multi-venue engine. **This chapter
runs in parallel with chapter 8 and chapter 10**, but is presented separately
because the adapter additions are independent of the engine port. It overlaps
chronologically with both.

## Adapter timeline

| First-commit date | Adapter | Notes |
|---|---|---|
| 2020-09-21 | binance | (chapter 2 era; long-running, many releases) |
| 2020-09-21 | bitmex | (chapter 2 era; goes through several rewrites) |
| 2021-03-18 | betfair | (chapter 4 era) |
| 2022-05-29 | deribit | (chapter 6 era; long-running) |
| **2023-10-30** | **databento** | **Market-data only**: Tier-1 US equities, futures, options. |
| **2023-12-04** | **bybit** | First major hand-written CEX since Binance. |
| 2024-08-22 | dydx | First DEX adapter (gRPC + websockets). |
| 2024-09-18 | polymarket | First prediction-market / `BinaryOption` adapter. |
| 2024-09-21 | okx | Major CEX. |

(Hyperliquid 2025-07, Kraken 2025-11, blockchain 2025-04, Architect AX
2026-01, Coinbase 2026-04 are chapter 13–15.)

## Tag timeline (release-note headlines)

| Date | Tag | Headline |
|------|-----|---------|
| 2023-10-22 | `v1.179.0` | Pre-Databento. |
| 2023-11-03 | `v1.180.0` | |
| 2023-12-23 | `v1.182.0` | Bybit lands. (chapter 8 milestone too) |
| 2024-01-12 | `v1.183.0` | Atomic clock + Rust logger (chapter 8) |
| 2024-01-29 | `v1.184.0` | |
| 2024-03-15 | `v1.189.0` | (continuing) |
| 2024-03-22 | `v1.190.0` | |
| 2024-05-31 | `v1.194.0` | |
| 2024-06-17 | `v1.195.0` | |
| 2024-07-05 | `v1.196.0` | Composite bar types (#1859), DataEngine OrderBookDelta `F_LAST` buffering. |
| 2024-08-02 | `v1.197.0` | **`MessageBus` v2 in Rust**, **`DataEngine` v2 in Rust**. (chapter 10 milestone) |
| 2024-08-09 | `v1.198.0` | **`@customdataclass` decorator** (#1828) — custom data finally low-friction. |
| 2024-08-19 | `v1.199.0` | Refactor of error modeling in Rust. Reconciliation robustness. |
| 2024-09-07 | `v1.200.0` | **dYdX integration** lands (a 20-PR mega-merge from @davidsblom). Composite bar types stable. `RetryManagerPool` for adapter retries. |

## Architecture moves driven by adapter requirements

### `OrderBookDeltas.batch` — `F_LAST` flag-based batching (v1.196)

Crypto venues (Bybit, dYdX, Polymarket) deliver order book updates as
*groups of deltas* in a single websocket message; they all share an
update sequence. Naively processing them one at a time would publish
intermediate inconsistent states (book briefly missing one side mid-update).
Solution: introduce a `F_LAST` flag on each delta; the data engine
buffers deltas until it sees `F_LAST`, then publishes the whole
batch atomically. This *also* solves the catalog story — Parquet
data needs deterministic batching boundaries to reproduce live behaviour.

### `@customdataclass` decorator (v1.198)

By 2024 several adapters (Polymarket, Databento, Tardis) had adapter-specific
data types (e.g. `BinanceFuturesMarkPriceUpdate`, `DYDXOraclePrice`). Each
needed boilerplate: register Arrow schema, register serializer, register
publication topic. The `@customdataclass` decorator collapses all of that
into one decorator. From this point, adding a custom data type to an
adapter is a 5-line PR, not a 50-line one.

### `RetryManagerPool` (v1.200)

Every adapter implemented its own retry logic (exponential backoff,
jitter, max retries). This drifted across adapters and produced subtle
behavioural differences. `RetryManagerPool` centralises retry logic
with a shared pool of retry managers, configurable per-call.

### Reconciliation overhaul (v1.197 → v1.199)

Live reconciliation — making the engine's view of orders and positions
match the venue's after a restart — is the hardest correctness problem
the project faces. v1.197–v1.199 add:

- `LiveExecEngineConfig.generate_missing_orders` — generate inferred
  orders when the venue reports a position that the engine doesn't
  know about.
- Improved robustness when internal positions disagree with external.
- Inferred orders also flow through the matching pipeline.

This is the seed of the much larger reconciliation rework in chapters
13–14, but the engine first acknowledges here that *internal and venue
state can disagree* and needs tools to reconcile.

### Composite bar types (v1.200)

Bars aggregated from other bar types (e.g. 5-minute bars from 1-minute
bars). Requested by users running multi-timeframe strategies. The
implementation requires the data engine to be aware of bar lineage.
This proves easier *after* `MessageBus` v2 (chapter 10) — composite
bars are a pub/sub layered subscription.

### `MessageBus` v2 + `DataEngine` v2 in Rust (v1.197)

These are the chapter 10 headline items, but they ship *during* the
adapter boom because the boom requires them. The pre-v2 MessageBus
was Cython-bound and couldn't be called from Rust adapters cleanly.
The v2 version is Rust-native; PyO3 bindings let Python call into it.
Adapters can now publish events directly from their Rust paths
without bouncing through Python.

## Key decisions

### Add adapters in order of demand, not difficulty

The order is suspicious: Databento (data only — easy), Bybit (CEX, but
similar to Binance), dYdX (DEX — hard), Polymarket (prediction market —
weird), OKX (CEX, complicated). The team did the easy ones first and
let the hard ones bake. This is also why dYdX needed 20 PRs to land
(`#1861, #1868, #1873, #1874, …`).

### dYdX as the first DEX adapter

dYdX uses gRPC for the chain-side stuff and websockets for the order
book. Neither pattern existed in the codebase. The dYdX integration
forced introducing `tonic` (gRPC), and the gRPC retry policy
(`6ee1d7b386 Add retry policy to gRPC client with fallback (#1887)`).
Future DEX adapters (Hyperliquid, Polymarket additions) borrow this
infrastructure.

### Polymarket / `BinaryOption` instrument

Polymarket trades binary outcomes (event happens or doesn't), so it
needs an instrument type that doesn't fit the standard
"price × quantity = value" mold. Adding `BinaryOption` validates the
data model's ability to absorb new instrument shapes — it's been a
goal since chapter 4's `Data` abstract base.

### Errors-as-data: error modeling overhaul (v1.199, v1.200)

Rust adapters were using a mix of `anyhow::Error`, custom enums, and
`Result<_, String>`. The v1.199–v1.200 work standardises on per-domain
error enums. Python sees them as `HttpClientError`, `WebSocketClientError`
etc. This is what enables (chapter 14+) the `due_post_only` flag on
`OrderRejected` and similar fine-grained error reporting.

## Casualties

- **Generic `Ticker` data type** — removed (chapter 8); replaced by
  per-adapter Ticker subtypes.
- **OrderBook subscription naming**: `subscribe_order_book_snapshots`
  → `subscribe_order_book_at_interval` (clarity).
- **Single-source retry logic in adapters** — replaced by
  `RetryManagerPool`.
- **Custom data type boilerplate** — replaced by `@customdataclass`.
- **Hard-coded WebSocket reconnection per adapter** — moved to
  `WebSocketClient` (Rust) with shared retry logic.

## Q&A

### Why does dYdX need 20 PRs?

DEXs are not exchanges. They have:

- A chain (block height, finality semantics, transaction nonce).
- An on-chain orderbook with a specific gRPC API.
- A separate websocket for indexer-derived market data.
- A wallet abstraction that's specific to the chain.
- Margin and account state computed from chain state, not API state.

Mapping that onto Nautilus's CEX-shaped abstractions took iteration.
Each PR shaved off another mismatch (gRPC retries, account state
parsing, websocket schema, position sign conventions, candle parsing,
etc.). Reading the v1.200 release notes' dYdX PR list end-to-end is
a tour of "what's hard about DEX integration."

### Why did Polymarket need its own instrument type?

A binary outcome's price is bounded `[0, 1]`. Existing instrument
types assume unbounded price ranges and have margin / pnl / leverage
fields that don't apply to binary outcomes. `BinaryOption` lets the
risk engine and portfolio compute the right notional / exposure /
PnL for these markets without special-cases scattered through the
engine. (Polymarket also brought USDC.e (PoS) as a recognised currency
and the `compute_effective_deltas` config option.)

### Why are these adapters all in `nautilus_trader/adapters/<name>/`
**and** in `crates/adapters/<name>/`?

Because the migration to Rust is in progress. New adapters target Rust
implementations with PyO3 bindings. The Python directory often holds
the *factory* (which the user imports) and the *config classes*; the
Rust crate holds the actual data/exec client. Older adapters
(Binance, Betfair, IB) still have a substantial Python tail.

### What's the difference between an `_pyo3` suffixed adapter directory
and the un-suffixed one?

`interactive_brokers_pyo3` is the *PyO3-bound* adapter; the un-suffixed
`interactive_brokers` is the older Cython implementation. Both are
shipped during the migration so users can choose. The PyO3 one is the
future. (See chapter 14 for the IB Rust adapter.)

## Insights for daily work

- **Adapter README's are not a substitute for reading the venue's API
  docs.** Each adapter's README explains how Nautilus maps to that
  venue, but quirks (e.g. Bybit's empty-string position side, Polymarket's
  USDC.e currency, dYdX's marketType parameter) only become obvious
  when you read the venue API.
- The `RetryManagerPool` pattern is the canonical retry surface. Don't
  hand-roll exponential backoff in a new adapter.
- `@customdataclass` is the canonical custom-data path. Don't subclass
  `Data` by hand unless you have a reason.
- The `F_LAST` / `F_SNAPSHOT` flag bitmask is *the* way to express
  batch boundaries. Adapters that emit one delta per message should
  set `F_LAST` on the *single* delta. Adapters that emit batched
  deltas should set `F_LAST` only on the final one.
- Reading reconciliation code: `OrderStatusReport` is "what the venue
  thinks", `Order` is "what Nautilus has". Reconciliation reconciles
  the two. Inferred orders/fills (the engine creating events to align
  state) are emitted with venue IDs but `Inferred=True`. They are
  recorded in the catalog like real events.
