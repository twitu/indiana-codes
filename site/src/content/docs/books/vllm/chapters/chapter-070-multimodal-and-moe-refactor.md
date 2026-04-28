---
title: "Chapter 070: Multimodal Maturity & MoE Refactor (Nov 2025 – Feb 2026)"
---
**Releases:** `v0.12.0` (Dec 3 2025) → `v0.16.0` (Feb 25 2026)
**Why:** With V0 gone, the team can finally do the *cleanups* that V1 was waiting on: a proper realtime streaming surface, a generalised multi-modal pipeline, the **Helion** kernel framework, **Model Runner V2**, and the deep MoE refactor. Async scheduling moves from "experimental flag" to default. The Intel XPU stack is rebuilt from the ground up.

## Timeline

| Date | Release | What happened |
|---|---|---|
| 2025-12-03 | `v0.12.0` | **PyTorch 2.9** (CUDA 12.9). xformers backend deprecated. EAGLE multi-step CUDA graph, DP>1 EAGLE, multimodal EAGLE (Qwen3VL #29594). +18.1% throughput from batch-invariant BMM (#29345). AMD ROCm: DeepSeek-V3.2 SparseMLA (#26670), AITER attention (#28701). |
| 2025-12-19 | `v0.13.0` | NVIDIA **Blackwell Ultra (SM103 / GB300)** with CUDA 13 (#30484). Whisper "V1 now faster than V0" (~3× over v0.12). xxHash prefix-cache option (#29163). Conditional compilation via `compile_ranges` (#24252). Mamba `selective_state_update` for spec-decode (#29488). Fused blockwise quant RMSNorm (#27883). |
| 2026-01-20 | `v0.14.0` | **Async scheduling becomes default** (#27614). gRPC server entrypoint (#30190). `--max-model-len auto` (#29431). Model inspection view (#29450). **Model Runner V2 enhancements** (UVA block tables #31965, MRoPE #32143). |
| 2026-02-04 | `v0.15.0` | Continued MRV2, MoE refactors, RealtimeAPI groundwork. |
| 2026-02-25 | `v0.16.0` | **Async scheduling + Pipeline Parallelism** (full support, +30.8% E2E throughput, #32618). **Realtime API (WebSocket)** (#33187). RLHF: **native NCCL weight syncing** (#31943), engine pause/resume with request preservation (#32351). **Unified Parallel Drafting** for spec decode (#32887). XPU rebuild: deprecate IPEX → vllm-xpu-kernels (#33379). **Helion** kernel framework (ConfigManager #32740, registry #33203). PluggableLayer applied to linear (#33152) and Mamba (#33660). **Batch invariance**: Triton attention (#33688). |

## Architecture: the engine grows two new "operating systems"

By the end of v0.16, the engine has two new compositional layers that didn't exist
in v0.11:

1. **Pluggable layers.** The model code is no longer the single source of truth for
   "what runs at this point in the model" — there's a registry that lets a kernel
   pack swap in a different `LinearLayer` implementation, a different `MambaLayer`,
   etc. Used heavily for `vllm-xpu-kernels`, AMD AITER, IBM Z.

2. **Helion + Model Runner V2.** Helion is a kernel-authoring framework with its own
   config manager and registry, designed so that kernels can be authored once and
   selected dynamically per-shape per-platform. MRV2 is a (still experimental) rewrite
   of the V1 model runner that pushes more responsibility down to attention backends
   for cudagraph mode/sizing — see
   [`docs/design/model_runner_v2.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/model_runner_v2.md).

```
   ┌────────────────────────────────────────────────────────┐
   │ Engine core (V1)                                       │
   │   - Scheduler (async, default)                         │
   │   - KVCacheManager (hybrid)                            │
   │   - KVConnector(s)                                     │
   │ ─────────────────────────────────────────────────────  │
   │ Worker(s)                                              │
   │   - ModelRunner    or    ModelRunnerV2 (experimental)  │
   │     - Pluggable layers (Linear / MoE / Mamba)          │
   │     - Helion kernels (registry + config manager)       │
   │     - Attention backend (FA2/FA3/FA4/FlashInfer/Triton/│
   │                          xformers/AITER/Pallas/Triton- │
   │                          MLA/CUDNN/FlexAttention)      │
   │     - Quant kernels (FP8/INT8/AWQ/GPTQ/MXFP4/MXFP8/…)  │
   └────────────────────────────────────────────────────────┘
```

## Key decisions made in this chapter

### 1. **Async scheduling becomes default** (#27614, v0.14.0)

The flag flips. This is the conclusion of the work that started with the V1 RFC
([#8779](https://github.com/vllm-project/vllm/issues/8779)) — the engine's scheduler
runs concurrently with the GPU step by default. Spec decode + async (#31998) and
structured outputs + async (#29821) get fixed before the flip. v0.16 then extends
async + PP to full support (+30.8% throughput, #32618).

### 2. **Realtime API (WebSocket)** for streaming audio (#33187, v0.16.0)

Built on the Voxtral realtime infrastructure. Like the OpenAI Vision API in
Chapter 030, the team chooses to expose realtime via the **OpenAI Realtime API
schema** rather than invent something vLLM-specific. This makes the OpenAI
Realtime SDK (and downstream tools that build on it) "just work."

### 3. **Helion kernel framework** (v0.16.0)

ConfigManager (#32740), kernel wrapper (#32964), registry (#33203). Helion is the
team's answer to "we have too many hand-fused Triton kernels with too many
heuristics." A Helion kernel declares its config space; the framework picks the
right config for the runtime shape, caches it, and replays. This dovetails with
the **vLLM IR** push of Chapter 080 — both are attempts to escape the "every model
needs a custom-fused kernel" trap.

### 4. **Intel XPU rebuild — deprecate IPEX, switch to `vllm-xpu-kernels`** (#33379)

Until v0.16, XPU support went through Intel Extension for PyTorch (IPEX). The
team rips this out in favour of an in-vLLM Triton-and-native kernel stack
(MoE #33659, MXFP4 MoE #33679, WNA16 #33973, scaled_mm #34117, FP8 MoE #34202).
This is a big bet — but it gives vLLM control of the XPU codegen and lets the
*pluggable layer* abstraction (above) work uniformly across NVIDIA / AMD / Intel.

### 5. **Hybrid SSM/Attention is now production-grade** (Triton implementation #21197 → v0.11 → v0.16 polish)

Mamba2 spec-decode (#29488), GDN attention layout (#33291), GDN attention on
XPU (#33657), CUDA-graph for 3D Triton attention (#28306), `selective_state_update`
on FlashInfer (#36162). What was a "supports Mamba" line item in 2024 is now a
first-class **per-layer cache type** for arbitrary hybrid models — the
[`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md)
machinery is what makes Qwen3-Next, AFMoE, NemotronH-Puzzle, OLMo-Hybrid, and
GLM-4 MoE viable.

### 6. **Multimodal becomes its own pipeline**

[`docs/design/mm_processing.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/mm_processing.md) and
[`docs/design/cuda_graphs_multimodal.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/cuda_graphs_multimodal.md)
document the new shape: a *merged multi-modal processor* with caching, multimodal
CUDA graphs (Qwen3-VL ViT full CUDA graph #38061 — though that's actually v0.20),
data-parallel for vision encoders (InternVL DP #23909, Qwen2-VL DP #25445).
"Multimodal" stops being something models work around the engine for, and
becomes something the engine schedules natively. RFCs around tool-aware grammars
(#39848) and prompt-embeds in chat (#39504) extend this.

### 7. **RLHF as a first-class supported workflow** (v0.16)

Native NCCL-based weight syncing API (#31943), layerwise weight reloading for
QeRL (#32133), engine pause/resume preserving in-flight requests (#32351). vLLM
becomes — by deliberate design — the rollout engine for the RL training stacks.
This is the maturation of the v0.6 stateless-process-group seed (Chapter 040).

### 8. **`Model Runner V2`** appears (experimental in v0.14, more in v0.16)

The model runner is rewritten — see
[`docs/design/model_runner_v2.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/model_runner_v2.md). Goal: push
cudagraph mode / cudagraph-size selection into the attention backend, simplify
the input prep path, support new features (UVA block tables, MRoPE, NaN
detection, EAGLE prefill full-CUDA-graph). MRV2 is *experimental and disabled by
default* in this chapter — it's the team being careful about another rewrite. It
becomes the focus of Chapter 080.

## Q&A — seeds for an interactive review

> **Why redo the model runner so soon after V1?**
> Because the V1 model runner inherited a few V0 assumptions about CUDA graph
> shape and attention backend interaction. As features piled up (MLA, hybrid
> caches, full CUDA graphs, MoE, MRoPE, multimodal CUDA graphs) the seams
> showed. MRV2 is the *seam-cleanup* — not a re-architecture, more a re-cut of
> the runner along boundaries that match how attention backends actually work
> in 2026.

> **Why deprecate xformers?**
> By v0.12, FlashAttention 2/3, FlashInfer, FA4 (in v0.20), and Triton-based
> backends covered every shape xformers used to. Maintaining a separate
> attention path that nobody picks meant carrying dead code through every
> refactor. Deprecation lets the team simplify the backend-selection logic.

> **Why is Ray no longer a default dependency? (v0.18)**
> Multi-process mode has been the default since v0.5 (#5230, Chapter 030). By
> 2026, MP + ZMQ covers the multi-node case too (with explicit rendezvous).
> Ray is still excellent for some deployments — it's now opt-in via
> `pip install vllm[ray]`. This shaves a lot off cold-start time and removes
> a notorious source of `pip install` issues.

> **Why does Helion exist when Triton already does this?**
> Triton autotunes a single kernel; Helion manages a *config space across
> kernels* — including selecting between a Triton kernel, a CUTLASS kernel, a
> hand-tuned kernel, etc., based on shape and platform. It's the meta-layer
> above Triton, not a replacement.

> **Why fight to make async + PP work, given the complexity (#32618)?**
> Long-context inference with PP has the worst staircase: each PP rank has to
> wait for the previous step's output to feed the next. Async lets the
> scheduler get *ahead* of all PP stages so the staircase fills with useful
> work. +30.8% throughput on a real model is enormous, and PP without it had
> become uncompetitive vs single-rank serving for long contexts.
