---
title: "Chapter 010: The PagedAttention Prototype (Feb–Jun 2023)"
---
**Releases:** `submission` (Apr 17 2023) → `v0.1.0` (Jun 19 2023)
**Repo codename at the time:** *CacheFlow* (the project was renamed to vLLM during the public launch)
**Why:** A single PhD student at UC Berkeley, Woosuk Kwon, set out to build an inference engine where the **KV cache is paged like virtual memory**, so a request's KV blocks no longer have to be physically contiguous. The chapter is the construction of that prototype, the SOSP'23 paper submission, and the first public release.

## Timeline

| Date | Commit / PR | What happened |
|---|---|---|
| 2023-02-09 | `e7d9d9c08` | *Initial commit*. Empty scaffold by Woosuk Kwon. |
| 2023-02-09 | `39161c98a` … `e7bee2aa8` | A single-day burst lands `OPT`, **`blocks`**, **`sequence`**, `decoding params`, **`block manager`**, **`cache engine`**. The skeleton of every vLLM concept that survives to 2026 was laid down in this one sitting. |
| 2023-02-12 | `46958cf94` | `BlockAllocator -> BlockManager` — first rename of a still-living class. |
| 2023-02-13 | `5a309bb58` | **`Add scheduler`** — the iteration-level scheduler that became the heart of vLLM. |
| 2023-02-16 | `6f058c7ba` | *Implement cache ops* — first custom CUDA kernels (`reshape_and_cache`). |
| 2023-02-22 | `7b6844e59` / `8290fce47` | *Add input metadata* / *Add Worker class* — the driver/worker split is born. |
| 2023-03 | `21b3671bb` (#24) | *Basic attention kernel that supports cached KV + (multi-)prompts* — the first PagedAttention kernel. |
| 2023-03 | `12659a0bd` (#26) | *Add CUDA graph-based all reduce launcher* — TP plumbing in before TP was even useful. |
| 2023-03 | `0f4b32199` (#38) | Block size made configurable; **default block size set to 16** (still the default in 2026). |
| 2023-04-17 | `aa50b17ca` | *Change plotting script* — tagged **`submission`**: the SOSP'23 paper submission state. |
| 2023-04 → 2023-06 | many | GPT-NeoX/Pythia, GPT-2, Dolly V2, bf16, **xformers replaces FlashAttention** (`c9d5b6d4a` #70 — the first "swap the attention backend" event in the project). |
| 2023-06 | `7c041ab57` (#82) | *Refactor system architecture* — the rename / public-launch cleanup. |
| 2023-06-19 | `67d96c29f` | Tagged **`v0.1.0`**: first public release. |

## Architecture: state at end of chapter

```
┌─────────────────────────────────────────────────┐
│                LLM (entrypoint)                 │
│  generate() → engine.add_request → engine.step  │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼─────────┐
              │   LLMEngine      │  (single Python process)
              │ ┌──────────────┐ │
              │ │  Scheduler   │ │  iteration-level, FCFS + preemption
              │ │  (Python)    │ │  picks RUNNING / WAITING / SWAPPED
              │ └─────┬────────┘ │
              │       │          │
              │ ┌─────▼────────┐ │
              │ │ BlockManager │ │  paged KV: block_size=16, GPU + CPU pools
              │ │              │ │  swap_in / swap_out, ref-counted blocks
              │ └─────┬────────┘ │
              │       │          │
              │ ┌─────▼────────┐ │
              │ │   Worker(s)  │ │  one per GPU rank (TP via Ray)
              │ │              │ │  CacheEngine: GPU/CPU KV tensors
              │ │              │ │  paged_attention CUDA kernel
              │ └──────────────┘ │
              └──────────────────┘
```

Notable invariants that were chosen here and **persisted for years**:

- **Block size 16** as the default. Set in `0f4b32199` and only revisited as a default
  when MLA / FlashInfer / hybrid attention came along.
- **`SequenceGroup`** as the core unit of scheduling (later removed in V1, which is one
  of the rare big invariant breaks — see Chapter 050).
- **Driver process owns scheduler + block manager; workers own KV tensors and run the
  model.** This split survives the V1 rewrite, it just gets re-implemented over ZMQ.
- **Custom `paged_attention` CUDA kernel** lives in [`csrc/`](../csrc) — see
  [`docs/design/paged_attention.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/paged_attention.md).

## Key decisions made in this chapter

### 1. Page the KV cache, don't contiguous-allocate it

The core academic contribution. Instead of reserving `max_seq_len * num_layers * ...` of
contiguous KV memory per request, allocate fixed-size **blocks** (16 tokens) on demand
and look them up through a per-request **block table**. Internal fragmentation drops
from "wasted half the cache" to "&lt;4% waste"; multiple requests can share blocks
(prefix caching, beam search, parallel sampling).

**Trade-off accepted:** the attention kernel now has to do an indirected gather through
the block table on every step. The custom CUDA kernel in `csrc/attention/` is what
makes this not catastrophic. (See `docs/design/paged_attention.md`.)

### 2. Iteration-level scheduling, not request-level

Re-decide which requests are in the batch every iteration (every decoded token), not
once at admission. Lets new requests join a running batch immediately, and short
requests don't get blocked behind long ones. This is the other half of why vLLM was
faster than HF/TGI in mid-2023 — and it's why the **scheduler is in Python**, because
re-running it 100×/sec made implementation simplicity the priority over per-iteration
scheduling overhead. (That priority gets revisited *hard* in Chapter 050.)

### 3. Driver–worker split with Ray for TP

TP across GPUs uses Ray actors as the worker processes. The driver process holds the
scheduler and block manager; workers hold the KV cache tensors and execute the model.
This was chosen partly for simplicity (Ray gave them a free RPC + lifecycle layer) and
partly because the Berkeley group already used Ray.

**Trade-off accepted:** Ray as a hard dependency for distributed mode. This decision
gets argued with for years (#1814, #2956, …) and is finally relaxed in v0.5.0 where
**multiprocessing becomes the default backend** for single-node distributed cases.

### 4. xformers, then "switch attention backends" as a pattern

`c9d5b6d4a` (#70) replaces FlashAttention with xformers because xformers had broader
GPU support at the time. This is the *first* time vLLM swaps an attention backend, and
the pattern — abstract over multiple backends, pick the best one for the hardware —
becomes formalised seven years (and many backends) later in
[`docs/design/attention_backends.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/attention_backends.md).

## Q&A — seeds for an interactive review

> **Why block size 16, and is it still right in 2026?**
> 16 was empirical — small enough to keep fragmentation low, large enough that the
> attention kernel's indirected gather doesn't dominate. It's still the default for
> classic attention, but MLA, hybrid SSM/Attention, and TurboQuant all motivate
> non-16 block sizes — see Chapter 080 for how the "block size" concept got
> generalised in the V1 KVCacheManager.

> **Why was beam search later dropped in V1?**
> Beam search forced `SequenceGroup` to be a first-class scheduler concept (multiple
> sequences sharing a prompt). The V1 RFC ([#8779](https://github.com/vllm-project/vllm/issues/8779))
> argues it can be **emulated outside the engine via prefix caching**, which lets the
> scheduler treat every request as a single sequence and removes a major source of
> tangled state. See Chapter 050.

> **Why a custom CUDA kernel instead of FlashAttention?**
> FlashAttention 1 (and even early FA2) didn't support the gather-from-block-table
> access pattern PagedAttention needed. vLLM had to ship its own kernel. FA only
> caught up later, which is why FA2/FA3/FA4 backends arrive as *additional* backends
> rather than replacements — see Chapter 030 (FA2) and Chapter 080 (FA4 default
> for MLA prefill).

> **Why was the project called CacheFlow?**
> The early commits (e.g. `4858f3bb4` — *Add an option to launch cacheflow without ray*)
> show the original codename. It was renamed to **vLLM** for the public release in
> June 2023, around the time of `7c041ab57` *Refactor system architecture*.
