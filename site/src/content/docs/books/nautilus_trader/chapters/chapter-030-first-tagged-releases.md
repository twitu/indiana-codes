---
title: "Chapter 030: First Tagged Releases — CCXT, Backtest v1, the v1.90 Era (2020-11 → 2021-01)"
---
**Period:** 2020-11-04 → 2021-01-31 (~3 months)
**Tags in this window:** `v1.90.2` → `v1.99.0` (~30 patch + minor releases)
**Commits:** ~600
**Why this chapter exists:** This is the first window where versioning is
public and tagged. It is also the only window where the team is shipping
**every couple of days** (`v1.90.2` Nov 4 → `v1.90.10` Nov 11 in one week).
That cadence reveals what the open-source release exposed: real users hit
real bugs, fast. The Order Book also lands in this window (in Cython, before
Rust exists). It is the smallest chapter by calendar but high-traffic.

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2020-11-04 | `v1.90.2` | First public tag. Wheels actually shipping. |
| 2020-11-04 → 11 | `v1.90.4` … `v1.90.10` | **8 patch releases in 7 days.** Bug-fix bursts on the freshly-public code: bar aggregation, message queue robustness, package install issues. |
| 2020-11-13 | `v1.91.1` | First minor bump. Refactors landed, not just fixes. |
| 2020-11-15 | `8b297a9a30`, `78862cf319` | "Overhaul packaged data" — the `tests/test_kit/data` story consolidates. |
| 2020-11-22 | `deef977687` | Second wave of Redis-related changes (`Add Redis int64 precision warning`). |
| 2020-11-24 | `v1.92.0` | |
| 2020-12 | (multiple) | OrderBook prototype lands in **Cython**. `9f79cb8710 Add OrderBook`, then a long sequence of "OrderBook progress" / "Refactor OrderBook" commits. The order book API is born here. |
| 2020-12-08 | `v1.93.0` | |
| 2020-12-14 → 29 | `v1.94.0` → `v1.94.7` | Iterating on Order Book + early MessageBus thinking. |
| 2020-12-27 | `841bf12187` | "Build out live implementations" — first actual live trading code paths beyond stubs. |
| 2021-01-07 | `v1.95.2` | |
| 2021-01-12 | `v1.96.0` | |
| 2021-01-21 | `v1.97.4` | |
| 2021-01-25 | (multiple) | OrderBook L2 lands. |
| 2021-01-27 | `v1.98.1` | |
| 2021-01-31 | `v1.99.0` | End of chapter — the v1.106 "Identifier crisis" begins next. |

(Tag dates inferred from `git for-each-ref --format='%(creatordate:short)
%(refname:short)' refs/tags/`. Release notes for these versions don't exist
in `RELEASES.md` — that file starts at `v1.106.0`.)

## Architecture state

The **Order Book** lands in this chapter, in Cython. This is the most
complex new domain object since `Instrument`. It has L1, L2, and L3 modes
([(see `concepts/order_book.md` for the steady-state docs)](../docs/concepts/order_book.md)).
The first incarnation has many "Refactor OrderBook" commits — the API
shape is being found in real time, often by users hitting it.

The **DataEngine** and **ExecutionEngine** are still separate, with separate
caches. Unification is one chapter away (chapter 5).

## Key decisions

### Two-day release cadence on first contact

Eight patch releases in the first week post-public. This is the
fastest-cadence chapter in the entire history. The implication: the
maintainer was responding to user-reported breakage in real time.
The team did not build up a backlog and ship monthly — it shipped fixes
within hours. That habit shapes the codebase: there is no "experimental"
branch, every change goes through `master`, and the release-notes culture
(which formalises in chapter 4) has to keep up.

**Why:** the author had committed publicly, and the install-from-PyPI
path needed to actually work. There were probably also paying users (the
NautechSystems consultancy) using the build internally and pushing fixes.

### OrderBook as a hand-rolled Cython type

When the OrderBook lands in Dec 2020, it is a **hand-rolled Cython type**.
There were existing Python order-book libraries; the author rejected them.
Reading the iteration pattern ("Add OrderBook" → multiple "OrderBook
progress" → "Refactor OrderBook" multiple times → "Refactor OrderBook
API"), this was an exploratory implementation, not a copy of someone
else's design. By the time it stabilises (chapter 4), it has L1/L2/L3 modes
and book-snapshot vs delta semantics that are *the* shape the rest of the
project assumes.

**Why:** Cython gave field-level memory layout control that was needed for
hot-path performance. Existing Python libraries either pinned to a
specific exchange's deltas (Binance-style), or were too slow. The
maintainer wanted full control over snapshot-vs-delta semantics because
those differ across venues.

### Tag-and-CHANGELOG-less releases

There is no `RELEASES.md` content for v1.90 → v1.105. The version stream
is tagged but unannotated. The "release notes culture" emerges in chapter 4
(v1.106 onwards). For an excavator, this means: **the only history for this
window is `git log` and the GitHub release pages (where they exist).**

**Why:** the author was overwhelmed by the cadence. Writing release notes
for 25 patch releases in three months would have been a full-time job.
The notes catch up later.

### CCXT is the de-facto multi-venue path

In this chapter, the public message to users is "use CCXT for everything
except the few hand-written adapters." CCXT is the on-ramp for new users.
This stays roughly true until Binance Futures arrives in v1.139 (March 2022),
after which the hand-written path becomes preferred.

## Casualties

- **Pickle-based serialization** for many objects, replaced with explicit
  `to_dict()` / `from_dict()` (continuing into chapter 4).
- **The single-`asset_class` field on instruments** changes shape multiple
  times here.
- **Some early `multiprocessing.Pool` paths** are quietly removed in favour
  of the ZeroMQ workers.
- **Pre-public version numbers** (v1.0 through v1.89) — not represented in
  any tagged release on GitHub.

## Q&A

### Why isn't there a CHANGELOG.md or RELEASES.md for this period?

The release cadence was too fast for documentation to keep up, and the
release-note culture only formalises in Feb–Mar 2021 with `v1.106`.
For history before that point, you need git log and tag annotations.

### Why was OrderBook written in Cython instead of in a fast existing library?

In late 2020, the only competitive choice would have been a Rust binding,
and Rust was not yet part of the stack (it lands in chapter 7). Cython was
the "compile to C, callable from Python" option that fit the existing
codebase. The author bet that he could maintain a Cython OrderBook, and
later port it to Rust without API breakage. By chapter 7 (v1.175) that bet
pays off — the *Rust* OrderBook gets dropped in behind the existing
Cython surface.

### Why is the CCXT adapter shipping if it's going to be removed?

In 2020-2021 CCXT was the standard answer for "I want to talk to a crypto
exchange from Python." Users expected a CCXT integration. The maintainer
included it, learned from real user-reported issues that CCXT's abstractions
were a poor fit for low-latency trading (it normalises away too much
information), and over the next 18 months replaced CCXT-based venues with
hand-written ones. By chapter 8 the CCXT path is gone entirely.

## Insights for daily work

- If you find a Cython type that looks over-engineered (lots of `cdef`
  fields with subtle invariants, hand-rolled equality / hashing), it
  probably dates from this chapter or earlier. The reason it can't easily
  be Pythonised is the FFI surface — chapter 7 onwards depends on the
  exact memory layout from Rust.
- The OrderBook API — `BookType.L1_MBP / L2_MBP / L3_MBO`, snapshot-then-delta
  semantics, the `F_LAST` / `F_SNAPSHOT` flags — all originate here. When
  you see a flag check in a Rust adapter, it traces back to a Cython
  invariant from December 2020.
- The PyPI release version `1.90.2` is the *first publicly available* version,
  not the *first* version. Anyone asking "what's in v1.0?" is asking about
  closed-source code that does not exist publicly.
