---
title: "Chapter 150: Toward 2.0 — bon Builders, v2 LiveNode, Deterministic Simulation Testing, Options & Greeks (2026-03 → 2026-04)"
---
**Period:** 2026-03-01 → 2026-04-27 (~2 months — current)
**Tags:** `v1.225.0` (released 2026-04-06) → `v1.226.0 Beta` (in flight)
**Why this chapter exists:** This is the *current* chapter. The maintainer
team is making a few coordinated, structural moves at once: the **`bon` crate
becomes the canonical config builder pattern** across the entire codebase
(replacing hand-rolled `::new` constructors); a **v2 `LiveNode`** (Rust-native
live trading orchestrator) ships and accepts Python strategies / actors /
exec algorithms; **deterministic simulation testing (DST)** infrastructure is
introduced behind a `simulation` feature; **options chains and Greeks** become
first-class in both Rust and Python. Plus continued adapter additions
(Coinbase US new, AX Exchange, Hyperliquid HIP-3, Tardis live streaming).
**The visible direction is "stabilize towards v2.0"** — the ROADMAP.md
pre-commits to a stable API at v2.0 with formal deprecation, after the
Rust port is done.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2026-04-06 | `v1.225.0` | **Options chains and Greeks in Rust** (#3637) and **Python** (#3677). **Custom data registration in Rust** (#3542). **`nautilus_actor!` and `nautilus_strategy!` macros** in Rust for boilerplate elimination. **Bybit instrument status polling**. **OKX bracket order with attached TP/SL**. **OKX option greeks subscription**. **Hyperliquid agent wallet** support. **Kraken xStocks tokenized assets**. **Bon `Builder` defaults as single source of truth**. Many error / lifecycle improvements. **Architect AX adapter** (first commits 2026-01-06, fully integrated). **Coinbase (US)** adapter first commits 2026-04-07. |
| (current) | `v1.226.0 Beta` | (in flight; `RELEASES.md` line 1 = `# NautilusTrader 1.226.0 Beta`) **Deterministic simulation testing (DST) re-export module** gated behind `simulation` feature. `wall_clock_now` seam for virtual time under simulation. `biased` `tokio::select!` for deterministic poll order. **Architect AX environment enum**. Bybit `BybitEnvironment`. Many adapters get `environment` enum config. **`ParquetDataCatalogV2` renamed to `ParquetDataCatalog`** (the V2 was the migration target; now it just is the catalog). |

## Architecture moves

### `bon` builders everywhere (v1.225)

`bon` (https://crates.io/crates/bon) is a Rust derive-macro builder
crate. Before this chapter many config structs had hand-rolled
`::new(arg1, arg2, …)` constructors with N positional arguments;
adding a new field meant a breaking signature change. v1.225 migrates
the codebase: every config struct uses `#[derive(Builder)]`,
`Default::default()` delegates to `Self::builder().build()`, and
fields with sensible defaults move from `Option<T>` to `T` with
`#[builder(default)]`.

Removed in this migration:

- `DataEngineConfig::new` 12-arg positional constructor.
- `OrderMatchingEngineConfig::new` and `with_price_protection_points`.
- `BlockchainDataClientConfig::new`, `BlockchainExecutionClientConfig::new`,
  `DexPoolFilters::new`.
- `DeribitExecClientConfig::new`, `HyperliquidExecClientConfig::new`.

This is the third config-system iteration (msgspec, then bon Python /
Rust split, now bon-as-single-source-of-truth) and is the one the
maintainer apparently considers stable enough to remove all the
escape hatches.

**Why:** the v1.225 release notes' breaking-changes list literally
is "removed `Foo::new`; use `Foo::builder()`". Builder pattern wins
because it's robust to additive change. **For an excavator, the `bon`
migration is the most important *ergonomic* change in the entire
project's history** — it sets the API tone for v2.0.

### v2 `LiveNode` accepting Python strategies (v1.225)

`LiveNode::add_strategy_from_config` and `add_exec_algorithm_from_config`
now accept Python strategy / exec algorithm configs from a Rust live
node. This is the apparent endgame of the Rust port: a Rust live
trading node that runs Python strategies, where the kernel is fully
Rust and only the strategy callbacks bounce through PyO3.

The macros `nautilus_actor!` and `nautilus_strategy!` (also in v1.225)
make it almost free for a *Rust* user to write a strategy — the macro
generates the `Deref`/`DerefMut`/`Strategy` trait boilerplate.

### Deterministic simulation testing (DST, v1.226)

A `simulation` feature is added to `nautilus-core`. With it enabled:

- `wall_clock_now` is overridable.
- `tokio::select!` blocks use `biased` so polling order is
  deterministic (relevant when the simulator wants reproducible test
  runs).
- A re-export module is gated behind the feature flag.

This matures the "chaos testing with `turmoil`" work from chapter 13.
DST is a hot topic in distributed systems testing
(FoundationDB-style simulation testing). For a trading platform, DST
means you can replay an entire day's worth of network events and
clock advances *deterministically* — same input always produces same
output. The implication: regression bug-hunting becomes much
cheaper. **This is among the most ambitious testing infrastructure
investments in the project's history.**

### Options chains and Greeks in Rust *and* Python (v1.225)

Options had been worked on in chunks (the `GreeksCalculator` was
ported in chapter 13's v1.216, v1.217); v1.225 lands a complete
options-chain abstraction and full Black-Scholes / Adjusted Greeks
support. OKX, Bybit, Deribit, IB all surface option greeks through
the same `OptionGreeks` data type. Polymarket has its own (binary
options). The greeks concept guide and options concept guide are
added to `docs/concepts/`.

This is the maintainer's response to v1.225 having a clear
"derivatives-and-options trader" user segment — the data model
now meets them.

### Custom data registration, persistence, routing in Rust (v1.225)

Until v1.225, registering a custom data type for Rust meant several
manual steps. v1.225 (#3542) makes it a single registration call —
the type is then routed through MessageBus, persisted in the
catalog, and Arrow-serialized automatically. This is the *Rust-side*
equivalent of the Python `@customdataclass` decorator (chapter 9,
v1.198).

### Tardis live streaming + `DerivativeTickerCache` (v1.225)

Until v1.225, Tardis was historical-data-only. v1.225 adds live
streaming via `stream_options` config (Tardis Machine →
Nautilus). The `DerivativeTickerCache` deduplicates unchanged
funding-rate / mark-price / index-price updates so downstream
subscribers don't see redundant events.

### Catalog rename: `ParquetDataCatalogV2` → `ParquetDataCatalog`

The "v2" suffix was a transitional marker — chapter 7 (v1.174-v1.175)
flagged a catalog v2 schema break. By v1.225 the v1 catalog is gone
and the v2 *is* the catalog. Same for `StreamingFeatherWriterV2` →
`StreamingFeatherWriter`.

### `ExecutionEngine` errors when no client matches (v1.225 fix)

Pre-v1.225, if an `ExecutionEngine` couldn't find an execution client
for a `SubmitOrder` command, it silently dropped the command. v1.225
makes this an `OrderDenied` event. Fail-loud-not-silent — consistent
with the project's overall direction.

## Casualties

- **Hand-rolled `::new` constructors on 6+ config types** — replaced
  by `bon` builders.
- **`ParquetDataCatalogV2` / `StreamingFeatherWriterV2`** — renamed.
- **`DatabentoLiveClient.key`** property — replaced by `api_key`.
- **`Ustr` for credentials** (chapter 14 step continued) — `Box<str>`.
- **`COINBASE_INTX` adapter** (chapter 14 removal) replaced by Coinbase
  US (this chapter, fresh start).
- **Hyperliquid `revoke_hyperliquid_builder_fee` script** — removed
  (builder fees no longer charged).
- **Synthetic `ACCOUNT-*` placeholders** in margin adapters —
  removed; `MarginBalance` emits with currency only.
- **`indicators` from `nautilus-common` default features** — opt-in
  via `features = ["indicators"]`.

## Q&A

### Why migrate to `bon` *now* if the project is at "v1.225"?

Because v2.0 is on the roadmap and the maintainer wants the *API*
that v2.0 stabilises to be the bon-builder API, not the `::new`
positional API. Doing it before v2.0's deprecation freeze is much
cheaper than doing it after.

### What does deterministic simulation testing actually buy?

Two things: (1) flaky-test elimination — tests that fail on tokio
scheduling order can't fail anymore because order is fixed; (2)
production-bug reproduction — a recorded production trace can be
replayed against a simulator deterministically to find the bug
without running real exchanges. Both are *huge* for a trading
platform's reliability story.

### Is v2.0 imminent?

The ROADMAP.md says "stable API for version 2.x (likely after the
Rust port)." The Rust port is essentially done at this chapter (kernel,
engines, OrderBook, network, catalog, live node). The remaining work
is *peeling Cython out* (interactive_brokers Cython adapter still
exists alongside the Rust one), and getting the bon-builder API
stable across all configs. The work in *this* chapter is the
preconditioned for v2.0.

### Are the macros `nautilus_actor!` and `nautilus_strategy!` going to
swallow the whole codebase?

Probably yes, for Rust-side actors and strategies. The pattern is the
same as Cython's `cdef class` from genesis: derive-macros that
generate the boilerplate so users write one line of intent instead
of ten lines of trait implementation.

### Why introduce `BybitEnvironment` and `BinanceEnvironment` enums *now*?

Because previously, "demo vs testnet vs live" was scattered across
adapter configs as multiple booleans (`is_sandbox`, `is_demo`,
`is_testnet`). An enum with `Live | Testnet | Demo | Sandbox`
variants is unambiguous and lets the adapter pick correct URLs /
auth / WS endpoints from a single source of truth. The release
notes explicitly call this "aligning with the Binance/Bybit/Kraken
adapter pattern." This is the maintainer harvesting a pattern that
worked.

## Insights for daily work

- New configs should always be `#[derive(bon::Builder)]`. Hand-rolled
  `::new` constructors are obsolete.
- For `Default` impls, delegate to `Self::builder().build()` rather
  than constructing the struct field-by-field. Single source of
  truth for defaults.
- For an *ergonomic* Rust strategy, use the `nautilus_strategy!`
  macro. It saves ~30 lines of trait-impl boilerplate per strategy.
- DST is gated behind the `simulation` Cargo feature. If you want
  deterministic tests in your downstream Rust code, enable it.
- `tokio::select!` in the network and live crates is `biased` —
  meaning poll order matters. Don't reorder branches without thinking
  about it.
- The catalog is just `ParquetDataCatalog` now; the `V2` suffix is
  gone. If your code still imports the V2 name, update it.
- Read the **2.0 plan** in `ROADMAP.md`. Anything you build between
  now and v2.0 is going to live through a deprecation cycle —
  align with the bon-builder / PyO3 / Rust-kernel direction or you
  build technical debt.
