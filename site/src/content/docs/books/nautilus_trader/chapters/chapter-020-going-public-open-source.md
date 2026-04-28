---
title: "Chapter 020: Going Public — The Open-Source Cutover (2020-07 → 2020-10)"
---
**Period:** 2020-07-18 → 2020-10-31 (~3.5 months)
**Commits:** ~750
**Tags:** none yet (the first tag is `v1.90.2` on 2020-11-04 — chapter 3).
**Why this chapter exists:** This is the public birth of the project. The
commits in this window are unusually heavy on CI, documentation, and
packaging — it is *not* primarily a feature-development chapter. Reading it
matters because the open-source machinery laid down here (PyPI naming, version
scheme starting at 1.90, the GitHub-based PR workflow) constrains everything
that comes after. It is also where the modern adapter directory layout
(`adapters/binance`, `adapters/bitmex`, `adapters/oanda`, …) takes shape.

## Timeline

| Date | Commit / event | What happened |
|------|---------------|---------------|
| 2020-07-18 | `gh release` infrastructure first appears | Codacy badge, dev docs |
| 2020-07-19–20 | (cleanup) | Hooks for code coverage, flake8 fixes |
| 2020-07-21 | `Release` commit | **Public PyPI release.** First wheel built and published. CI workflow is established. |
| 2020-07-21 | `Bump version` | Semantic-version-style numbering starts. The version *jumps* to 1.90.x, signalling the project was already mature internally — version numbers carried over from the closed-source phase. |
| 2020-07-29 | `94ba0eb6e7` | Bar-aggregation accuracy improvements — the first non-trivial post-release work |
| 2020-08 | (62 commits) | Slow ramp; mostly CI and bug-fix work |
| 2020-09-21 | `99c7f2c86c` | **Adapters directory established.** First commits in `adapters/binance` and `adapters/bitmex`. |
| 2020-09-22 | `DataEngine` first explicit reference | The data engine concept formalises into a class name |
| 2020-09-25 | `72369d5783` | First `nautilus_trader/redis` directory — Redis becomes a first-class subpackage rather than a scattered dependency |
| 2020-10 | (308 commits — biggest month so far) | Adapter scaffolding race: CCXT, Binance, BitMEX, Oanda |
| 2020-10-31 | (end of chapter) | Sets up the November 4 first-tag release |

## Architecture state

By the end of this chapter, the public-facing shape is:

```
nautilus_trader/                      # importable Python package
├── core/                              # Cython types: UUID, datetime, etc.
├── model/                             # Cython domain (Price, Quantity, Symbol, ...)
├── common/                            # Component, Logger, Clock, MessageBus precursor
├── data/                              # DataEngine + DataClient base
├── execution/                         # ExecutionEngine + ExecClient base
├── trading/                           # Strategy + Trader
├── live/                              # Live trading node
├── backtest/                          # BacktestEngine
├── analysis/                          # Performance analysers
├── indicators/                        # Single merged indicators package
├── adapters/
│   ├── binance/        # NEW
│   ├── bitmex/         # NEW
│   ├── ccxt/           # NEW (will be deprecated)
│   └── oanda/          # NEW (will be deprecated)
├── redis/              # Cache database backing
└── serialization/      # MessagePack-based
```

## Key decisions

### Versioning starts at 1.90, not 0.x or 1.0

The first PyPI release is **1.90.2**, not 0.1.0 or 1.0.0. The author has been
versioning the closed-source build for some time, and the public release just
keeps the running counter. This is unusual and matters: every reader who
expects "early version = unstable, late version = stable" will misread the
project. NautilusTrader is *still* labelled `Beta` at v1.225 in 2026 — the
version number is a build counter, not a stability signal. The README warns
about this explicitly under "Versioning and releases".

**Why (inferred):** the author wanted to preserve the actual production
history rather than reset the counter for marketing reasons. Continuity over
narrative.

### Multi-adapter architecture chosen up front

In a single 60-commit burst on 2020-09-21, three adapters get scaffolded
simultaneously: Binance, BitMEX, and CCXT. This is a strong signal that the
"ports and adapters" architecture (mentioned later in `docs/concepts/architecture.md`)
was the intent from the open-source release, not retrofitted. The adapter
shape — `*HttpClient`, `*WebSocketClient`, `*DataClient`, `*ExecutionClient`,
`*InstrumentProvider` — appears here for the first time.

**Why:** to demonstrate the platform's claim of being asset-class agnostic.
A FX-only project nobody would have used; a CEX-crypto project would have
positioned it against existing libraries. By landing three diverse venues
in the same release window, the author signals that the *engine* is the
product, not the integrations.

### CCXT included, but on its own track

CCXT (the multi-exchange library) gets an adapter at the same time as the
hand-written Binance and BitMEX adapters. This looks contradictory — why
hand-write a Binance integration if CCXT can talk to it? — but the answer
becomes clear later: **CCXT is the cheap way to onboard a venue, and
hand-written adapters are the way to do it properly.** CCXT eventually gets
deprecated and removed (~2022), and every venue worth supporting is rewritten.
But in 2020 it is the on-ramp.

### LGPL-3.0, not MIT or Apache

The licence is LGPL-3.0. This is unusual for a Python project (most go MIT
or Apache 2.0). LGPL allows commercial use but requires modifications to the
library itself to be released under LGPL. The author runs a company
(NautechSystems), and LGPL is the choice you make when you want strong
copyleft on your engine while letting users build proprietary strategies on
top. The trademark posture (`TRADEMARK.md`, added much later) is consistent
with this — the *name* and *engine* are protected; the user's strategy code
is theirs.

## Casualties

- **Protobuf** (gone since 2018, formally removed before public release).
- **Multiple indicator namespaces** (merged June 2020 just before release).
- **Internal-only test fixtures** referencing FXCM credentials.
- **Internal package names** unfit for public release (renamed late June 2020).

## Q&A

### Why is there no v0.x? Was this a strategic choice?

The version stream is continuous from the closed-source build. v1.0 was
internal, sometime in 2019. By the time of the open-source release the build
was at 1.89-something, so 1.90.2 is just "the next number." There is *no*
v0 in the public record because there was no v0 of the public package.

### Why open-source it at all?

The commit history doesn't say. Reading the surrounding signals — the
careful licence choice (LGPL preserves engine copyleft), the deferred-trademark
strategy, the deliberate "Beta" label that persists, the
NautechSystems brand — the apparent strategy is "open-core engine with
commercial services around it." The 2025 ROADMAP.md explicitly names this:
"NautilusTrader is an open-core project. All core trading engine features
land in the public repository first."

### Why was the GitHub repo silent for the first few months?

There are no GitHub PRs or issues from this period. The author was the
sole committer. External contributors don't show up in real numbers until
chapter 4 onwards. This explains why the commit messages are terse — no
external reviewer to write for.

## Insights for daily work

- Don't read versions as stability signals. v1.225 in 2026 is a *build counter*.
  The README's "Beta" warning is sincere — APIs still break between minor
  versions. (See chapter 11 — high-precision mode broke Arrow schemas.)
- When you find a half-written adapter (CCXT, Oanda, the early FTX scaffolds
  from chapter 6), don't try to bring it back. The maintainer's pattern is to
  scaffold cheaply, learn what the venue API actually looks like, and either
  rewrite from scratch or remove. Resurrecting a sunset adapter is *not* a
  good first PR.
- The `redis` subpackage created here later moves under `infrastructure/`
  (chapter 5) and finally vanishes when Redis access goes to Rust (chapter 8).
  If you're hunting for "where Redis is touched", expect it to have moved
  three times.
