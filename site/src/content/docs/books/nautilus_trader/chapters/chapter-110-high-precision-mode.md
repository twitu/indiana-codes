---
title: "Chapter 110: High-Precision Mode — 128-bit Value Types and the Arrow Schema Break (2025-01 → 2025-02)"
---
**Period:** 2025-01-10 → 2025-02-09 (~1 month)
**Tag:** `v1.210.0` → `v1.211.0`
**Why this chapter exists:** A single release (`v1.211.0`) changes the
underlying integer width of `Price`, `Quantity`, `Money` from 64-bit to
128-bit. This sounds boring; it isn't. **It breaks every Arrow schema in the
catalog**, breaks the platform on Windows (MSVC has no `__int128`), and
forces a precision-mode flag that propagates from Cargo features through
Cython compile flags through Python wheels. It is also the chapter that
formalises an RFC issue process — issue #2084 is the design discussion. After
this chapter, the data model can represent prices like 1e-16 USDT and
quantities far above i64 limits, which the larger crypto / DeFi user base
needs.

## Timeline

| Date | Tag | What landed |
|------|-----|------------|
| 2025-01-10 | `v1.210.0` | Pre-high-precision. `PerContractFeeModel`. dYdX adapter polish. `OrderManager` ported to Rust. Trailing stop logic ported to Rust. **Cython 3.1.0a1** (alpha; Cython modernisation underway). |
| 2025-02-09 | **`v1.211.0`** | **`high-precision` mode introduced.** 128-bit-backed value types. Arrow schemas changed to `FixedSizeBinary`. Many Polymarket / Betfair / risk fixes. **"This release will be the final version that uses Poetry for package and dependency management."** TA-Lib subpackage *deprecated* (RFC #2206). |

## Architecture change

### Before (v1.210)

```
   Price, Quantity, Money: i64  (max ~9.22e18)
                  with up to 9 decimals of precision
   Arrow schemas: int64 + int8 (precision)
   Wheels: single architecture / precision combo
```

For most users, fine. For a Polymarket trader pricing in fractional
USDC.e at sub-cent precision, the i64 is too narrow once you account for
implied volatility ratios, leverage, or extreme prices like 1e-12. For a
crypto trader with OHLCV bars rolled up over years, the *volume* field
can exceed 1e18.

### After (v1.211)

```
   Price, Quantity, Money: i128 by default (linux/macOS wheels)
                           or i64 ("standard precision") on opt-in
                  up to 16 decimals of precision in i128 mode
   Arrow schemas: FixedSizeBinary (16 bytes for i128, 8 for i64)
   Wheels:
     Linux x86_64 / ARM64:  high-precision (i128) — default
     macOS ARM64:           high-precision (i128) — default
     Windows x86_64:        standard-precision (i64) only
                            (MSVC's C/C++ frontend doesn't support __int128)
   Rust crates: opt-in via `high-precision` feature flag
   Standalone Rust users: standard-precision is the default
```

## Key decisions

### Default to high-precision on all platforms that support it

Linux / macOS ship i128 by default. Windows can't (MSVC limitation),
so it ships i64 only. Pure Rust on any platform can do either via a
Cargo feature; default is i64 because most Rust users don't have the
crypto-DeFi precision pressure. **The maintainer chose "broadest
correctness wins by default, opt-out for Windows users" rather than
"smallest common denominator wins".** This is consistent with the
fail-fast philosophy from chapter 14 (data integrity > availability):
Windows users get a documented limitation, but they don't silently
lose precision.

### Arrow schema change: `int64+int8` → `FixedSizeBinary`

The new representation uses `FixedSizeBinary(16)` for prices and
quantities (the raw 128-bit integer bytes, fixed-width). All prior
Parquet data is **unreadable** without migration. The release notes
include "For migrating data catalogs due to the breaking changes, see
the data migrations guide".

This was a serious break. The team chose to do it once, with full
opt-in from users (release notes warn loudly). Rather than support
two Arrow schemas in parallel, they chose to break and migrate.

### RFC-driven design

`v1.211` references RFC issue #2084 explicitly. This is the first
visible instance of an "RFC" issue actually driving a major
architectural change. From this point forward, big changes (new
adapter, big API rewrites) typically have an RFC issue. The
ROADMAP.md formalises this for new integrations: "Step 1 – Open an
RFC".

**Why:** the precision-mode change was big enough that the
maintainer wanted public design discussion before commit. Earlier
big changes (chapter 5's MessageBus, chapter 10's engine port) didn't
have an RFC because they were almost entirely the maintainer's solo
work. By 2025 the contributor base was big enough that public
design discussion mattered.

### "Final version using Poetry" — the uv migration begins

v1.211 is the last Poetry release; v1.212 (chapter 12) switches to
`uv`. The maintainer announces it in the release notes here.
Foreshadowing.

### TA-Lib deprecated (RFC #2206)

By v1.211 the indicators subpackage has its own Rust port
(see chapter 9 / 10 — many TA-Lib indicators ported by `@Pushkarm029`).
TA-Lib the C library is no longer pulling its weight as a dep.
RFC issue #2206 announces the deprecation; v1.212 actually removes it.

## Casualties

- **Old Parquet catalog files** — readers must migrate (or stay on
  v1.210).
- **64-bit-only assumption in code** — fixed everywhere with `T = u128`
  on i128 builds.
- **`OptionsContract` / `OptionsSpread`** — *renamed* `OptionContract`
  / `OptionSpread` (singular more technically correct).
- **`max_ws_reconnection_tries` config** — removed (no longer
  applicable with infinite retries + exponential backoff, which lands
  in chapter 13).
- **TA-Lib subpackage** — deprecated.

## Q&A

### Why couldn't the change be backwards-compatible?

The Arrow schema is binary — there's no way to read FixedSizeBinary(16)
data with an int64 reader. The wire format and the in-memory
representation are tied. The team could have implemented a v1/v2
catalog reader that handled both, but it would have doubled the
catalog code and made the migration ambiguous (when does a user
"finish" migrating?). A clean break with a migration guide is more
honest.

### Why does Windows get worse precision?

MSVC's C/C++ frontend doesn't support `__int128` natively. The
Cython/FFI layer for Nautilus needs that to round-trip Rust's
`i128` through C ABIs. Without `__int128`, the Cython layer would
have to implement multi-word arithmetic by hand — a significant
amount of code and a category of subtle correctness risk. The
maintainer chose to ship Windows wheels in standard precision rather
than expand the maintenance burden. Pure-Rust Windows users still
get high-precision because Rust handles `i128` itself.

### Could the precision-mode flag have been a runtime switch?

No — the bit-width is part of the type's memory layout, which is
part of the Cython / Rust FFI ABI. A runtime switch would mean every
operation branches on which type representation is in use. A compile
feature is the right choice.

### Was there a meaningful performance cost to going to 128-bit?

Yes, but it's modest. 128-bit arithmetic on modern x86_64 is two
ALU ops instead of one for most operations; on ARM64 it's similar.
Hot paths that do millions of ops per second see a few percent
slowdown. The team judged the precision win worth it.

## Insights for daily work

- If you're on Linux or macOS, you're in high-precision mode by
  default. Don't rely on `i64` overflow behaviour anywhere.
- If you're on Windows, you're in standard precision. Code that
  assumes 16 decimals breaks; code that assumes 9 decimals works.
- Check `nautilus_trader.high_precision` (or the equivalent Rust
  feature flag) at runtime if you genuinely need to know which mode
  you're in. Most code shouldn't need to.
- If you write a new instrument type, use `Price` and `Quantity`
  unconditionally — the precision mode is transparent at that level.
- Migrating a catalog: the docs explain "data migrations". The
  team's clear intent is "migrate once, never look back."
- The fact that Cython moved to 3.1.0a1 in v1.210 and 3.1.0b1 in
  v1.216 is unrelated to precision but tracks: the project is on
  the bleeding edge of Cython, *and* moving away from Cython. This
  is the late-Cython era.
