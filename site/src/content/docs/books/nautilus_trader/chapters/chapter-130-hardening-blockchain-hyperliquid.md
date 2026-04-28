---
title: "Chapter 130: Hardening — Robust Reconnects, Reconciliation, Blockchain Adapter, Hyperliquid (2025-04 → 2025-07)"
---
**Period:** 2025-04-01 → 2025-07-31 (~4 months)
**Tags:** `v1.214.0` → `v1.219.0`
**Why this chapter exists:** This chapter has two themes that are easy to
read in the release notes:

1. **Robustness work**: exponential-backoff reconnects, infinite retries,
   reconciliation generating inferred orders / fills, log-file rotation,
   socket-client state-machine cleanup, error-message standardisation.
2. **DEX expansion**: the **blockchain adapter** lands (DEX-agnostic with
   HyperSync, supporting DEX swaps and pool liquidity); **Hyperliquid**
   adapter ships; cryptography moves to **`aws-lc-rs`** for FIPS-readiness.

Plus property-based testing, chaos testing with `turmoil`, and the first
appearance of "deterministic simulation testing" infrastructure
(matures in chapter 15). Also: Linux ARM64 wheels, log-file rotation, FFI
hardening.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2025-04-13 | `v1.216.0` | Python 3.13 support, Linux ARM64, log file rotation (`max_file_size`, `max_backup_count`), `MarkPriceUpdate` Arrow schema, `Position.closing_order_side()`. **Greeks calculator ported to Rust** (#2493). |
| 2025-04-30 | `v1.217.0` | Initial **blockchain adapter** with live block subscription. `Chain`, `Block`, `Transaction` primitives. `RetryManager` exponential backoff + jitter. WebSocket batch order operations for Bybit. Mark price subscription for Binance Futures. |
| 2025-05-31 | `v1.218.0` | **HyperSync client** for blockchain. **DEXs, pools, tokens** support. Many indicator parity (Cython↔Rust) confirmations. **MessageBus topic matching 100× faster in Rust** (#2634). `BacktestDataIterator` for on-the-fly data loading. `activation_price` for trailing stops. Many error-handling improvements ("changing many unwraps to instead log or raise Python exceptions"). Cython 3.1.0 stable. |
| 2025-07-05 | `v1.219.0` | `graceful_shutdown_on_exception` config option. `purge_from_database` for cache backing management. **Property-based testing** (`Price`, `Quantity`, `Money`, `UnixNanos`, `OrderBook`, `TestTimer`, `network` crate). **Chaos testing with `turmoil`** for socket clients. **Consolidated on `aws-lc-rs`** cryptography for FIPS compliance. **Pure Rust cryptography crates** (no native certs / openssl). DEX swaps + pool liquidity updates. |
| 2025-07-14 | (`9e02e2f66a`) | First commits in `adapters/hyperliquid` (subsequent v1.220+). |

## Architecture moves

### Exponential-backoff reconnects, no `max_retries`

Earlier, each adapter had `max_ws_reconnection_tries` config (e.g.
v1.208 added it for Bybit, `BybitDataClientConfig`). v1.211 removed it
"no longer applicable with infinite retries and exponential backoff".

The realisation: there's no good answer for "how many times should we
retry?" 5? 50? 500? In real ops, infinite retries with bounded backoff
is what you want — eventually the network comes back. The retries
should be slow enough not to hammer the venue and quick enough not to
miss reconnection windows. v1.211 removed the user-facing knob;
v1.217–v1.218 finished the job by adding jitter and proper state-machine
handling so the *socket client itself* drives reconnection robustly.

**Why:** real production ops experience showed the bounded-retry
config was always misconfigured — too low (unrecoverable) or too high
(effectively infinite). Removing it simplified ops at the cost of one
config option.

### Reconciliation generating inferred orders / fills

"Live reconciliation will now generate inferred orders necessary to
align external position state" (v1.197 was the start). By chapter 13
the inference is robust: when a venue says "you have a position you
don't think you have" (because of a reconnection gap), the engine
*creates* an inferred order with venue IDs and the right quantity to
explain the position. This propagates through the cache, portfolio,
and event stream as if it were a real order.

**Why:** in production, reconnection gaps and venue-side state
changes happen all the time. Without inferred orders, the engine
would refuse to operate or would diverge from venue truth. This is
*the* feature that makes Nautilus survive multi-day live deployments.

### Property-based testing (v1.219)

`proptest` (Rust property-based testing) is added for value types,
`UnixNanos`, `OrderBook`, `TestTimer`, and the network crate. Bugs
that property tests find:

- Order book cache consistency in update / remove ops (release notes
  v1.219).
- Edge cases in time alerts (v1.213, v1.220).
- Numerical precision rounding edges in OBO/OUO contingency.

### Chaos testing with `turmoil`

`turmoil` is a Rust crate that simulates network conditions
(partitions, latency, packet loss) for testing async network code.
v1.219 introduces it for socket clients. This is the maintainer
investing in *infrastructure for verifying reliability* rather than
hand-holding individual bugs. By chapter 15, deterministic simulation
testing (DST) extends this to whole-system tests.

### Cryptography overhaul: `aws-lc-rs`, no native deps

v1.219: "Consolidated on pure Rust cryptography crates with no
dependencies on native certs or openssl. Consolidated on `aws-lc-rs`
cryptography for FIPS compliance."

`aws-lc-rs` is AWS's FIPS 140-3 validated cryptography library with
Rust bindings. By using only pure-Rust crypto and `aws-lc-rs`, the
build no longer depends on system OpenSSL — which simplifies
distribution (one less varying-version-system thing) and opens the
door for FIPS deployments (regulated trading houses).

**Why:** OpenSSL native deps had been a recurring source of
build / wheel-distribution / Docker-image complexity. Pure Rust
crypto removes the pain. FIPS readiness is a future-bet but doesn't
cost much given the dep choice.

### Blockchain adapter as a separate kind of adapter

The `blockchain` adapter is distinct from CEX adapters. It doesn't
talk to a single venue; it talks to a chain (Ethereum, Base, etc.)
through HyperSync (and later RPC providers). It models DEXs, pools,
and tokens as first-class entities. The `Chain`, `Block`,
`Transaction` primitives are part of the Nautilus domain model.

This is the chapter where Nautilus stops being "a multi-venue trading
platform" and becomes "a multi-venue **and multi-chain** platform."

**Why:** DEX trading was growing in importance for the user base.
Polymarket and dYdX were chain-aware but still acted like CEX
adapters. The blockchain adapter is the first one that *is* the chain,
not a venue on top of a chain.

### `graceful_shutdown_on_exception` (v1.219)

A `LiveExecEngineConfig` option (default `False`). When `False`, an
unexpected exception in the live engine results in an *immediate hard
crash*. When `True`, a graceful shutdown is attempted. The default
is "crash hard" — explicit alignment with the crash-only philosophy
in `docs/concepts/architecture.md`.

**Why:** "Improved live engine message processing to ensure
unexpected exceptions result in an immediate hard crash rather than
continuing without the queue processing messages."
The team had observed that graceful shutdown on unexpected error is
*itself* a source of bugs — better to fail fast and let the
supervisor (systemd, k8s, etc.) restart.

## Casualties

- **`max_ws_reconnection_tries` configs** (across adapters) — removed.
- **`basename_template` from `ParquetDataCatalog.write_data`** — removed.
- **OpenSSL native cryptography** — gone, replaced by `aws-lc-rs` +
  pure Rust.
- **DBN v1 schema support** for Databento — removed (migrate to v2/v3).
- **Some `unwrap()` calls in adapters** — replaced with logging or
  Python exceptions.
- **`Portfolio.set_specific_venue(...)`** — deprecated; use
  `Cache.set_specific_venue(...)`.

## Q&A

### Why is "graceful shutdown" the *non-default* behaviour?

Because in trading systems, undefined behaviour after an unexpected
exception can lose money or corrupt state. A hard crash is
recoverable through a clean restart (the crash-only design). A
half-graceful shutdown that processes some events but not others is
*not* recoverable. The default has to be fail-fast.

### Why now and not earlier on `aws-lc-rs`?

In 2025 `aws-lc-rs` had matured to the point where it's a drop-in
for `ring` (the previous Rust default). The maintainer waited until
the ecosystem was ready before flipping. This is consistent with
the pattern: don't take dep risk early; flip when the migration is
mechanical.

### Was the blockchain adapter built bottom-up or from a chain-specific
need?

Bottom-up. `Chain` and `Block` are abstract primitives; the first
concrete chain is implicit via HyperSync (which supports many EVM
chains). DEX adapters (Hyperliquid in chapter 14) build on top.
The maintainer's pattern is "extract the abstraction once you have
two concrete cases" — the chapter-14 chains validate the chapter-13
abstractions.

### Why introduce `BacktestDataIterator`?

Loading huge backtest datasets into memory at start was a
performance / memory issue. `BacktestDataIterator` lazy-loads
chunks as the backtest consumes them. This is what makes
year-scale backtests on tick data tractable.

### Are there bugs that property tests caught that traditional tests
missed?

Yes — release notes v1.219: "Fixed order book cache consistency in
update and remove operations (found through property-based testing)."
Property tests are particularly good at finding edge cases in
data-structure invariants — the kind of bugs that hand-written tests
miss because they don't think to test n=0 or n=very-large.

## Insights for daily work

- After v1.219, adapters reconnect indefinitely on disconnection.
  Don't try to set a max retry count — there isn't one. To stop the
  client, call `disconnect()` explicitly.
- `graceful_shutdown_on_exception=True` is for *strategy logic*
  errors only. Don't enable it for adapter or engine errors —
  hard crash is the right answer there.
- `aws-lc-rs` requires no system openssl, but it does require a Go
  toolchain to build *the FIPS module*. Non-FIPS mode (the default)
  doesn't require Go. Documented in v1.225 release notes.
- The blockchain adapter is configured very differently from CEX
  adapters. Read the integration guide for `blockchain` before
  trying to extrapolate from Bybit / Binance docs.
- Property tests are in `crates/*/proptest-regressions/`. When you
  add a new invariant, add a `proptest!` block — the project
  expects it.
