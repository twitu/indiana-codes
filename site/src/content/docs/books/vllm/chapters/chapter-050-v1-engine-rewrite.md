---
title: "Chapter 050: V1 Engine — the rewrite (Dec 2024 – Mar 2025)"
---
**Releases:** `v0.7.0` (Jan 27 2025) → `v0.8.0` (Mar 19 2025)
**Anchor RFC:** [#8779 — *vLLM's V1 Engine Architecture*](https://github.com/vllm-project/vllm/issues/8779) (the canonical V1 design doc on GitHub)
**Why:** vLLM's CPU-side overhead — Python scheduling, input broadcasting, sampler pythonization, detokenization — had become the dominant cost on H100-class hardware. The V1 rewrite is the team's deliberate, RFC-driven reset of the engine architecture: stateful workers, single-step async scheduling, multi-process API server, **prefix caching as a first-class feature**, and `torch.compile` on by default.

## Timeline

| Date | Anchor | What happened |
|---|---|---|
| 2024-09 (issue created) | [#8779](https://github.com/vllm-project/vllm/issues/8779) | RFC posted by the maintainers (@WoosukKwon, @zhuohan123, @youkaichao, @simon-mo, @LiuXiaoxuanPKU, @comaniac, @alexm-neuralmagic, @njhill, @robertgshaw2-neuralmagic, @rkooo567). |
| 2024-10-22 | [#9289](https://github.com/vllm-project/vllm/pull/9289) | First V1 commit — `vllm/v1/` directory created. |
| 2024-11–2024-12 | many | Incremental V1 PRs (#9826, #10135, #10288, #10211, #10225, #10228, #10268, #9954, #10272, …). |
| 2025-01-27 | `v0.7.0` | **V1 alpha** (`VLLM_USE_V1=1`). 44 V1 commits in this release. **`torch.compile` is now fully integrated and enabled by default in V1** (#11614). LLM.sleep, LLM.wake_up, LLM.collective_rpc for RLHF (#12361, #12084, #12284). |
| 2025-02 | `v0.7.x` | DeepSeek-V3 / R1 era. **MLA on V1** (#13789, #14253, #14384, #14540, #14921). FlashMLA (#13747). |
| 2025-03-19 | `v0.8.0` | **V1 enabled by default** (#13726). EP for DeepSeek (#12583), DP attention (#13931), MTP (#13626). Pluggable scheduler (#14466). |

## Architecture: V0 vs V1, side by side

### V0 (one process)

```
┌──────────────────────────────────────────────────┐
│  Python process                                  │
│  ├─ AsyncLLMEngine  (busy loop)                  │
│  ├─ LLMEngine                                    │
│  │   ├─ Scheduler  (Python, per-step, on hot path)│
│  │   ├─ BlockManager                             │
│  │   └─ Executor                                 │
│  │       └─ Worker(s)  (also in this process,    │
│  │           or remote Ray actors)               │
│  └─ OpenAI server (FastAPI in same loop)         │
└──────────────────────────────────────────────────┘
```

### V1 (mesh of processes, ZMQ between them)

```
┌────────────────────┐  ZMQ   ┌────────────────────┐  ZMQ   ┌──────────────────┐
│  API server proc   │◄──────►│  Engine core proc  │◄──────►│  Worker proc(s)  │
│ (FastAPI, OpenAI)  │        │  - Scheduler       │        │  - ModelRunner   │
│ - request decode   │        │  - KVCacheManager  │        │  - stateful      │
│ - tokenization     │        │  - busy loop       │        │    request state │
│ - mm preprocess    │        │  - async output    │        │  - executes fwd  │
│ - SSE/HTTP streams │        │    processing      │        │  - returns       │
│                    │        │  - 1 per DP rank   │        │    sampled tok   │
└────────────────────┘        └────────────────────┘        └──────────────────┘
   1 (or N for DP)              1 per data-parallel           TP × PP per
                                rank                          engine core
```

The full picture is in [`docs/design/arch_overview.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/arch_overview.md)
and [`docs/design/multiprocessing.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/multiprocessing.md).

## Key decisions made in this chapter

### 1. Stateful workers, "send only the diffs"

**The single biggest break with V0.** In V0 the driver re-sent every request's full
state (block table, sampling params, etc.) to every worker every step. In V1, the
worker holds the request state across steps. The driver sends:
- New requests: full state.
- In-flight requests: just `{request_id, new_block_ids, num_new_tokens}`.

The savings on broadcast time are huge at large TP — and this is the entire reason
async scheduling becomes possible without input-prep on the critical path.

### 2. **Async single-step scheduling**, not multi-step

V1 explicitly rejects v0.6's multi-step scheduler. Instead: while the worker runs
step N, the scheduler is already producing inputs for step N+1. This requires (1)
the scheduler is fast enough to fit in the GPU step (drives the move toward
incrementally-built inputs), and (2) the **detokenizer also moves to the driver**
(driver-side async detok). RFC: [#20727](https://github.com/vllm-project/vllm/issues/20727).

### 3. **`SequenceGroup` is removed**

A core V0 abstraction that supported beam search and parallel sampling. V1 makes
each request a single sequence and **emulates beam search via prefix caching**
(parallel sampling = N requests sharing a cached prefix). This is the bet that
enables a much simpler scheduler hot path and is the reason "drop beam search"
is in the V1 RFC top-line goals.

### 4. **Prefix caching is on by default**

In V0 it was opt-in (`--enable-prefix-caching`). In V1 it's a core scheduler
assumption: every request hits the prefix cache; cache miss is the slow path.
This drives the design of the new KVCacheManager (see
[`docs/design/prefix_caching.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/prefix_caching.md)).

### 5. **`torch.compile` is default-on**

The team commits to TorchInductor as the model graph compiler. Per
[`docs/design/torch_compile.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/torch_compile.md), V1 compiles
each model with `torch.compile`, drives CUDA graphs through Inductor partitions,
and uses compile-time fusion passes (RMSNorm+quant, RoPE+QKnorm, etc.) instead of
hand-fused kernels. This is the bet that pays off in Chapter 060 (more fusions),
Chapter 070 (multimodal compile), and Chapter 080 (vLLM IR replacing custom ops).

### 6. **`LLM.sleep` / `LLM.wake_up` / `LLM.collective_rpc` for RLHF**

(#12361, #12084, #12284) Lets a training framework pause the engine, swap weights
in via NCCL, and resume — without tearing the process down. This is what makes vLLM
the de-facto rollout engine for RLHF (TRL, OpenRLHF, etc.). See AGENTS.md note:
the project explicitly invests in "RLHF-friendly" features in this era.

### 7. The DeepSeek-V3 / R1 wave forces MLA + EP/DP through V1 (Feb–Mar 2025)

DeepSeek-V3 dropped at the end of 2024 and DeepSeek-R1 in early 2025. Both:
- Use **Multi-head Latent Attention (MLA)**, which has a very different KV-cache
  shape from MHA/GQA (compressed latents projected up per-head).
- Are **MoE** with hundreds of experts → benefit massively from **expert
  parallelism** (EP) and DP-attention.
- Want **MTP** (multi-token prediction) for spec decode.

The team races to support all of this on V1, *not* on V0. Releases v0.7.x and v0.8.0
read like a single sustained DeepSeek-V3 enablement push: FlashMLA, MLA + chunked
prefill (#12639), MLA on V1 (#13789 etc.), EP support (#12583), `enable_expert_parallel`
(#14305), EP/TP MoE + DP attention (#13931), MTP (#13626). These features land on V1
because V1's data structures (per-layer KV manager, pluggable attention backend,
stateless process group) made them tractable. See
[`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md).

## Q&A — seeds for an interactive review

> **Why move to a multi-process architecture? Doesn't ZMQ add latency?**
> ZMQ adds microseconds; Python's GIL on the API server adds milliseconds at
> serving load. Splitting frees the API server's event loop from the engine's
> hot path, lets the engine run a tight C++/CUDA-bound busy loop, and makes
> data-parallelism a first-class concept (one engine core per DP rank). The
> latency cost is paid once per request boundary, not per step.

> **Why is the API server count auto-scaled to DP size?**
> If you have 4 DP engine cores and 1 API server, the API server becomes the
> bottleneck under high QPS — exactly the failure mode V0 had. Scaling it to
> match means routing throughput grows with engine throughput. The flag
> `--api-server-count` exists for users who want to override.

> **Why is `torch.compile` opt-out by default in V1 instead of opt-in?**
> Because every other architectural decision assumes the model goes through
> compile (graph-level fusions, CUDA graph partitioning, custom-op replacement,
> piecewise compilation for spec-decode). Making it opt-in would mean every
> kernel-fusion code path needs an "and also do this manually" branch. RFC
> [#16501](https://github.com/vllm-project/vllm/issues/16501) makes this
> explicit ("vLLM x torch.compile caching should be opt-out by default").

> **What did V1 give up?**
> Beam search (now emulated externally), some V0-only model implementations
> (`SupportsV0Only` protocol — explicitly so the team could ship V1 without
> waiting for every model), and a long tail of V0-only features (some sampler
> options, structured output paths, etc.) that get re-added incrementally in
> v0.7.x and v0.8.x. The release notes for v0.7.0 list each one.

> **Why was DeepSeek-V3 enablement done on V1 and not V0?**
> Because MLA's KV layout doesn't fit V0's `BlockSpaceManager` cleanly — V0's
> block layout is fundamentally MHA/GQA-shaped. V1's KVCacheManager was
> designed with **per-layer cache types** as a first-class concept (RFC
> mentions "regular KV cache, Mamba cache, encoder cache" in its goals), so
> MLA fits naturally. This is also why hybrid SSM/Attention models (Jamba,
> Mamba, Qwen3-Next) only really work in V1.
