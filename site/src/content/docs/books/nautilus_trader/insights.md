---
title: "NautilusTrader — Architecture Insights"
description: "The what-I-wish-someone-had-told-me companion to the project history."
---
> *The "what I wish someone had told me before I touched this code"
> document. Distilled from chapters 1–15. Opinionated. Useful for daily
> work.*

Read [Project History](./) first if you want the
narrative. This file is the lessons.

## The single most important fact about this codebase

**It is migrating.** The Cython that runs your strategies today is
scheduled for replacement by Rust. Most subsystems already are Rust
under the hood (OrderBook, network, MessageBus, DataEngine, RiskEngine,
ExecutionEngine, Portfolio, BacktestEngine, Catalog). The Python you
import is an increasingly thin shim. The maintainer's stated direction
(see [`ROADMAP.md`](https://github.com/nautechsystems/nautilus_trader/blob/develop/ROADMAP.md)) is "stable API at v2.0, after the
Rust port." Nothing in the codebase is "the final form" until v2.0
ships. **Plan accordingly when you write against the API.**

Practical implication: when you have a choice between a Cython type and
a `_pyo3` variant of the same thing, prefer the PyO3 one. It is the
future. (Example: `interactive_brokers_pyo3/` vs
`interactive_brokers/`.)

## Reading the codebase

### Versions are build counters, not stability signals

`v1.225` in 2026 is the *225th release after the public launch in 2020*,
not "almost v2.0." The `Beta` label in the README is sincere. Breaking
changes ship in normal releases. Pin to a version. Read the
release notes when you upgrade.

### The release notes (`RELEASES.md`) are the spine

6,000+ lines. Read the section for the version you're on. Each release
has Enhancements / Breaking Changes / Internal Improvements / Fixes /
Documentation / Deprecations sections. The Breaking Changes section is
the one that bites.

### The architecture concepts doc is the steady-state, not the history

[`docs/concepts/architecture.md`](https://github.com/nautechsystems/nautilus_trader/blob/develop/docs/concepts/architecture.md)
explains the system *as it is*. It does not explain why it is that way.
For the why, read the chapters in `chapters/`.

## Core abstractions and how they work

### `MessageBus` is the spine

Every event, command, and (post-v1.197) data point flows through the
`MessageBus`. Components publish to topics and subscribe to topics.
Topic strings follow conventions like `data.quotes.{venue}.{symbol}`
but the conventions are enforced by *code review*, not the type
system.

When debugging "why didn't my strategy receive X?", start by checking
the topic shape. After v1.218 (chapter 13) topic-matching is 100×
faster — wildcard subscribes are fine.

### `Cache` is the source of truth

After v1.122 (chapter 5) there is *one* `Cache`. Components
read from it; they don't pass state to each other. Position, order,
instrument, account, quotes, trades, bars, mark prices, exchange
rates — all live in the cache.

If two components hold the same fact in two places, you have a bug.
Always go through the cache.

### `Component` FSM is real

`PRE_INITIALIZED → READY → RUNNING → STOPPING → STOPPED → DISPOSED`
with `DEGRADED` and `FAULTED` side-states. State transitions are
checked in Rust now (chapter 10). Don't construct components and
manually flip them — call `register()`, `start()`, etc.

### `Actor` vs `Component` traits are different

(Introduced explicitly in v1.212, chapter 12.)

- `Actor` trait → registry-based message dispatch by ID.
- `Component` trait → lifecycle (start/stop/reset/dispose).
- A `Throttler` is `Actor`-only.
- A `DataEngine` is `Component`-only.
- A `Strategy` is **both**.

If you're tempted to give your new type both, ask whether it really
needs targeted message dispatch. If not, it's just a `Component`.

## Time

### `ts_event` vs `ts_init`

Every `Data` subclass carries both:

- `ts_event` — when the venue says it happened.
- `ts_init` — when Nautilus constructed the object.

Reconciliation, replay, and order routing all care about the
distinction. They are *not interchangeable*.

### Atomic global clock

Since v1.183 (chapter 8), the engine uses one global atomic clock for
all `ts_init` timestamps. Monotonicity is guaranteed by construction.
If you create a `Clock` instance directly in user code, you bypass
this — don't.

### Nanoseconds, not milliseconds

Every internal timestamp is `i64` nanoseconds (or `u64` `UnixNanos` in
Rust). Conversion to `pd.Timestamp` happens *only* at user-facing
boundaries.

## Numerical precision

### Two precision modes

- **High-precision (i128)** — default on Linux / macOS Python wheels.
  16 decimals. Larger value range.
- **Standard-precision (i64)** — default on Windows wheels (MSVC has
  no `__int128`) and Rust crates. 9 decimals.

If you write a numerical-correctness test, parametrise it on both.
Use `Price`, `Quantity`, `Money` types — never raw floats — for any
value that affects PnL. (See chapter 11.)

### `Decimal`, not `float`, on internals

Many engine paths (account / cost / exchange-rate calculations) use
`decimal.Decimal` internally even though the values are stored as
fixed-point integers. The reason is rounding control. Don't push
floats through these paths.

## Adapters

### Adapter shape (post-chapter 8)

Every adapter has at minimum:

- `*HttpClient` (Rust, `hyper` based).
- `*WebSocketClient` (Rust, `tokio-tungstenite`).
- `*DataClient` and `*ExecutionClient` (PyO3-bound).
- `*InstrumentProvider`.
- `*Config` classes (`bon::Builder` since v1.225).

If you write a new adapter, *closely* follow an existing Rust adapter
(e.g. `bybit/` or `okx/`). The "split-client" pattern, "AuthTracker",
and "data event emission" guidelines are documented in
`docs/developer_guide/`.

### Reconnection is infinite with exponential backoff

Don't try to limit retries. v1.211–v1.218 removed every
`max_ws_reconnection_tries` config. To stop a client, call
`disconnect()`. (Chapter 13.)

### `RetryManagerPool` for HTTP retries

Don't hand-roll exponential backoff in your adapter's HTTP path. Use
the shared `RetryManagerPool`. Adds jitter, error-categorisation,
and consistent logging across adapters. (Chapter 9.)

### `F_LAST` and `F_SNAPSHOT` flags on order-book deltas

If your adapter sends batched deltas, set `F_LAST` only on the last
delta in the batch; on the rest, leave it clear. The data engine
buffers until `F_LAST`. (Chapter 9.) Polymarket / Bybit / dYdX bugs in
old releases were almost all flag-related.

### Adapters die

Don't read inclusion as a permanent commitment. FTX, Coinbase Intl,
dYdX v3, and CCXT have all been removed. Build your own internal
forks if you need something the project drops.

## Reconciliation (live trading)

### Inferred orders / fills

When the venue reports state the engine doesn't have (because of a
reconnection gap), the engine *creates* synthetic orders / fills
with venue IDs and `Inferred=True` to align state. This was
hardened from v1.197 through v1.220 (chapters 9–14). Don't filter
inferred events out of your audit log — they explain why your
state matches the venue.

### `OrderStatusReport` is what the venue thinks; `Order` is what
you think

Reconciliation reconciles the two. Both can be wrong (your view is
stale, the venue's report can be inconsistent across endpoints).
The engine's job is to converge them.

### Hard-crash on unexpected exception, not graceful

The default `graceful_shutdown_on_exception` is `False`. Live engines
crash on unexpected errors so the supervisor can restart them. Don't
flip this on without thinking — graceful handling of an unhandled
exception is its own bug class. (Chapter 13.)

## Persistence

### Catalog (Parquet) and Cache (Redis)

- The **catalog** is on-disk: backtest data, reproducible streams,
  archives. `ParquetDataCatalog` is the type to use (v1.225 dropped
  the V2 suffix).
- The **cache** is in-memory + optional Redis backing. Live state.
  After v1.182 (chapter 8), Redis access goes through Rust on a
  dedicated tokio task — calls return *before* the Redis write
  succeeds. Don't assume durability without flush.

### Catalog v2 schemas (chapter 7) and high-precision schema break (chapter 11)

If you have old catalog data, you may need to migrate. The migration
guides are in the docs. Don't try to read v1 / pre-high-precision
data with current readers — you'll see corruption rather than a
clean error.

### Streaming Feather Writer is the live → catalog path

Strategies / actors that want to record live data should use
`StreamingFeatherWriter` (or its v2-renamed-to-V0 form, chapter 15).
Don't roll your own.

## Configuration

### `bon::Builder` is the canonical pattern (chapter 15)

```rust
let config = MyConfig::builder()
    .important_field(value)
    .build();
```

Hand-rolled `::new` constructors are removed. `Default::default()`
delegates to `builder().build()`. Fields with sensible defaults are
plain `T` with `#[builder(default)]`, not `Option<T>`.

### `msgspec` for Python configs

Python config classes are `msgspec.Struct`. Don't use `dataclass` or
`pydantic` (the latter was removed in v1.161, chapter 6).

### Config classes serialize over the wire

Configs are sent over the message bus (e.g. for live engine
distribution). They must be msgpack/msgspec-serializable. If you add a
field that isn't, encoding fails at runtime.

## Testing

### Property-based tests are expected (chapter 13)

Value types, `OrderBook`, `Throttler`, `UnixNanos`, network primitives
all have property tests. If you add a new invariant, add a `proptest!`
block.

### Chaos / DST testing exists

Chapter 13 added `turmoil` for socket-client chaos tests. Chapter 15
adds deterministic simulation testing behind a `simulation` feature.
For high-stakes Rust changes (engine-level logic), expect to run DST
or write a chaos-test scenario.

### Testing is split

- Rust unit tests: `cargo nextest run` from the workspace root.
- Python tests: `uv run pytest` (or `pytest -n auto` for parallel).
- Integration tests under `tests/` use real (sandboxed) venue clients
  for some adapters. They require credentials in env vars.

## Logging

### One log sink, configured from `LoggingConfig`

After v1.183 (chapter 8) the Rust `log` crate is the core logger.
Python's `LoggerAdapter` writes through it. Don't use Python stdlib
`logging` for hot-path events.

### Log file rotation (chapter 13)

`max_file_size` + `max_backup_count` config options on the logger.

### `tracing-subscriber` integration (chapter 14)

`use_tracing=True` in `LoggingConfig` enables `tracing` for external
Rust libraries. Filter via `RUST_LOG` env var — not via in-config
log-level options.

## Cryptography & secrets

### `aws-lc-rs`, no native OpenSSL

Pure-Rust crypto + `aws-lc-rs` (FIPS-validated). The build does not
need system OpenSSL. (Chapter 13.)

### Credentials are zeroized on drop

Every adapter's `Credential` is `Box<str>` (heap-allocated) with
zeroize-on-drop. `Debug` impls redact secrets. (Chapter 14.) Don't
store credentials in `Ustr` (interned, lives forever) or
ordinary `String` (no automatic zeroization).

## Performance gotchas

### MessageBus topic interning

Topics are `Ustr`-interned. Don't construct topics in tight loops with
string formatting — pre-build them or rely on the engine's caching.

### MPSC backpressure

The Rust runtime uses MPSC channels between Python adapters and
engine internals. Slow consumers see backpressure as `try_send`
failures. They surface in logs but not as Python exceptions —
monitor your logs.

### Broadcast channels lose data on slow subscribers

Tick-rate paths use `tokio::sync::broadcast`. Slow subscribers miss
messages by design. The engine tells you — don't ignore the
"falling behind" warnings.

## Common bugs in adapter PRs

These show up across release notes' Fixes sections:

1. **Missing `F_LAST` flag on terminal delta of a batch** — book
   batching breaks; subscribers see partial book.
2. **WebSocket subscribe ACKs that confirm all pending topics**
   instead of the acknowledged one.
3. **Empty-string deserializer panics** (Bybit position side, dYdX
   account state, Binance account state) — the venue sends `""`,
   the parser expects an enum.
4. **Random UUIDs as `TradeId` fallbacks** — must be deterministic
   hashes of the trade fields, otherwise reconciliation diverges
   across restarts.
5. **`block_on` inside an async context** — adapter `query_account`
   panics; use `spawn_task`.
6. **Refcount leaks on subscription failure** — when subscribe
   fails, the subscription state must roll back.
7. **OrderBook L1 stale event mutation** — corrupts bid/ask;
   property tests catch this.
8. **`due_post_only` not set on post-only rejection** — strategies
   can't distinguish post-only from real rejection.

## When you're stuck

1. Read the relevant chapter in `chapters/`.
2. Check `RELEASES.md` for the version that introduced the API
   you're using.
3. Search the `docs/concepts/` directory — there's usually a guide.
4. Search GitHub issues / PRs for the symptom — there's usually a
   prior fix.
5. Property tests and chaos tests exist; consider whether you can
   reproduce in one of those harnesses.
6. The maintainer culture is "fail fast, post a stack trace, don't
   guess." If your PR adds a `unwrap()` or silently swallows an
   error, expect review pushback.
