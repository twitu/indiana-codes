---
title: "vLLM — Architecture Insights"
description: "The what-I-wish-someone-had-told-me companion to the project history."
---
> The "what I wish someone had told me" companion to [Project History](./).
> Distilled lessons across all 8 chapters — opinionated, concise, useful for daily work.

## Big-picture lessons

### 1. The KV cache *is* the system

Almost every meaningful architectural change in vLLM's history is, deep down, an
iteration on the KV cache:

- **Block-paging** was the original PagedAttention insight (Chapter 010).
- **Prefix caching** (Chapter 030) turned the cache into a deduplication layer.
- **BlockManagerV2 → V1 KVCacheManager** (Chapters 040, 050) made caching the
  scheduler's first-class abstraction, not a side-table.
- **FP8 KV → 2-bit TurboQuant KV → MLA latents → Mamba state** (Chapters 030, 050,
  060, 080) turned "the cache is contiguous KV blocks" into "the cache is a
  per-layer typed pool".
- **KVConnectors + NIXL + LMCache + 3FS** (Chapter 060) turned the cache into a
  **network protocol** between engines.
- **Hybrid KV cache manager** (Chapter 060) lets one engine serve hybrid
  Mamba/Attention models with mixed cache types.

If you change anything in the KV path, the rest of the system can be analysed in
terms of *how it interacts with the cache*. Read
[`docs/design/prefix_caching.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/prefix_caching.md) and
[`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md)
before any nontrivial cache-touching work.

### 2. CPU is the bottleneck on fast GPUs

The V1 RFC ([#8779](https://github.com/vllm-project/vllm/issues/8779)) made this
explicit: H100/H200/B200 are so fast that Python on the critical path becomes the
dominant cost. The architectural responses:

- **Async output processor** (Chapter 040, +12% by itself).
- **Stateful workers + diff-based input broadcasting** (Chapter 050, V1).
- **Multi-process API server / engine core / workers** with ZMQ (Chapter 050).
- **Async scheduling** (Chapter 060 flag, Chapter 070 default).
- **Zero-bubble async + spec decode** (Chapter 080).

Every time you write Python that runs per-step, ask: *can this run on the previous
or next iteration's CPU window?* If yes, that's almost always worth the
complexity.

### 3. Hardware fan-out drove every clean abstraction

Almost every long-lived abstraction in vLLM was forced by adding a new platform:

| Abstraction | Forced by |
|---|---|
| `AttentionBackend` interface (`docs/design/attention_backends.md`) | Multiple kernels (xformers, FA1/2/3/4, FlashInfer, AITER, Triton, Pallas, CUDNN). |
| `Executor` interface | Ray vs MP vs single-GPU; later RayExecutorV2 for V1. |
| `current_platform` ([RFC #39871](https://github.com/vllm-project/vllm/issues/39871)) | Hardcoded `"cuda"` strings everywhere. |
| `PluggableLayer` registry | XPU rebuild, AMD AITER, IBM Z. |
| `KVConnectorBase_V1` | NIXL vs Mooncake vs LMCache vs 3FS vs P2P-NCCL. |
| Helion + vLLM IR (Chapters 070, 080) | "Too many hand-fused kernels" — explicit. |

When you find yourself reaching for a `if hardware == X` branch, look for the
existing abstraction first; if there isn't one, *that's the design problem* — not
the workaround you're tempted to write.

### 4. **Ship behind a flag → default → remove the flag**

This pattern is everywhere:

- Prefix caching: opt-in `--enable-prefix-caching` (v0.3) → default in V1 (v0.7) →
  `xxhash` option in v0.13.
- V1 engine: `VLLM_USE_V1=1` (v0.7) → default (v0.8) → V0 fully removed (v0.11).
- Async scheduling: flag in v0.10 → default in v0.14 → zero-bubble in v0.19.
- `torch.compile`: experimental in v0.6 → default-on in V1 (v0.7).
- CUDA graph mode: PIECEWISE → FULL_AND_PIECEWISE default (v0.11).

If you're shipping a feature with non-trivial risk, add an env var or CLI flag
**before** you remove the old path. The team will thank you when you need to
bisect a regression.

### 5. **Adopt the spec; don't invent one**

OpenAI Chat Completions (Chapter 020), OpenAI Vision (Chapter 030), OpenAI Tools
(Chapter 030), OpenAI Realtime (Chapter 070), Anthropic Messages (Chapter 080),
gRPC standard health (#38016). vLLM has never invented a wire format when an
existing one will do. The payoff is that every client SDK in the world "just
works" — and this is a deliberate strategic choice, not a default.

## Operational gotchas

### 1. CPU sizing matters more than you think

V1's process architecture means:
- 1 API server process per DP rank (auto-scaled).
- 1 engine core process per DP rank.
- TP × PP worker processes per engine core.

Each API server uses `VLLM_MEDIA_LOADING_THREAD_COUNT` (default 8) for media. If
you're serving multimodal at high QPS on a 16-core machine, you'll see CPU
contention long before GPU saturation. See
[`docs/design/arch_overview.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/arch_overview.md) §"V1 Process
Architecture" before sizing nodes.

### 2. Async scheduling has known sharp edges

It's *default* since v0.14, but:
- Some configs (CPU backend, some PP setups, non-MTP/Eagle spec decoding) opt out
  automatically.
- v0.10.2 / v0.11.0 had a correctness bug under preemption — fixed in v0.12 but
  worth knowing if you're pinned.
- If you see "gibberish under preemption" symptoms, try `--no-async-scheduling`
  to bisect.

### 3. CUDA graph mode interacts with **everything**

`FULL_AND_PIECEWISE` is the default since v0.11, but:
- Models that have unsupported ops (control flow, dynamic shapes) fall back to
  PIECEWISE per region.
- ViT full CUDA graph needs separate enabling for some VLMs (#38061 — Qwen3-VL,
  v0.20).
- Spec decode + CUDA graph needs piecewise for the draft path (#39773 — eagle
  draft, v0.20).
- "It started erroring after upgrade" → check the release notes for cudagraph
  changes. Read
  [`docs/design/cuda_graphs.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/cuda_graphs.md) and
  [`docs/design/optimization_levels.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/optimization_levels.md).

### 4. Ray is no longer default — install explicitly

Since v0.18 (#36170), Ray is opt-in: `pip install vllm[ray]` or `pip install
ray`. If your deployment script implicitly relied on Ray being there, it will
fail on v0.18+ with a startup error. Multi-node TP/PP is what needs Ray most;
single-node TP uses MP just fine.

### 5. KV connector choice is operational, not architectural

The connector you pick depends on your fabric and workload:

| Connector | Best for |
|---|---|
| **NIXL** | InfiniBand-class RDMA, low-latency P/D in same cluster. |
| **Mooncake** | Mooncake fabric, fabric-native shared memory. |
| **P2P NCCL** | In-rack, dense GPU mesh. See `docs/design/p2p_nccl_connector.md`. |
| **LMCache** | Repeated prompt prefixes (RAG, agents) — semantic prefix dedup across users. |
| **3FS** | Long-tail / archive-class warm caches on storage. |
| **CPU offload (built-in)** | Single-engine memory pressure relief; pluggable cache policy since v0.19. |

You can run multiple connectors at once — see #17564.

### 6. Quantization choice is **per workload**

Throughput-bound: prefer **FP8** (H100/H200/B200 native tensor cores).
Memory-bound: prefer **AWQ / GPTQ** (W4A16) or new **W4A4** (CUTLASS MXFP4 on
SM100).
Long-context decoding: try **TurboQuant 2-bit KV** (v0.20).
RLHF rollouts: stay close to the trainer's checkpoint format (the **online
quantization frontend** in v0.20 helps here).

The full quant matrix lives under `vllm/model_executor/layers/quantization/`. The
release notes section called "Quantization" in each major release is a fast read
for *what's new*.

## Code-base navigation

When orienting in the 2026 codebase:

| You want… | Look at… |
|---|---|
| Engine entrypoint flow | `vllm/v1/engine/core.py`, `vllm/entrypoints/openai/api_server.py`, `docs/design/arch_overview.md`. |
| Scheduler & KV manager | `vllm/v1/core/`, `vllm/v1/kv_cache_*`, `docs/design/prefix_caching.md`, `docs/design/hybrid_kv_cache_manager.md`. |
| Worker / model runner | `vllm/v1/worker/`, `docs/design/model_runner_v2.md`. |
| Attention | `vllm/v1/attention/`, `docs/design/attention_backends.md`. |
| Quantization | `vllm/model_executor/layers/quantization/`. |
| Multimodal | `vllm/multimodal/`, `docs/design/mm_processing.md`, `docs/design/cuda_graphs_multimodal.md`. |
| MoE | `vllm/model_executor/layers/fused_moe/`, `docs/design/fused_moe_modular_kernel.md`, `docs/design/moe_kernel_features.md`. |
| KV connectors | `vllm/distributed/kv_*`, `docs/design/p2p_nccl_connector.md`. |
| Compile / IR | `vllm/compilation/`, `docs/design/torch_compile.md`, `docs/design/optimization_levels.md`, `docs/design/fusions.md`. |
| Plugin system | `vllm/plugins/`, `docs/design/plugin_system.md`. |
| Metrics | `vllm/v1/metrics/`, `docs/design/metrics.md`. |

## Reading order if you're new to the team

1. **[Project History](../)** — the 30,000-foot view, this whole book.
2. **[Chapter 010](../chapters/chapter-010-pagedattention-prototype/)** — block-paging fundamentals.
3. **[Chapter 050](../chapters/chapter-050-v1-engine-rewrite/)** — V1, which is *the* engine.
4. **[`docs/design/arch_overview.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/arch_overview.md)** — current shape (V1 process model).
5. **[Chapter 060](../chapters/chapter-060-v0-sunset-distributed-serving/)** — distributed serving (NIXL, KV connectors, EP).
6. **[Chapter 080](../chapters/chapter-080-vllm-ir-and-modern-era/)** — what the team is actively reshaping (MRV2, IR).
7. **Pick a domain doc** in `docs/design/` matching the area you'll work in.

## Anti-patterns I've seen tempt people

- **"I'll write a custom CUDA kernel."** Probably no — write Triton, declare it
  via Helion if it's perf-critical, lower it through the IR if you can. Custom
  CUDA is the path of last resort in 2026.
- **"I'll add an `if VLLM_USE_X:` branch."** If you find yourself reaching for an
  env-var branch, check whether there's an existing pluggable abstraction
  (attention backend, executor, connector, layer) and add a new implementation
  instead.
- **"V0 had a feature for this."** V0 is gone. Ask whether the V1 design even
  needs the feature; often the V1 KV/scheduler model has subsumed it. If not,
  open an RFC — that's the explicit path the team takes for design changes.
- **"I'll mock the KV manager in tests."** Real-engine integration tests catch
  cache regressions that mocks always miss. The CI mix in `.buildkite/` shows
  the team's standard.
- **"This is a tiny change, no need for a PR description."** AGENTS.md
  ([`AGENTS.md`](AGENTS.md)) requires duplicate-work checks and test commands
  for AI-assisted PRs. Read it before opening anything.
