---
title: "Chapter 120: Modernizing the Build — uv, Mark Prices, OwnOrderBook, Backtest Engine in Rust (2025-03)"
---
**Period:** 2025-03-01 → 2025-03-31 (~1 month)
**Tags:** `v1.212.0` → `v1.213.0`
**Why this chapter exists:** Three independent strands ship in one month:
**(1)** Poetry → **`uv`** for Python dependency management; **(2)** mark
prices and `PortfolioConfig` (the portfolio finally distinguishes mark price,
last trade, and exchange-rate conversion); **(3)** the `OwnOrderBook`
self-trade prevention abstraction. Plus the Backtest Engine + Kernel get
ported to Rust (#2449). It is a busy month with each strand being substantial
on its own. The actor framework gets a v3 (#2402), confirming that even
v2 of MessageBus / DataEngine wasn't the end state.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2025-03-11 | `v1.212.0` | **`uv` introduced** as the Python project / dependency manager. **`OwnOrderBook` and `OwnBookOrder`** for self-trade prevention. **Mark price handling for `Cache` and `Portfolio`**. **`PortfolioConfig`** with `use_mark_prices`, `use_mark_xrates`, `convert_to_account_base_currency`. Greeks data improvements. **Actor framework + MessageBus v3** (#2402). Latency modeling for `SimulatedExchange` in Rust. Many `OrderMatchingEngine` Rust ports. TA-Lib subpackage *removed*. |
| 2025-03-16 | `v1.213.0` | **`CryptoOption` instrument** (inverse + fractional sizes). `Cache.prices(...)` map. `use_uuid_client_order_ids` `StrategyConfig` option. **Catalog consolidation functions**. **Backtest engine + kernel ported to Rust** (#2449). Cython 3.1.0a1 → recent. Rust → 1.85.0 + 2024 edition. |

## Architecture moves

### `uv` for Python

Poetry was getting slow on the Nautilus project. Resolving dependencies
and installing them for CI runs was a notable share of build time.
`uv` (from astral.sh, the Ruff team) is dramatically faster at
both. The change is largely mechanical (`pyproject.toml` keeps Poetry
metadata, but lockfiles and venv handling go through `uv`), but it
affects every contributor's local workflow.

**Why:** chapter 12 has 421 commits in May 2025 alone — the project's
peak monthly cadence. Build infrastructure had to keep up. `uv` is
the modern answer.

### `OwnOrderBook` for self-trade prevention

When you make a market on a venue (place orders on both sides), you
risk *self-trade*: your buy fills your sell, generating a fictional
trade and possibly burning fees / triggering venue-side STP rules.
`OwnOrderBook` tracks *the engine's own resting orders* in a separate
book structure, so that when the engine considers placing or modifying
an order, it can see what its own existing orders would crash into.
`OwnBookOrder` represents one such order in the local book.

**Why:** before this, market-making strategies in Nautilus had to
reimplement self-trade prevention themselves. Ugly, error-prone.
`OwnOrderBook` centralises the logic in the engine. The
`Cache.own_order_book(...)`, `own_bid_orders(...)`, `own_ask_orders(...)`
methods make it accessible to strategies.

### Mark prices and `PortfolioConfig`

The `Portfolio` previously used "last trade price" or "best bid/ask"
to compute unrealised PnL. For derivatives — funding-rate futures,
perpetuals, options — the *mark price* (a venue-published reference
price) is the right input. `PortfolioConfig` adds:

- `use_mark_prices` — switch to mark price for PnL.
- `use_mark_xrates` — use mark exchange rates rather than last-trade
  rates for currency conversion.
- `convert_to_account_base_currency` — auto-convert PnL to the
  account's base currency.

Combined with `Mark` as a new `PriceType` enum variant, this lets a
trader build a portfolio view that matches what the venue computes
(important for cross-margin and PME at the venue side).

**Why:** the user base has grown to include serious crypto-derivatives
traders. Their PnL doesn't match the venue's PnL because the
inputs differ. The fix is to source the same input.

### Actor + MessageBus v3 (#2402)

Even after the v2 port (chapter 10), there were ergonomics issues
exposed by adapter authors trying to use the Rust MessageBus
directly. v3 (referred to as the "actor framework + message bus v3")
refines the API. The `Actor` trait and `Component` trait separation
(see `docs/concepts/architecture.md`) is finalised here. Throttler,
Strategy, DataEngine, ExecutionEngine all conform to the cleaned-up
trait hierarchy.

### Backtest engine + kernel in Rust (#2449)

This is the *last* big port. After this, the kernel is fully Rust.
Backtest runs a Rust kernel in a Rust runtime; only the strategy
callbacks (and any Python `Actor`) bounce through PyO3.

**Why:** to give backtests the same performance characteristics as
live, and to allow Rust-only strategies to skip Python entirely.
This is the precondition for "Rust-native trading systems" claimed
in the README.

### Catalog consolidation

`consolidate_data_by_period` and `consolidate_catalog_by_period`
let users merge per-day or per-instrument Parquet fragments into
per-period larger files. Streaming-writer catalogs accumulate many
small files; consolidating them is a maintenance task. Adding it to
the catalog API is a nod to operational reality.

### `CryptoOption` instrument

Crypto exchanges (Bybit, OKX, Deribit) have been gaining options
markets. Their options have *inverse* and *fractional* sizing
characteristics that don't fit `OptionContract` (which assumes
TradFi-style multipliers). `CryptoOption` is the new shape for
those.

## Key decisions

### Major Rust runtime version bump (1.85.0 + 2024 edition)

Each chapter from 7 onwards has tracked the latest Rust. The 2024
edition is significant — the README's MSRV note says: "NautilusTrader
relies heavily on improvements in the Rust language and compiler.
As a result, the Minimum Supported Rust Version (MSRV) is generally
equal to the latest stable release of Rust." This is unusual. Most
Rust libraries lag MSRV by 6–12 months for compatibility. Nautilus
runs at the bleeding edge.

### Dropping TA-Lib (announced in chapter 11, executed here)

The Rust ports of all the indicators that mattered are in. TA-Lib
the C library can go. `v1.212` removes the subpackage outright.

### Refactor data subscriptions and requests into messages (#2260, #2280, #2375)

Subscription / unsubscription / data request flow now goes through
explicit message types (`Subscribe<T>`, `Unsubscribe<T>`,
`Request<T>`) on the message bus instead of method calls. This is
quieter than other changes but it's *the* refactor that makes the
data engine fully bus-driven (no more direct method calls between
`DataEngine` and `Actor` for subscription management).

## Casualties

- **Poetry as the package manager** — replaced.
- **TA-Lib subpackage** — removed.
- **`ExchangeRateCalculator` (internal)** — replaced with Rust-implemented
  `get_exchange_rate(...)`.
- **`ForexSession` enum (Cython)** — replaced with PyO3 equivalent.
- **`InterestRateData`** — renamed `YieldCurveData` (#2300).
- **`Cache.add_interest_rate_curve`** — renamed `add_yield_curve`.
- **`OrderBook.count`** — renamed `update_count`.
- **`ExecEngineConfig.portfolio_bar_updates`** — moved to `PortfolioConfig.bar_updates`.

## Q&A

### Why was `uv` chosen over `Poetry` (or `pdm`, `hatch`, etc.)?

`uv` is significantly faster than alternatives for the kind of
dependency churn the project sees (frequent CI runs, many platform
combinations). The bigger context: the maintainer team is clearly
quality-of-life-focused for itself (Rust → 2024 edition,
cargo-nextest, sccache) and `uv` fits that pattern.

### Why introduce `OwnOrderBook` here and not earlier?

Self-trade prevention is a problem only for users running market
makers across multiple resting orders on the same instrument. The
user base became big enough to include such users *now*. The
maintainer's pattern is "build for actual demand, not theoretical."

### How does mark price differ from last-trade price for PnL?

Last trade can be stale (no recent trade) or noisy (one-share
trade at an outlier price). Mark is the venue's continuously-updated
reference; for perpetuals it's typically `index +/- premium`. Using
mark for unrealised PnL matches what the venue's UI shows the user,
and matches what triggers liquidations on the venue. Discrepancies
between Nautilus PnL and venue PnL were a recurring user complaint —
mark prices fix it.

### Why MessageBus v3 (and v4 isn't far off)?

The v2 port (chapter 10) was *correctness-driven* — make the bus
work in Rust. v3 is *ergonomics-driven* — make the bus pleasant to
use from Rust. There's no v4 explicit yet, but topic-matching
optimisation in chapter 13 (v1.218: 100× faster) is essentially v3.5.
The release-note culture's tolerance for "vN" naming reflects the
maintainer's honesty about the design not being settled.

### What's the relationship between the Backtest Engine port and live?

Identical. The Rust backtest engine runs the same kernel as live;
only the time source (test clock vs live clock) and the data sources
(disk vs network) differ. The chapter-6 vision of unified
backtest+live now ships *all* in Rust.

## Insights for daily work

- Use `uv` for everything (`uv pip install`, `uv run pytest`). The
  Makefile is updated; see `make help` for self-documenting targets
  (chapter 13 added `make` self-documentation).
- When you need self-trade prevention, query `cache.own_order_book(
  instrument_id)` rather than rolling your own.
- For PnL questions, set `PortfolioConfig.use_mark_prices=True` to
  match venue-side accounting. Without it, your Nautilus PnL will
  drift from your venue UI.
- The Rust backtest engine is *much* faster than Cython; if you
  haven't moved your backtest harness to the Rust path, you're
  leaving 5–10× speed on the table.
- `MessageBus` topic patterns: Rust-side wildcard matching is now
  100× faster than v2 (chapter 13 fix). Don't avoid wildcards for
  perf reasons — use them naturally.
