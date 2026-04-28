---
title: "Chapter 060: V0 Sunset & the Distributed Serving Era (Apr–Oct 2025)"
---
**Releases:** `v0.9.0` (May 27 2025) → `v0.11.0` (Oct 10 2025)
**Why:** With V1 the default, the team turns its attention outward — beyond the single engine instance. This chapter is about **disaggregated and distributed serving**: KV connectors, NIXL, prefill/decode (P/D) split, expert parallelism, dual-batch overlap, and the final removal of V0. The codebase ends this chapter with `vllm/v1/` no longer being a "v1 of something" — it is just *the engine*.

## Timeline

| Date | Release | What happened |
|---|---|---|
| 2025-05-27 | `v0.9.0` | **PyTorch 2.7** (#16859), default CUDA 12.8. **NVIDIA Blackwell** initial kernels. **NIXL integration for P/D** (#17751). EP modular fused experts + PPLX kernels (#15956). Docs migrated Sphinx → MkDocs. |
| 2025-07-07 | `v0.9.2` | More EPLB, more P/D, KV connector multi-instance. |
| 2025-07-24 | `v0.10.0` | **"Begins the cleanup of V0 engine codebase."** V0 CPU/XPU/TPU/HPU backends removed (#20412), long context LoRA (#21169), prompt adapters (#20588), Phi3-Small + BlockSparseAttention (#21217), V0 spec-decode workers (#21152). Async scheduling flag (#19970). Hybrid SSM/Attention on V1 (#20016). |
| 2025-08-18 | `v0.10.1` | More V0 removal. (Note: a known async-scheduling correctness bug at v0.10.2/v0.11.0 only.) |
| 2025-09-13 | `v0.10.2` | Continued cleanup. |
| 2025-10-02 | `v0.11.0` | **"This release completes the removal of V0 engine."** AsyncLLMEngine, LLMEngine, MQLLMEngine, all V0 attention backends — gone. **CUDA graph default = FULL_AND_PIECEWISE.** DeepGEMM enabled by default (+5.5%). DeepSeek-V3.2-Exp, Qwen3-VL, Qwen3-Next, OLMo3 land. NCCL symmetric memory default for TP. |

## Architecture: from "engine" to "fleet"

V0 → V1 was an *intra-engine* rewrite. v0.9 → v0.11 is an *inter-engine* rewrite —
the engine grows the abstractions to *not be the only engine* in a deployment:

```
            ┌─────────────────────────────────┐
            │ Router / load balancer          │
            └───────┬───────────────┬─────────┘
                    │               │
          ┌─────────▼───┐   ┌───────▼─────────┐
          │ Prefill     │   │ Decode          │
          │ engine(s)   │   │ engine(s)       │
          │  - V1       │   │  - V1           │
          │  - hi TFLOPS│   │  - hi mem BW    │
          └─────┬───────┘   └────▲────────────┘
                │ KVConnector    │  KVConnector
                │ (NIXL / 3FS /  │
                │  Mooncake /    │
                │  P2P NCCL /    │
                │  LMCache / …)  │
                └────► KV blocks shipped over RDMA / network
```

[`docs/design/p2p_nccl_connector.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/p2p_nccl_connector.md) is the
in-tree design doc for one such connector; [`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md)
explains how a single engine handles multiple cache types simultaneously (KV + Mamba +
encoder + image-token caches).

## Key decisions made in this chapter

### 1. **The KV cache is the network protocol**

The `KVConnectorBase_V1` abstraction (with NIXL, Mooncake, LMCache, 3FS, P2P-NCCL
implementations) treats KV blocks as the unit of inter-engine communication. A
prefill engine produces blocks, ships them to a decode engine over RDMA / NIC, and the
decode engine resumes generation as if it had done the prefill itself.

Why the abstraction? The team explicitly does not want to pick winners — different
deployments use different fabrics (NIXL for InfiniBand-class NICs, Mooncake for
fabric-native shared memory, P2P NCCL for in-rack, 3FS for storage offload, LMCache
for on-disk semantic caching). Multiple connectors can be active at once (#17564).
RFCs around the connector API are visible throughout 2025–2026:
[#39696](https://github.com/vllm-project/vllm/issues/39696) (`before_update_states`),
[#31064](https://github.com/vllm-project/vllm/issues/31064) (hidden-states transfer
to skip decoder prefix-prefill).

### 2. **Async scheduling, formalised** ([#19970](https://github.com/vllm-project/vllm/pull/19970))

The flag `--async-scheduling` lets the scheduler run *concurrently* with the GPU step
on the engine core. This is the V1 RFC's "schedule the n+1-th step while the worker
is executing the n-th" idea finally enabled by default-able infrastructure. Note: a
known bug exists in v0.10.2 / v0.11.0 (gibberish output under preemption); this is
fixed in subsequent releases — a useful reminder that the async path is genuinely
hard to get right, hence the staged rollout.

### 3. **V0 removal happens incrementally, then completely**

`v0.10.0` releases notes lead with "Begins the cleanup of V0 engine codebase." Each
release tears out a chunk:

| Release | What got removed |
|---|---|
| v0.10.0 | V0 CPU/XPU/TPU/HPU backends; long-context LoRA; prompt adapters; V0 spec-decode workers; Phi3-Small BlockSparseAttention. |
| v0.10.1 | More V0 components. |
| v0.11.0 | **`AsyncLLMEngine`, `LLMEngine`, `MQLLMEngine`, all V0 attention backends — gone.** |

This is the *biggest* single deletion event in vLLM's history. By the end of v0.11
there is no "V0" — the directory `vllm/v1/` is now an artifact of the rewrite, but
its contents *are* the engine.

### 4. **EPLB — Expert-Parallel Load Balancing**

For models like Mixtral, Hunyuan-V1, GLM-4 MoE, DeepSeek-V3.2 with hundreds of
experts, **token-to-expert routing is uneven**: some experts get hit way more than
others, and on EP that becomes a load imbalance across GPUs. EPLB redistributes the
expert-to-GPU assignment dynamically. Several PRs in v0.11.0 — Hunyuan V1 (#23078),
Mixtral (#22842), static placement (#23745), reduced overhead (#24573).

The 2026 RFCs ([#40567](https://github.com/vllm-project/vllm/issues/40567)
*Fault-tolerant EPLB*, [#39942](https://github.com/vllm-project/vllm/issues/39942)
*Fault-Aware EPLB*) show the design isn't done — EPLB is now a permanent area of
active work.

### 5. **Dual-Batch Overlap (DBO)** ([#23693](https://github.com/vllm-project/vllm/pull/23693))

A scheduling technique where two micro-batches overlap their compute and
communication phases — see [`docs/design/dbo.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/dbo.md). On
DeepEP-using DeepSeek deployments this pulls another chunk of latency out by
hiding all-to-all communication behind dense compute.

### 6. **CUDA-graph default switches to FULL_AND_PIECEWISE**

Until v0.11, vLLM defaulted to PIECEWISE CUDA graphs (graph the small attention-free
sections, leave attention out for safety). FULL_AND_PIECEWISE captures full graphs
*where models support it* and falls back to piecewise where they don't — generally
a measurable speedup, especially on fine-grained MoEs. RFC
[#20283](https://github.com/vllm-project/vllm/issues/20283) reworks
`CompilationConfig` and `-O<n>` levels around this — see also
[`docs/design/optimization_levels.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/optimization_levels.md).

### 7. **Hybrid KV cache manager** (#19351, #21093)

A single engine can now serve a model whose layers have **different KV cache types**
(e.g. Mamba layers + Attention layers, or local-window layers + global layers). The
KV manager allocates a different per-layer cache type into the same block pool with
appropriate sizing. This is the unlock for hybrid SSM/Attention models like
Qwen3-Next, Jamba, and the *attention-free* models (#20811). Design doc:
[`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md).

## Q&A — seeds for an interactive review

> **Why is P/D disaggregation worth the operational complexity?**
> Prefill is compute-bound (long context, big GEMM, lots of FLOPS); decode is
> memory-bandwidth-bound (small batches × KV reads). Co-locating them on the
> same GPU pool means you size for the worst case of both. Splitting lets each
> tier scale independently — a typical real saving of 30–50% GPU-cost at the
> same SLO. The cost is a network hop and a KV-cache transfer; for long-context
> workloads the math is decisively in favour of split.

> **Why so many KV connectors? Why not pick one?**
> Different infra, different winners. NIXL + IB is great for in-cluster RDMA;
> Mooncake is right when you have a Mooncake fabric; LMCache wins when "the
> same prompt prefix" semantically reappears across users (RAG, agents);
> 3FS wins for archive-class warm caches. A pluggable interface keeps vLLM
> from getting locked to one infrastructure choice — and lets the ecosystem
> ship competing implementations without forking.

> **Was async scheduling worth shipping with a known correctness bug?**
> The bug in v0.10.2/v0.11.0 only affected preemption / abort paths and
> existed because the async path moved aborts onto a different code path
> from the synchronous one. The team chose to ship rather than block all the
> other v0.11 features; the bug was correctly tagged in release notes and
> fixed in v0.12. *That's* the case for staged rollouts: ship behind a flag,
> default-on later when proven.

> **Why was the V0 removal done in three releases and not one?**
> Bisectability. Each removal-release ships independently and can be rolled
> back independently. A single huge PR would mean every regression had to be
> bisected against the V0-deletion megapatch — far worse for ops teams.

> **What does V0's removal actually mean for users?**
> Some long-tail features (a couple of obscure samplers, V0-only models, some
> spec-decode configurations) stopped working unless someone re-implemented
> them on V1. Release notes flag this each cycle. The signal-to-noise of the
> codebase improved enormously — much of the 2026 acceleration in feature
> velocity is downstream of having one engine, not two.
