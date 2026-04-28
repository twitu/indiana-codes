---
title: "Chapter 140: Crash-Only, Cryptography, and Multi-Account — BitMEX, Kraken, AX, Coinbase (2025-08 → 2026-03)"
---
**Period:** 2025-08-01 → 2026-03-31 (~8 months)
**Tags:** `v1.220.0` → `v1.224.0`
**Why this chapter exists:** This is the chapter where the platform finishes
hardening (the chapter-13 work continues), expands the adapter portfolio
again (Kraken, BitMEX, Architect AX), introduces multi-account execution,
gets a Rust BitMEX/IB Rust adapter, and ports the Bybit adapter to Rust
end-to-end. **Multi-account is the single most architecturally significant
addition** here — it's the precondition for prop-trading multi-strategy
deployments. Cap'n Proto serialization arrives as a zero-copy alternative.
Funding rates become first-class data. Python 3.11 support is dropped;
3.13 / 3.14 lands.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2025-09-09 | `v1.220.0` | **Initial BitMEX integration adapter.** **`FundingRateUpdate`** data type with cache and subscriptions. **`due_post_only` field on `OrderRejected`**. Custom error logging for `RetryManager`. **Bybit options support**. `OptionExerciseModule`. `MarginModel` concept and base models for backtesting. dYdX large-history support. |
| 2025-10-26 | `v1.221.0` | **Final release with Python 3.11 support.** Continued hardening. |
| 2026-01-01 | `v1.222.0` | **Python 3.14 support.** **Kraken integration adapter.** **Cap'n Proto (`capnp`) serialization** for zero-copy data interchange. **Initial backtest visualization tearsheets with plotly.** Matching engine `liquidity_consumption` config. `Quantity.from_decimal`, `Price.from_decimal`, `Money.from_decimal`. Polymarket `PolymarketDataLoader`. Many DeFi pool / DEX additions. **`PositionAdjusted`** events for tracking quantity / PnL changes outside normal fills. Many Deribit / dYdX-v4 / Bybit Rust ports. |
| 2026-02-21 | `v1.223.0` | **Multi-account execution** (#3194). **Sandbox execution adapter in Rust**. **Nasdaq ITCH 5.0 parser**. Grid market maker example in Rust. `OrderBookDeltas` historical request support. **Removed dYdX v3 (legacy) Python adapter** (v3 exchange decommissioned end of 2024). `manage_stop` config option. `oto_trigger_mode` venue config. `use_market_order_acks` config. Tracing subscriber for external Rust library logs. **Removed `AddAssign`/`SubAssign`** trait impls. |
| 2026-03-03 | `v1.224.0` | **Removed Coinbase International adapter** (RFC #3555). Many Betfair / Hyperliquid / Bybit / IB / Polymarket additions. BitMEX dead-man's-switch support. OKX trailing stop. Hyperliquid order modify. **Standardized credential zeroization** across all adapters (`Box<str>` for API keys; redacted in `Debug`). **Docker image cosign signing + SBOM**. `pip-audit` in security pipeline. |

## Architecture moves

### Multi-account execution (v1.223, #3194)

Until v1.223, an `ExecutionEngine` had one account per venue. v1.223 lets
a single venue have multiple accounts (e.g. main + paper, or multiple
sub-accounts on the same exchange). The `ExecutionEngine.register_client`
function gains explicit account-routing semantics; in v1.225 (chapter 15)
it becomes an *error* to route a venue to a different client without
explicit re-registration.

**Why:** professional users running multi-strategy deployments need
multiple sub-accounts (e.g. for risk segregation). Until this, they
had to run multiple Nautilus instances. Multi-account is the
single-instance solution.

### Cap'n Proto for serialization (v1.222, opt-in)

`capnp` is added as an opt-in feature flag in `nautilus-serialization`.
For users of high-volume external streams (cross-process data
distribution, replays), `capnp` zero-copy decoding is dramatically
cheaper than msgspec / msgpack. The maintainer gated it behind a
feature flag — most users don't need it, and adding capnp as a hard
dep would inflate Docker images.

### Funding rates as first-class data (v1.220)

`FundingRateUpdate`, `subscribe_funding_rates`, `on_funding_rate`,
`Cache.funding_rate(...)`. Until this, funding rates were
adapter-specific custom data. v1.220 promotes them to a standard
type because too many adapters needed it (Bybit, Binance Futures,
Hyperliquid, OKX, Deribit, dYdX). This is the same pattern that
played out for `MarkPriceUpdate` (chapter 12) — once enough adapters
need a thing, it gets standardised.

### Tracing subscriber (v1.223)

`use_tracing=True` in `LoggingConfig` enables `tracing-subscriber` for
external Rust library logs (filterable with `RUST_LOG`). This is the
chapter where Nautilus's Rust internals stop being a black box — you
can wire their logs into journald, Loki, etc.

### `due_post_only` flag on `OrderRejected` (v1.220)

A small change with large operational value: when a venue rejects a
post-only order (because it would have crossed), the rejection event
carries `due_post_only=True`. Strategies can now distinguish "real
rejection" from "post-only protection fired" without parsing the
venue's reason string.

### Standardized credential zeroization (v1.224)

API keys and secrets are stored as `Box<str>` (heap-allocated, can be
zeroized on drop) rather than `Ustr` (interned, cannot). Every
adapter's `Credential` struct is updated. `Debug` impls redact secret
fields. This is paranoid-but-correct behaviour for a security-sensitive
library — even crash dumps don't leak credentials.

### `liquidity_consumption` for matching engine (v1.222)

The matching engine can now track per-level book consumption — multiple
orders matching the same trade tick collectively don't overfill the
displayed liquidity. Important for tick-replay backtests where the
same trade tick can match several resting orders.

### Removed dYdX v3 (v1.223)

The dYdX v3 exchange was decommissioned end of 2024. The Python
adapter is removed. dYdX v4 (Rust-backed, no Python deps) renamed to
just `dydx`. The `[dydx]` install extra is gone. Lesson: **adapters
go away when their venues do**.

### Coinbase International removed (v1.224, RFC #3555)

`COINBASE_INTX` adapter removed via RFC. (Coinbase US comes back as a
new adapter in v1.225 — different code, different scope.) The pattern:
adapters that don't carry their weight get removed via RFC, not
silently sunset.

## Casualties

- **dYdX v3 (legacy)** Python adapter — removed.
- **Coinbase International adapter** — removed via RFC.
- **Python 3.11 support** — dropped (3.12+ minimum).
- **`AddAssign`/`SubAssign`/`MulAssign`** on `Price`/`Quantity`/`Money` —
  removed; use `x = x + y`. Reason: precision-mismatch panics in
  `+=` were too easy to hit.
- **`use_ws_trade_api` Bybit config** — removed (causes confusion since
  Bybit demo doesn't support WebSocket Trade API).
- **`prob_fill_on_stop` from `FillModel`** — removed (stop orders trigger
  deterministically; no queue position to simulate).
- **OKX URL env-var overrides** — removed; use config fields.
- **`max_ws_reconnection_tries` (any leftover)** — gone.
- **Native OpenSSL** — gone (chapter 13 step continued).
- **`Ustr`-stored credentials** — replaced with `Box<str>`.

## Q&A

### Why did multi-account execution take so long to land?

Because the engine was designed around single-account semantics from
chapter 1. Every component — `Portfolio`, `RiskEngine`, `Cache` —
assumed one account per venue. Refactoring all of them to take an
`Option<&AccountId>` parameter (which v1.225 does explicitly for
PnL queries) without breaking single-account users took time.
Multi-account is also harder to test — backtesting with multiple
accounts on one venue needs careful initial state setup.

### Why Cap'n Proto if msgspec already exists?

msgspec is the *primary* serializer (in-memory configs, internal
serialization). Cap'n Proto is for **external** zero-copy interchange
where the receiver doesn't need to deserialize the whole struct to
read one field. Use cases: cross-process data distribution, replay
files, cold archive. The two coexist.

### Why standardise credential zeroization now?

Two reasons:

1. The increasing number of adapters made it likely that some
   credential type wasn't zeroizing properly, and finding which one
   would be a pain.
2. The supply-chain security work (`pip-audit`, `cargo-vet`,
   `osv-scanner` — v1.222 internal improvements list) was happening
   anyway, and credentials are part of it.

### Why is Coinbase Intl removed but Coinbase US is reintroduced in v1.225?

Coinbase International and Coinbase US are *different exchanges* with
different APIs and audiences. `COINBASE_INTX` had been a workout the
maintainer judged not worth the maintenance cost. Coinbase US is the
flagship; v1.225 builds it cleanly from scratch. RFC #3555 has the
discussion (per release notes).

### Why introduce `PositionAdjusted` events?

Because positions can change for reasons that aren't a normal fill:
funding payments (your position size doesn't change but PnL does),
manual adjustments by ops, base-currency commissions on inverse
instruments. The event type makes those visible to strategies that
need to know about them (e.g. PnL accounting that wants to allocate
funding to a specific strategy).

## Insights for daily work

- Multi-account configs require explicitly registering
  `(venue, account_id)` pairs at engine setup. The engine errors if
  you try to add a duplicate — fail-fast is on by default.
- `due_post_only` is the right way to detect post-only rejections.
  Don't parse the venue's `reason` string.
- If you need zero-copy serialization for an external pipeline,
  enable the `capnp` feature in `nautilus-serialization`. Otherwise
  msgspec is the answer.
- `tracing-subscriber` is the right way to integrate Rust logs with
  external observability (Loki, Tempo, etc.). Filter via `RUST_LOG`,
  not in-code log-level config.
- After v1.224, *every adapter's `Credential` zeroizes on drop*.
  Don't subvert this in custom adapters — store credentials as
  `Box<str>` (or `Secret<String>` from a crate that does the same).
- Funding rates: subscribe through `Actor.subscribe_funding_rates(...)`,
  handle `on_funding_rate(...)`. Don't reach into the adapter's
  custom data type.
