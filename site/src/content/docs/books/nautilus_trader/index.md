---
title: "NautilusTrader — Project History"
description: "How NautilusTrader grew from a closed-source Cython FX prototype into a production Rust-native, multi-asset trading engine."
---
> A chapter-based excavation of how NautilusTrader grew from a closed-source
> Cython FX prototype into a production Rust-native, multi-asset, multi-venue
> trading engine — written for someone reading the code in 2026 who needs to
> understand why the shape is what it is.
>
> Generated with the [excavate](https://github.com/twitu/indiana-codes) skill on 2026-04-27,
> against the repo at the tip of `develop` (`6480cfd9f7`, post-`v1.225.0`).

## Repo at a glance

| | |
|---|---|
| First commit | `1b83d67682` — *Initial commit*, **2018-06-25** by Chris Sellers |
| Latest commit (tip) | `6480cfd9f7` — *Tighten DST common-leg wall-clock smoke gate*, **2026-04-27**, post-`v1.225.0` |
| Total non-merge commits | **18,468** in nearly 8 years |
| Tagged releases | `v1.90.2` (Nov 2020) → `v1.225.0` (Apr 2026), 206 tags |
| Issue tracker | GitHub issues + the `RFC` issue convention (e.g. #2084 high-precision mode, #2206 TA-Lib deprecation, #3555 Coinbase Intl removal). [Project board](https://github.com/orgs/nautechsystems/projects/3). |

**Top contributors (commits):** Chris Sellers + cjdsellers + Christopher Sellers ≈ **16,097** combined; Filip Macek 307; faysou 275; Bradley McElroy 259; David Blom 134; Ishan Bhanuka 118; Vadim Nicolai 96; sunlei 76; rsmb7z 66; Pushkar Mishra 58. Long tail of ~50 contributors.

**Activity curve:**

- \<100 commits/month through 2018–2019.
- **3-month near-zero "open-source prep" gap Apr–Jun 2020.**
- Ramps through 2021 (~150–300/mo).
- Steady ~250/mo through 2023.
- **300–400/mo in 2024–2025.**
- **~370/mo in early 2026** (single peak month: 2025-05 at 421).

**Authoritative design docs:** [`docs/concepts/`](https://github.com/nautechsystems/nautilus_trader/tree/develop/docs/concepts) — `architecture.md`, `message_bus.md`, `cache.md`, `data.md`, `execution.md`, `portfolio.md`, `live.md`, `backtesting.md`, `dst.md`, `options.md`, `greeks.md`, `rust.md`, …; plus the canonical [`RELEASES.md`](https://github.com/nautechsystems/nautilus_trader/blob/develop/RELEASES.md) (6,001 lines back to `v1.106.0`) and [`ROADMAP.md`](https://github.com/nautechsystems/nautilus_trader/blob/develop/ROADMAP.md).

The author distribution is a one-author-plus-collaborators shape. Chris Sellers
(`cjdsellers`) is effectively the architect; almost every chapter's structural
move is his. Outside contributors do adapter work, indicator ports, and
specialised features.

## How to read this book

Each chapter is a self-contained markdown file under [`chapters/`](chapters/).
Read them in order, or jump to the era you care about. Chapters share a common
shape:

- **Why** — one sentence motivation for the chapter.
- **Timeline** — anchor commits / PRs / tags with dates.
- **Architecture before & after** — what shape was the system in at the start
  of the chapter, what shape was it in at the end.
- **Key decisions** — the trade-offs that defined the chapter, with the
  release notes / commit citations that committed the team to them.
- **Casualties** — what was *removed* in that chapter (often more
  illuminating than what survived).
- **Q&A** — *seed* questions worth challenging (the interactive part of an
  excavation).
- **Insights for daily work** — chapter-level takeaways.

For deeply-distilled "what I wish someone had told me" notes, see
[Architecture Insights](./insights/).

## Activity by month — the inflection points

| Window | Notes |
|---|---|
| 2018-06 → 2018-12 | Genesis. Pure Python → Cythonized in Dec 2018. |
| 2020-04 → 2020-06 | **3-month dead zone** before the open-source release. Cleanup, license headers, FXCM stripping. |
| 2020-07 → 2020-10 | Public release; first PyPI wheel on 2020-07-21. |
| 2020-11 | First tagged release (`v1.90.2`); semantic versioning starts at 1.90 (continuing the closed-source counter). |
| 2021-01 → 2021-02 | OrderBook in Cython, then `v1.106` IB scaffold + identifier overhaul. |
| 2021-07 | MessageBus introduced (`v1.125`). |
| 2022-04 | First Rust files committed (`crates/`); the long Rust port begins. |
| 2023-06 | Rust `OrderBook` + `HttpClient` + `WebSocketClient` integrated (`v1.175`). |
| 2023-12 | Rust `RedisCacheDatabase`; Bybit adapter (`v1.182`). |
| 2024-08 | `MessageBus` v2 + `DataEngine` v2 in Rust (`v1.197`). |
| 2025-02 | High-precision (128-bit) value types (`v1.211`). |
| 2025-03 | Poetry → uv migration; OwnOrderBook for self-trade prevention. |
| 2025-04 | Blockchain adapter, FIPS-grade crypto, exponential-backoff reconnects. |
| 2025-07 | Hyperliquid adapter; tracing subscriber. |
| 2026-01 → 2026-04 | Architect AX, Coinbase, Kraken, multi-account, deterministic simulation testing, bon builder migration. |

## Chapter map

| # | Period | Releases | Title |
|---|---|---|---|
| **010** | 2018-06 → 2020-06 | (closed-source) | [Genesis: A Closed-Source Cython FX Prototype](chapters/chapter-010-genesis-cython-fx-prototype.md) |
| **020** | 2020-07 → 2020-10 | (pre-tag) | [Going Public: The Open-Source Cutover](chapters/chapter-020-going-public-open-source.md) |
| **030** | 2020-11 → 2021-01 | `v1.90.2` → `v1.99.0` | [First Tagged Releases — CCXT, Backtest v1, the v1.90 Era](chapters/chapter-030-first-tagged-releases.md) |
| **040** | 2021-02 → 2021-04 | `v1.100.x` → `v1.117.0` | [Identity Crisis — Symbol → Security → InstrumentId](chapters/chapter-040-identity-crisis-instrumentid.md) |
| **050** | 2021-05 → 2021-09 | `v1.118.0` → `v1.130.0` | [Foundation Refactor — MessageBus, Unified Cache, Parquet](chapters/chapter-050-messagebus-cache-parquet.md) |
| **060** | 2021-10 → 2022-04 | `v1.131.0` → `v1.141.0` | [Adapter Pluralism, NautilusKernel, and msgspec](chapters/chapter-060-adapter-pluralism-msgspec.md) |
| **070** | 2022-04 → 2023-06 | `v1.142.0` → `v1.175.0` | [The Rust Beachhead — First Native Modules](chapters/chapter-070-rust-beachhead.md) |
| **080** | 2023-06 → 2024-01 | `v1.176.0` → `v1.184.0` | [The PyO3 Migration and Rust Catalog](chapters/chapter-080-pyo3-migration.md) |
| **090** | 2023-10 → 2024-09 | `v1.181.0` → `v1.200.0` | [Adapter Boom — Databento, Bybit, dYdX, Polymarket, OKX](chapters/chapter-090-adapter-boom.md) |
| **100** | 2024-08 → 2024-12 | `v1.197.0` → `v1.209.0` | [The Engine Port — RiskEngine, ExecutionEngine, Portfolio](chapters/chapter-100-engine-port-rust.md) |
| **110** | 2025-01 → 2025-02 | `v1.210.0` → `v1.211.0` | [High-Precision Mode — 128-bit Value Types](chapters/chapter-110-high-precision-mode.md) |
| **120** | 2025-03 | `v1.212.0` → `v1.213.0` | [Modernizing the Build — uv, Mark Prices, OwnOrderBook](chapters/chapter-120-uv-markprice-ownbook.md) |
| **130** | 2025-04 → 2025-07 | `v1.214.0` → `v1.219.0` | [Hardening — Reconnects, Reconciliation, Blockchain, Hyperliquid](chapters/chapter-130-hardening-blockchain-hyperliquid.md) |
| **140** | 2025-08 → 2026-03 | `v1.220.0` → `v1.224.0` | [Crash-Only, Cryptography, Multi-Account — BitMEX, Kraken, AX](chapters/chapter-140-crash-only-multi-account.md) |
| **150** | 2026-03 → 2026-04 | `v1.225.0` → `v1.226.0 Beta` | [Toward 2.0 — bon Builders, v2 LiveNode, DST, Options & Greeks](chapters/chapter-150-toward-2-0-bon-dst.md) |

## Where to start

If you are new to the codebase, **read chapters 010, 040, 050, 070, 100, and 140
first** — those carry the structural moves the rest of the chapters refine.
Skim the others.

If you are about to touch a specific subsystem, jump to the chapter that
introduced it:

| Subsystem | Chapter |
|---|---|
| `MessageBus`, pub/sub | [050](chapters/chapter-050-messagebus-cache-parquet.md) (intro), [100](chapters/chapter-100-engine-port-rust.md) (v2 in Rust), [120](chapters/chapter-120-uv-markprice-ownbook.md) (actor framework v3) |
| `Cache` | [050](chapters/chapter-050-messagebus-cache-parquet.md) (unification), [080](chapters/chapter-080-pyo3-migration.md) (Rust Redis), [100](chapters/chapter-100-engine-port-rust.md) (Rust port) |
| Order book | [030](chapters/chapter-030-first-tagged-releases.md) (Cython prototype), [070](chapters/chapter-070-rust-beachhead.md) (Rust integration), [110](chapters/chapter-110-high-precision-mode.md) (high-precision) |
| `OrderEmulator` | [060](chapters/chapter-060-adapter-pluralism-msgspec.md) (introduced) |
| `RiskEngine` | [040](chapters/chapter-040-identity-crisis-instrumentid.md) (scaffolded), [050](chapters/chapter-050-messagebus-cache-parquet.md) (iteration 2), [100](chapters/chapter-100-engine-port-rust.md) (Rust port) |
| `ExecutionEngine` | [050](chapters/chapter-050-messagebus-cache-parquet.md), [100](chapters/chapter-100-engine-port-rust.md) (Rust port), [140](chapters/chapter-140-crash-only-multi-account.md) (multi-account) |
| `Portfolio` | [100](chapters/chapter-100-engine-port-rust.md) (Rust port), [120](chapters/chapter-120-uv-markprice-ownbook.md) (mark prices, PortfolioConfig) |
| `BacktestNode` / `BacktestEngine` | [060](chapters/chapter-060-adapter-pluralism-msgspec.md) (NautilusKernel unification), [120](chapters/chapter-120-uv-markprice-ownbook.md) (Rust port) |
| `OrderMatchingEngine` | [060](chapters/chapter-060-adapter-pluralism-msgspec.md) (introduced), [110–120](chapters/chapter-110-high-precision-mode.md) (incremental Rust port) |
| Adapters — IB | [040](chapters/chapter-040-identity-crisis-instrumentid.md) (scaffolded), [060](chapters/chapter-060-adapter-pluralism-msgspec.md) (v1 beta), [080](chapters/chapter-080-pyo3-migration.md) (v2), [140](chapters/chapter-140-crash-only-multi-account.md) (Rust adapter w/ PyO3 layer) |
| Adapters — Binance | [060](chapters/chapter-060-adapter-pluralism-msgspec.md), [090](chapters/chapter-090-adapter-boom.md) |
| Adapters — Betfair | [040](chapters/chapter-040-identity-crisis-instrumentid.md) (introduced), [050](chapters/chapter-050-messagebus-cache-parquet.md) (rewrite for performance), [080](chapters/chapter-080-pyo3-migration.md) (Rust), [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md) (race-data) |
| Adapters — crypto (Bybit/dYdX/Polymarket/OKX/Hyperliquid/Kraken/BitMEX) | [090](chapters/chapter-090-adapter-boom.md), [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md), [140](chapters/chapter-140-crash-only-multi-account.md) |
| Adapters — Tardis, Databento | [090](chapters/chapter-090-adapter-boom.md), [140](chapters/chapter-140-crash-only-multi-account.md) |
| Adapters — Blockchain (DEX) | [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md), [140](chapters/chapter-140-crash-only-multi-account.md) |
| Adapters — Architect AX, Coinbase | [140](chapters/chapter-140-crash-only-multi-account.md), [150](chapters/chapter-150-toward-2-0-bon-dst.md) |
| Logging | [080](chapters/chapter-080-pyo3-migration.md) (Rust `log` crate), [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md) (rotation), [150](chapters/chapter-150-toward-2-0-bon-dst.md) (tracing subscriber) |
| Crypto / TLS | [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md) (`aws-lc-rs`, FIPS), [140](chapters/chapter-140-crash-only-multi-account.md) (credential zeroization) |
| Persistence — catalog | [050](chapters/chapter-050-messagebus-cache-parquet.md) (Parquet intro), [080](chapters/chapter-080-pyo3-migration.md) (catalog v2), [130](chapters/chapter-130-hardening-blockchain-hyperliquid.md) (consolidation), [140](chapters/chapter-140-crash-only-multi-account.md) (catalog refactor) |
| `bon` config builders | [150](chapters/chapter-150-toward-2-0-bon-dst.md) (codebase-wide migration) |

## Legend

- **Casualties** in each chapter — modules / configs / experiments that were
  *removed* in that window. The shape of the current code is often easier to
  understand by what was tried and abandoned than by what survived.
- **Why** in each chapter — the apparent motivation, inferred from commit
  messages, release notes, and PR / issue context. Where motivation is
  genuinely opaque, the chapter says so rather than guessing.
