---
title: "Chapter 040: Identity Crisis — Symbol → Security → InstrumentId and Custom Data (2021-02 → 2021-04)"
---
**Period:** 2021-02-05 → 2021-04-30 (~3 months)
**Tags:** `v1.100.x` → `v1.117.0`
**Release-notes era starts here** (`RELEASES.md` first entry: `v1.106.0`).
**Why this chapter exists:** Within ~6 weeks the platform's most fundamental
identifier was renamed *twice*: `Symbol` → `Security` → `InstrumentId`. That
sounds like indecision; it isn't. Each rename peeled back one layer of
"venue-as-property-of-symbol" thinking until the data model was clean enough
to support multi-venue trading and Interactive Brokers. **If you only read one
chapter to understand the modern domain model, read this one.** It also
introduces `Data` as an abstract base class, scaffolds the `RiskEngine`, and
lands the first `Future` instrument — the IB integration's wedge.

## Timeline

| Date | Tag | What happened |
|------|-----|---------------|
| 2021-02 | `v1.100.x` → `v1.105.x` | OrderBook iteration continues. Position/PnL refactors. |
| 2021-02-21 | `v1.105.0` | Last release before the IB-driven overhaul. |
| 2021-02-26 | **`v1.106.0`** | **First release with notes.** "Scaffold Interactive Brokers integration in `adapters/ib`". `Future` instrument added. `StopLimitOrder` added. **`Data` and `DataType` types introduced**. **`InstrumentId` initial implementation**. |
| 2021-03-04 | `v1.107.0` | `SimulatedExchange` refactor for matching realism. Risk subpackage created. |
| 2021-03-09 | `v1.108.0` | **Major: `Symbol` is replaced by `Security`.** "Previously the `Symbol` identifier also included a venue which confused the concept." |
| (1.108) | | `AssetClass.EQUITY` → `AssetClass.STOCK`. `from_serializable_string` → `from_serializable_str`. Every previous serialisation breaks. |
| (1.109) | `v1.109.0` | "Refine and further bed down" the `InstrumentId`. `InstrumentId` takes a first-class `Symbol`. `AssetClass.BETTING` added (foreshadowing Betfair). |
| 2021-03-13 | **`v1.110.0`** | **Major: `Security` is renamed to `InstrumentId`.** `Instrument.security` → `Instrument.id`. `Data` becomes an abstract base class with `timestamp` / `unix_timestamp`. `GenericData` introduced. |
| 2021-03-18 | `bbd80af5e5` | First commits in `adapters/betfair` — sports-betting integration begins. |
| 2021-04-01 | `v1.113.0` | Continuing reshaping. |
| 2021-04-29 | `v1.117.0` | End of chapter — chapter 5's MessageBus refactor follows. |

## Architecture change

### Identifier model — before

```
                  ┌──────────────────────────────────┐
                  │  Symbol("EURUSD", venue=FXCM)    │
                  └────────────────┬─────────────────┘
                                   │ used everywhere
        ┌──────────────────────────┴──────────────────────────┐
   Instrument              Order               Strategy
   .symbol                 .symbol             on_quote(symbol, ...)
        │                       │                    │
        └─ ambiguous: is "EURUSD on Oanda" the same Symbol as "EURUSD on FXCM"?
```

`Symbol` carried a venue. Two FX brokers' EURUSD compared equal in some
methods, unequal in others. There was no clean way to route an order: should
the venue come from the symbol, the order, or the strategy?

### Identifier model — after

```
                ┌──────────────────────────────────────┐
                │  InstrumentId("EURUSD", Venue("FXCM"))│
                │      = Symbol("EURUSD") + Venue       │
                └─────────────────────┬─────────────────┘
                                       │
        ┌──────────────────────────────┴───────────────────────────┐
   Instrument                  Order                  Strategy
   .id  (InstrumentId)          .instrument_id         on_quote(quote)  # quote.instrument_id
        │                            │                    │
        └─ Symbol = ticker only.  Venue = where it trades.
           InstrumentId = the *contract*: ticker + venue.
```

`Symbol` is a value type (`Ustr`-backed string). `Venue` is a value type
(also `Ustr`-backed). `InstrumentId` is a `(symbol, venue)` pair. Ordering,
cache-keying, and routing all become unambiguous.

### Why two renames in two weeks?

Reading the v1.108 and v1.110 release notes together: the first attempt
(`Security`) removed venue from `Symbol` but kept the asset-class /
asset-type baggage on the new identifier (so `Security` had `AssetClass`
and `AssetType` properties as part of its identity). The second rename
recognised that asset class is a *property of the instrument*, not of its
identity. The cleaner split — `InstrumentId` is *just* `(Symbol, Venue)`,
with all the metadata living on `Instrument` — is what survives.

## Key decisions

### `Data` becomes an abstract base class

Until v1.106, the in-flight types (`QuoteTick`, `TradeTick`, `Bar`,
`OrderBookDelta`) shared no parent. Custom data couldn't be cleanly added
to a backtest or persisted. `v1.106` introduces `Data` and `DataType`, and
`v1.110` makes `Data` an abstract base class with `timestamp` and
`unix_timestamp` properties. From this point onward, *every* tick-shaped
object in Nautilus is a `Data` subclass. This is the seed of the
"`@customdataclass` decorator" that lands much later (v1.198, chapter 9).

**Why:** the platform was being used for non-FX data (alternative data,
sentiment feeds) and users needed a way to publish their own types
through the engine without modifying core code.

### `RiskEngine` is scaffolded

`v1.107.0` introduces a `risk/` subpackage. There is no real risk logic
yet — pre-trade checks still live in strategies — but the seam is opened.
Chapter 5 fills it in. By chapter 10 it's ported to Rust. The fact that
this seam exists from v1.107 means there was never an architectural
decision *whether* to have a risk engine; only *how* to fill it in.

### Interactive Brokers as the wedge for the data model rewrite

`v1.106` "Scaffold Interactive Brokers integration in `adapters/ib`" and
the data-model rewrite are the *same release*. Reading the timing as
deliberate: IB is the venue that exposes every shape the FX-only model
had been hiding from. Stocks, futures, options, multi-asset accounts,
multi-currency P&L. Trying to put IB in the v1.105 data model would have
been impossible. The author started writing the IB adapter, hit the
limits, and tore the data model up.

### Betfair as a second forcing function

`adapters/betfair` first commits 2021-03-18, between v1.110 and v1.113.
Sports betting markets *deeply* don't fit a quote/trade/bar model — you
have probability ladders, market suspension states, "going in play"
events. `AssetClass.BETTING` is added in v1.109. The data model, freshly
liberated by `InstrumentId`, has to stretch again to accommodate.
This is a *good* thing for the architecture — it forced abstractions that
later make crypto adapters cleaner.

## Casualties

- **`Symbol` carrying a venue** — replaced by `InstrumentId`.
- **`Security` identifier** — lived for ~1 week (v1.108 → v1.110).
- **`AssetClass.EQUITY`** — renamed to `AssetClass.STOCK`.
- **All previous serializations** — twice, at v1.108 and v1.110.
- **`from_serializable_string` / `to_serializable_string`** — renamed to `..._str`.
- **`asset_class` and `asset_type` as part of identifier** — moved to
  `Instrument` proper.

## Q&A

### Why was the rename done in two steps instead of one?

The v1.108 commit messages frame the work as "make the symbol identifier
cleaner for IB". Halfway through, it was apparent that `Security`
(symbol + venue + asset class + asset type) was carrying too much. The
v1.110 rename to `InstrumentId` was the second attempt to find the
minimal identity. Two-step refactors are not unusual when you don't
know the right shape until you start using it.

### Why is `Symbol` still a type at all?

Because `InstrumentId` decomposes into `(Symbol, Venue)` and code that
operates on a venue's symbol set (instrument providers, raw-symbol
parsing) needs the ticker without the venue. `Symbol` survives as a
value type but is no longer used as a primary key.

### Why is custom data introduced *now* rather than from day one?

Because before v1.106 the only data types in the system were the ones
the maintainer needed for FX. The IB integration brought new data shapes
(option chains, fundamentals — not in 2021, but on the roadmap), and the
generalisation that survives is "any type is `Data` if it has a
`timestamp` and `unix_timestamp`."

### Was the `RiskEngine` scaffold a mistake (since it sat empty)?

No — it gave the abstraction a name and a home. Filling in an empty
scaffold (chapter 5) is much easier than retrofitting a `RiskEngine`
into a codebase that has pre-trade checks scattered across strategies.

## Insights for daily work

- When you see `instrument_id` in a method signature, that's correct. When
  you see `symbol` in a method signature on a recent (post-v1.110) class,
  that's a smell — it's either pre-rename code or a leaked raw venue
  symbol.
- The `Venue` value type uses `Ustr` (string interning). Don't construct
  `Venue("BINANCE")` in a hot loop — interning is fast, but the upper
  bound on stored interned strings matters at scale.
- `Data`'s contract — every subclass has `ts_event` and `ts_init` — is a
  v1.110 invariant. Custom data types that skip these break Arrow
  serialization (chapter 5+) and Parquet catalog roundtrips.
- The `AssetClass.BETTING` enum value (v1.109) is the cheapest way to
  trace which parts of the codebase have to handle Betfair — grep for
  it, every special case it triggers is a place where the standard
  quote/trade/bar pipeline doesn't apply.
