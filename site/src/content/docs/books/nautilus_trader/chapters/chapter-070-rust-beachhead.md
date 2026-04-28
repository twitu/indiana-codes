---
title: "Chapter 070: The Rust Beachhead — First Native Modules (2022-04 → 2023-06)"
---
**Period:** 2022-04-24 → 2023-06-16 (~14 months)
**Tags:** `v1.142.0` → `v1.175.0`
**Why this chapter exists:** April 24, 2022 (`398116c913 Rust core`) is the
first commit that puts `*.rs` files into the workspace. By June 2023 (v1.175)
the **`OrderBook`, `HttpClient`, and `WebSocketClient` are Rust-backed and
integrated into the platform**. This is the longest-arc chapter in the project
history — the code is ported through *both* the FFI layer (Cython binding to
Rust via C-ABI) *and* the user-facing Python API (which doesn't change). It
is also the chapter where a long FTX→nothing transition happens, and where
the Betfair adapter goes through its second rewrite.

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2022-04-24 | (no tag) | **First Rust commit** in the workspace. `398116c913` "Rust core". The Cargo workspace is established under `nautilus_core/`. |
| 2022-05-14 | (no tag) | "Update Rust dependencies and remove pyo3" — the *first* attempt to use PyO3 is reverted. Cython-via-C-ABI binding chosen instead, for now. |
| 2022-05-16 | `v1.145.0` | |
| 2022-07-20 | (no tag) | "Use workaround for cargo test with PyO3" — PyO3 returns, but only for testing. |
| 2022-07-28 | `v1.149.0` | |
| 2022-08-15 | `v1.150.0` | |
| 2022-09-14 | `v1.154.0` | |
| 2022-10 | (multiple) | Rust uuid, datetime, value-type implementations. |
| 2022-11-18 | `v1.159.0` | **FTX integration removed.** "Implemented `TRAILING_STOP_MARKET` orders for Binance Futures (beta)." |
| 2022-11-28 | `v1.160.0` | |
| 2022-12-23 | `v1.164.0` | |
| 2023-01-14 | `v1.165.0` | |
| 2023-01-21 | (`b988285d45`) | "**pyo3 implementation for parquet reader (#938)**" — first user-facing PyO3 binding. |
| 2023-02-25 | (`5509f86c1e`) | "Expose enums with pyo3" — enums become the second wave. |
| 2023-03-12 | `v1.170.0` | "Rust port" first explicitly named in commits (`2023-03-11`). |
| 2023-05-19 | `v1.174.0` | Catalog v2 (Parquet schemas) starts. |
| 2023-06-16 | **`v1.175.0`** | **Major: integrated core Rust `OrderBook`, `OrderBookDelta`. Core Rust `HttpClient` (hyper), `WebSocketClient` (tokio-tungstenite), `SocketClient` (tokio TcpStream).** Public API for `data` and `events` denested. `pandas` upgraded to v2. Betfair adapter temporarily broken pending the new Rust order book integration. |

## Architecture change

### Before

```
Python  →  Cython types (e.g. OrderBook in Cython)  →  C extension binary
                                  ↑
                          Hand-written hot paths
```

The hot path was Cython all the way down. There was no Rust.

### After (v1.175)

```
Python                            ┌─ data, events: public Python API
   │                              │
   ▼                              │
Cython glue layer ───────► Rust core (`crates/`)
                                  │
                         ┌────────┼────────┐
                         │        │        │
                  OrderBook   HttpClient  WebSocketClient
                  (full)      (hyper)     (tokio-tungstenite)
```

The **OrderBook is fully Rust**. Cython still owns the public API, but
delegates internally. Network clients are Rust because async-Tokio is
where the perf and reliability story lives.

## Key decisions

### Pivot from "rewrite in Cython" to "rewrite in Rust"

By April 2022, the limits of the Cython-everywhere approach were clear:
no real concurrency story (GIL bound), no async story (Cython doesn't
play well with `asyncio` for high-volume websocket traffic),
maintenance overhead of writing C-ABI by hand. Rust offered:

- A real async runtime (Tokio).
- Memory safety where the Cython code was leaking (segfaults from manual
  refcounting were a recurring bug class — see v1.158 release notes:
  "Fixed memory management for Rust backing structs (now being properly
  freed)").
- A shared state model (`Arc<Mutex<...>>`, atomics) that doesn't need
  the GIL.

**Why:** the maintainer realised Cython had run out of road for the
parts of the system that needed real concurrency.

### Cython-via-C-ABI before PyO3

The *first* binding strategy (April–July 2022) was to build Rust libraries
exposing a C-ABI, and have Cython bind to them via `cdef extern from`. PyO3
was rejected initially. **Why:** PyO3 in 2022 still had ergonomics issues
for Cython interop, and the existing Cython surface couldn't be flipped to
PyO3 in one shot. The C-ABI route let Rust replace the *internals* of a
Cython type without changing the Cython class signature.

This decision is later partially reversed (chapter 8) when PyO3 becomes the
strategic binding layer. It lives long enough to migrate the highest-traffic
modules first; chapter 8+ is "PyO3 takes over."

### `tokio-tungstenite` for WebSockets, `hyper` for HTTP

The choices are mainstream Rust: `tokio` for the runtime, `hyper` for
HTTP, `tokio-tungstenite` for WebSockets. There is some flirtation with
`fastwebsockets` (commit `e489f7f233 Replace tokio-tungstenite crate
with fastwebsockets (#1129)`) — but later removed. The mainstream stack
wins.

**Why:** `hyper` and `tokio-tungstenite` are the most-vetted libraries
in the Rust async ecosystem. Choosing alternatives would mean catching
up on bugfixes the upstream community gets for free.

### OrderBook is the first-port test case

The order book is the *highest-frequency mutated state* in the system.
If Rust + FFI works for the order book, it'll work for almost anything
else. By porting it first (and integrating it in v1.175), the team
proves the FFI strategy works under load. Every later port — `RiskEngine`,
`ExecutionEngine`, `Portfolio` (chapter 10) — borrows the OrderBook's
glue patterns.

### `denest namespaces`: `nautilus_trader.model.data` and `.events`

A small change with a big readability payoff. Pre-v1.175, you had to
import `OrderBookDelta` from `nautilus_trader.model.orderbook.data` and
`OrderFilled` from `nautilus_trader.model.events.order`. v1.175 flattens
both into `nautilus_trader.model.data` and `nautilus_trader.model.events`.
Every downstream code example after this is shorter.

### Catalog v2 schemas

Parquet schemas shift in v1.174 toward "catalog v2." This is the
maintainer's polite way of saying "the v1 catalog format is going to
be unreadable." Users with v1 data have to re-ingest. The schemas
become more fixed-width and better aligned with Arrow conventions —
the precondition for chapter 11's high-precision Arrow break.

## Casualties

- **FTX adapter** — removed v1.159 (post-FTX collapse).
- **PyO3 first attempt** — reverted in May 2022.
- **`fastwebsockets` experiment** — added then removed.
- **`OrderBookSnapshot`** — removed in v1.175 (redundant: a snapshot is
  a CLEAR delta + a series of ADDs).
- **`OrderBookData`** — also removed in v1.175 (redundant umbrella type).
- **A lot of Cython memory management code** — replaced by Rust drop
  semantics.
- **TA-Lib** — added in v1.182 (chapter 8) but eventually deprecated
  (v1.211 area).

## Q&A

### Why not rewrite the whole codebase in Rust at once?

The Python user-facing API has thousands of lines of code in user
strategies, tutorials, and docs. Breaking it would alienate the user
base. The strategy is "rewrite the engine in Rust *underneath* a
stable Python API." It takes 4+ years (chapter 7 → chapter 15) and
isn't done in 2026.

### Was the OrderBook port worth the multi-year FFI complexity?

Yes — it removed a category of segfaults (the v1.158 fix), enabled
Tokio-based reconnection logic for adapters, and let MBO data be
processed at line rate. The cost was that for ~18 months the OrderBook
had two implementations (Cython + Rust) and integration was uneven.
Betfair's broken-on-v1.175 release (release notes call this out
explicitly) is the smell.

### Why did the team go through C-ABI first instead of straight to PyO3?

Reading the timing: PyO3 in early 2022 had documentation gaps and
release-cadence concerns. The existing Cython types had hand-written
C-ABI surfaces; binding Rust via C-ABI let those surfaces stay the
same. Once PyO3 stabilised (v0.18 region, end of 2022), it became
the strategic choice and the C-ABI tier started to be peeled back.

### Why was Betfair allowed to ship broken on v1.175?

The release notes are explicit: "The Betfair adapter is broken for this
release pending integration with the new Rust order book. We recommend
you do not upgrade to this version if you're using the Betfair adapter."
The team prioritised the architectural milestone (Rust OrderBook) over
adapter completeness for one release. Betfair was fixed shortly after.
This is one of the few cases of "shipping a known-broken feature" in
the project's history — usually the policy is fail-fast, but here the
maintainer made a judgment call.

## Insights for daily work

- The dual-implementation reality (Cython OrderBook + Rust OrderBook)
  lasts past v1.175 in places — not all code paths flipped at once.
  When you find a Cython OrderBook reference in 2024-era code, it's
  legacy waiting for deletion.
- The `crates/` layout is one Cargo workspace with one crate per
  subsystem (`nautilus_core`, `nautilus_model`, `nautilus_network`,
  …). The directory shape mirrors `nautilus_trader/`'s Python
  subpackages. Don't invent a new layout.
- C-ABI bindings are *still* in the codebase in places (early-ported
  modules). They're identifiable by `cdef extern from "..."` blocks
  in Cython files. They are slowly being replaced by PyO3 (chapter 8+).
- `unsafe` blocks in Rust are rare; when they exist, they're at the
  C-ABI boundary. The Soundness Pledge in the README is real — see
  chapter 13 for the reinforcement.
