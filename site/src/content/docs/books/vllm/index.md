---
title: "vLLM — Project History"
description: "How vLLM grew from Woosuk Kwon's solo PagedAttention prototype into the dominant open-source LLM inference engine."
---
> A chapter-based excavation of how vLLM grew from Woosuk Kwon's solo PagedAttention
> prototype (codename **CacheFlow**) into the dominant open-source LLM inference engine.
>
> Generated with the [excavate](https://github.com/twitu/indiana-codes) skill on 2026-04-27, against the repo at
> commit `32e45636e` (just after `v0.20.0` was tagged).

## Repo at a glance

| | |
|---|---|
| First commit | `e7d9d9c08` — *Initial commit*, **2023-02-09** by Woosuk Kwon |
| Latest commit (tip) | `32e45636e` — *[torch.compile]: Disable Sequence Parallelism* (#38373), **2026-04**, on the `v0.20.x` line |
| Total non-merge commits | **~16,100** in ~3 years 2 months |
| Tagged releases | `v0.1.0` (Jun 2023) → `v0.20.0` (Apr 2026), plus a pre-paper `submission` tag (Apr 2023) |
| Issue tracker | GitHub issues + the `[RFC]:` label as the canonical design-doc surface |

**Top contributors (commits):** Cyrus Leung 892, Woosuk Kwon 775, Michael Goin 509, youkaichao 472, Harry Mellor 470, Isotr0py 396, Nick Hill 351, Wentao Ye 276, Jee Jee Li 264, Roger Wang 217, Lucas Wilkinson 197, Simon Mo 188, Russell Bryant 177, Robert Shaw 176.

**Activity curve:**

- \<100 commits/month through 2023.
- Ramps through 2024 (~200–400/mo).
- Steady **800–1000+ commits/month from mid-2025 onward**.

**Authoritative design docs:** [`docs/design/`](docs/design/) — `arch_overview.md`, `paged_attention.md`, `torch_compile.md`, `attention_backends.md`, `prefix_caching.md`, `hybrid_kv_cache_manager.md`, `model_runner_v2.md`, `multiprocessing.md`, `metrics.md`, `dbo.md`, `fused_moe_modular_kernel.md`, `p2p_nccl_connector.md`, `mm_processing.md`, `optimization_levels.md`, `cuda_graphs.md`, `cuda_graphs_multimodal.md`, `fusions.md`, `plugin_system.md`, …

## How to read this book

Each chapter is a self-contained markdown file under [`chapters/`](chapters/). Read them
in order, or jump to the era you care about. Chapters share a common shape:

- **Why** — one sentence motivation for the chapter.
- **Timeline** — anchor commits/PRs/issues with dates.
- **Architecture before & after** — what shape was the system in at the start of the
  chapter, what shape was it in at the end.
- **Key decisions** — the trade-offs that defined the chapter, with the commit/PR/issue
  link that committed the team to them.
- **Q&A** — *seed* questions worth challenging (the interactive part of an excavation).

For deeply-distilled "what I wish someone had told me" notes, see
[Architecture Insights](./insights/).

## Chapter map

| # | Period | Releases | Title |
|---|---|---|---|
| **010** | 2023-02 → 2023-06 | `submission` → `v0.1.0` | [The PagedAttention prototype](chapters/chapter-010-pagedattention-prototype.md) |
| **020** | 2023-07 → 2024-03 | `v0.1.x` → `v0.3.x` | [Open-source launch & early ecosystem](chapters/chapter-020-launch-and-ecosystem.md) |
| **030** | 2024-04 → 2024-08 | `v0.4.x` → `v0.5.x` | [Production hardening: prefix caching, VLMs, FP8](chapters/chapter-030-production-hardening.md) |
| **040** | 2024-09 → 2024-12 | `v0.6.x` | [The performance push (2× throughput)](chapters/chapter-040-the-performance-push.md) |
| **050** | 2024-12 → 2025-03 | `v0.7.0` → `v0.8.0` | [V1 engine — the rewrite](chapters/chapter-050-v1-engine-rewrite.md) |
| **060** | 2025-04 → 2025-10 | `v0.9.0` → `v0.11.0` | [V0 sunset & distributed serving era](chapters/chapter-060-v0-sunset-distributed-serving.md) |
| **070** | 2025-11 → 2026-02 | `v0.12.0` → `v0.16.0` | [Multimodal maturity & MoE refactor](chapters/chapter-070-multimodal-and-moe-refactor.md) |
| **080** | 2026-03 → 2026-04 | `v0.17.0` → `v0.20.0` | [vLLM IR & the modern era](chapters/chapter-080-vllm-ir-and-modern-era.md) |

## Cross-cutting threads worth tracking

A few themes run through every chapter — keep them in mind as you read:

1. **The KV cache problem.** Block manager → BlockManagerV2 → V1 KVCacheManager →
   hybrid KV cache manager → KV connectors → KV offloading. Every era of vLLM is, at
   some level, another iteration on "how do we manage the KV cache better."
2. **CPU is the bottleneck on fast GPUs.** This realisation is explicitly called out in
   the V1 RFC ([#8779](https://github.com/vllm-project/vllm/issues/8779)) and shapes
   nearly every architectural decision from 2025 onward (multi-process API server,
   stateful workers, async scheduling, removal of Python-side per-step bookkeeping).
3. **Hardware fan-out.** NVIDIA-only → AMD ROCm (mid-2024) → Intel CPU/XPU → TPU →
   Apple Silicon → AWS Neuron → ARM CPU → IBM Z. The `current_platform` /
   `attention_backends` / pluggable layer abstractions are all consequences of this.
4. **`torch.compile` from "experimental" to "load-bearing".** First serious integration
   is RFC [#6378](https://github.com/vllm-project/vllm/issues/6378) (mid-2024); by V1 it
   is on by default; by 2026 it is the substrate for fusion passes, kernel selection,
   and the new vLLM IR ([#33825](https://github.com/vllm-project/vllm/pull/33825)).
5. **Single process → multi-process.** The shift from in-process Python loop (V0) to a
   ZMQ-coordinated mesh of API server / engine core / workers (V1) is the single biggest
   structural break in the project and is the lens through which to read everything from
   `v0.7.0` onward — see [`docs/design/multiprocessing.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/multiprocessing.md)
   and [`docs/design/arch_overview.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/arch_overview.md).

## What to read first

- New to vLLM? Start at **Chapter 010** and read forward.
- Joining the team in 2026? **Chapters 050, 060, and 080** explain ~80% of the code you
  will touch on day one.
- Trying to land a kernel / backend? **Chapter 040** (FlashInfer / async output) and
  **Chapter 080** (vLLM IR, attention backend abstraction).
- Debugging a serving deployment? **Chapter 060** (KV connectors, NIXL, disaggregation)
  is the load-bearing one.
