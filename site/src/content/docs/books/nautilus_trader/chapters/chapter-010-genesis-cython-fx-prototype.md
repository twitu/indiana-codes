---
title: "Chapter 010: Genesis — A Closed-Source Cython FX Prototype (2018-06 → 2020-06)"
---
**Period:** 2018-06-25 → 2020-06-25 (24 months)
**Commits:** ~2,800 (no tags yet — pre-versioned)
**Author:** Effectively single-author (Chris Sellers / `cjdsellers`).
**No release notes** in `RELEASES.md` for this period (notes start at v1.106).
**Why this chapter exists:** The choices made here — Cython for performance, an
event-driven kernel, ZeroMQ-based RPC, FX-first design — define the baseline
that every subsequent chapter rewrites or recontextualises. To read the modern
Rust code without this chapter you keep tripping over inherited shape (the
`Strategy` callback names, the `Cache` god-object, the FSM-based `Component`
state model, the `ts_event` / `ts_init` distinction) and wondering "why this
way?" The answer is "this is what it was when there were no other constraints."

## Timeline of structural moves

| Date | Commit | What happened |
|------|--------|---------------|
| 2018-06-25 | `1b83d67682` | **Initial commit.** Project starts as private repo. |
| 2018-06-26 | `c1f6105321` → `8297eb23eb` | Add **Protobuf** RPC messages — first wire format attempt. |
| 2018-07-02 | `fc24d4d1fe` | "Remove protobuf. Add objects." — Protobuf abandoned for hand-written domain objects. **Casualty 1.** |
| 2018-07-02 | `775b3cfd9a` | First **`live data client`** — establishes the data-client / exec-client split that survives to today. |
| 2018-07-13 | (multiple) | First **Redis** integration commits — durable state from the very beginning. |
| 2018-07-13 | (zmq series) | **ZeroMQ** workers added; this becomes the inter-process transport for the prototype. |
| 2018-08-10 | `bfb7051fcb` | "Add FXCM symbol factory" — FX-first focus. **`AssetClass.FX`** assumed primary. |
| 2018-09 | (multiple) | "Add forex instrument" series — instrument model is forex-shaped. |
| 2018-12-07 | `22f96307b9`, `df43346c45` | **Initial cythonization.** Hot-path types start growing `cdef` declarations. |
| 2018-12-22 | `91056d0244` | "Improve cython compiler directives" — compiler flags tuned. |
| 2018-12-28 | `747acdba17` | "Replace `@property` with `readonly cdef`" — performance pressure forcing C-level field access. |
| 2019-01-05 | `ef9652cb1a` | **Logger cythonized.** |
| 2019-01-26 | `e322659788` | **Messaging cythonized** — the message bus precursor goes from Python to Cython. |
| 2019-08 | (244 commits) | Largest single-month spike before the open-source era. Rapid iteration. |
| 2019-11–2019-12 | (1, 28 commits) | Near-stop. The first "gap chapter" — most likely a quiet planning / pause period. |
| 2020-04 → 2020-06 | (3-month dead zone) | **Almost no commits.** This is the open-sourcing prep window — code review, license addition, `LICENSE` and headers updated, package renames, "FXCM" stripped (`035ad9e073` "Remove references to FXCM", `9219aecffb` "Remove fxcm naming"). **Casualty 2: closed-source-only references.** |
| 2020-06-08 | `348ef334fa`, `5ea1c553e9` | "Reorganize project structure", "Clarify package name" — packaging shifts to public-friendly names. |
| 2020-06-10 | `1b1aa1286d`, `cbb84ea219` | "Update LICENSE", "Add pre-release versioning" — open-source infrastructure goes in. |
| 2020-06-13 | `783baec408` | "Add sphinx doc files" — first user-facing documentation. |
| 2020-06-25 | `c7d855b99b` | "Update buildspec" — last commit of this chapter; the next month is the public release. |

## Architecture state at the end of this chapter

Already in place (and largely surviving today, with names changed):

```
                   ┌───────────────────────────────┐
                   │       Strategy (Python)       │
                   └───────────────┬───────────────┘
                                   │ on_quote / on_trade / on_bar
        ┌──────────────────────────┴──────────────────────────┐
        │                Cython "core" runtime                │
        │  ┌─────────────┐    ┌─────────────────────────────┐ │
        │  │  DataEngine │    │  ExecutionEngine + Cache    │ │
        │  └──────┬──────┘    └──────────────┬──────────────┘ │
        │         │                          │                │
        │  ┌──────┴───────┐          ┌───────┴────────┐       │
        │  │  DataClient  │          │  ExecClient    │       │
        │  │  (FXCM/etc.) │          │  (FXCM/etc.)   │       │
        │  └──────────────┘          └────────────────┘       │
        └─────────────────────────────────────────────────────┘
                                   │
                       ┌───────────┴─────────────┐
                       │  Redis (state, events)  │
                       └─────────────────────────┘
                       │  ZeroMQ (inter-process) │
                       └─────────────────────────┘
```

What is *not* yet here:

- No `MessageBus` class. Messaging is point-to-point through Cython interfaces.
- No `Cache` unification — `DataCache` and `ExecutionCache` are separate.
- No `OrderBook`. Quotes and bars only.
- No `Component` finite-state machine. Components have ad-hoc start/stop methods.
- No `BacktestEngine` of the modern kind — earlier scaffolding only.
- No `RiskEngine`. Pre-trade checks live inside the strategy or are absent.
- No third-party adapters of the modern shape. FXCM is *the* counterparty.
- No Rust. No PyO3. No Cargo.toml.
- No GitHub repo (no PRs, no issues, no public discussion). All design decisions
  live in commit messages and the author's head.

## Key decisions

### Cython, not pure Python (and not PyPy)

The hot path was cythonized in chunks from December 2018 through early 2019.
The author's apparent reasoning, reading the commit pattern: pure Python's
attribute access cost is unacceptable for tick-by-tick FX, but writing the
entire stack in C++ would have killed iteration speed. Cython's `cdef` types
give you C-level field access and method dispatch with Python's syntax and
debugging story. The cost — which compounds for the next seven years — is
that any Cython type that's part of the public API has a hand-written C-level
shape, and porting it later to Rust means *also* porting the FFI surface.
Chapter 7 onwards is in many ways "paying off the Cython debt".

**Why:** The platform was always meant to do live trading on real money,
which forced microsecond budgets that pure Python could not meet, while
the author wanted to keep iterating in a Python-first workflow.

### Domain objects, not protobuf

Protobuf was tried and dropped within a week (June 26 → July 2 2018). The
project went to hand-written value objects (`Symbol`, `Price`, `Quantity`,
`Money`). That decision permeates everything — these types are still
hand-written, and they evolved from Python classes → Cython `cdef class` →
Rust 64-bit-int-backed types → 128-bit (chapter 11) but they have always
been first-class.

**Why:** Protobuf forces nullable fields, enforces a wire-shape on memory
layout, and complicates equality / hashing. Hand-written domain objects let
the author put invariants directly into constructors (the seed of the
"fail-fast" policy that becomes explicit in chapter 14).

### ZeroMQ + Redis from day one

The platform was distribution-aware from the beginning. ZeroMQ for transport,
Redis for durable state. That is *not* what most Python algotrading codebases
look like — they usually start single-process. This is one of the strongest
fingerprints of the author's apparent prior experience: the system was
*designed* assuming you would eventually have a separate process per strategy
or per venue. ZeroMQ goes away later (chapter 5 brings the in-process
`MessageBus`), but Redis stays as the cache backing.

**Why:** Live trading has hard reliability requirements that single-process
designs cannot meet — a strategy crash should not take down the data feed,
and restarting should not lose orders. Redis-backed state and ZeroMQ
boundaries make crash recovery tractable.

### FX-first, but generalizable

Despite "FXCM symbol factory" in August 2018 and the early "forex instrument"
commits, the author was careful enough that nothing in the *data model*
hard-codes forex. `Instrument`, `Symbol`, `Venue`, `Price`, `Quantity` are
all generic. The FXCM-specific code lives in an adapter directory. This is
why the open-source release was able to remove "FXCM" without restructuring.

## Casualties

- **Protobuf** — abandoned within a week of the initial commit.
- **All FXCM-specific naming** — stripped in the May–June 2020 cleanup window.
- **Per-package indicator namespaces** — merged into a single `indicators`
  package on 2020-06-09 (`2bf776b972` "Merge indicators package").
- **Old test layout** — renamed to standard `tests/` on 2020-06-08.
- **In-process `multiprocessing.Pool`** — added on 2018-07-03 (`e32dd6ac45`)
  and gradually backed out in favour of explicit threading + ZeroMQ.

## Q&A

### Why was the project closed-source for two years before going public?

The commit messages don't say, and there is no public history from this
period. The most defensible reading is that the author was building a
production trading platform for personal or commercial use, and only after
two years of in-production validation did they decide to release it. The
3-month "dead zone" before the July 2020 release looks like deliberate
preparation: licence work, header updates, FXCM-specific code stripped,
package renamed. **Verdict: cannot be answered from history alone; the
shape of the dead-zone commits suggests a planned cutover, not a sudden
decision.**

### Why ZeroMQ if it later goes away?

ZeroMQ was the assumption that a Nautilus deployment would be multi-process.
The MessageBus refactor in chapter 5 keeps the *abstraction* (publish /
subscribe / request / response) but moves the default implementation in-process
because most users don't actually want the operational complexity of multi-process.
Redis becomes the optional durability story instead.

### Why not just use an existing event-driven framework (Faust, Streamz)?

The author wrote everything from scratch. The closest parallel project in
2018 was probably `zipline` (vectorised, not event-driven) or a bespoke C++
shop. The decision to roll the kernel by hand is consistent with the rest of
the project's philosophy: every line of the hot path is owned by the
maintainer, no surprise dependencies, no leaky abstractions. The cost is
two years of plumbing before any user-facing release.

## Insights for daily work

- When you see a `cdef class` with `readonly` attributes, that is genesis-era
  Cython for "this used to be a `@property` but it was too slow." Don't
  rewrite it as a `@property` thinking it's cleaner — there is a benchmark
  somewhere with a delta on it.
- When you wonder why `Cache` started life as `DataCache` *and* `ExecutionCache`,
  see chapter 5 — they were unified later.
- The fact that timestamps are `int64` nanoseconds throughout the entire stack
  (not `datetime`, not `pd.Timestamp` until the boundary) is a genesis-era
  decision. Don't fight it — every Rust type assumes `i64` ns.
