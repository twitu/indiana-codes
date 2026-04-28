---
title: "Chapter 080: vLLM IR & The Modern Era (Mar–Apr 2026)"
---
**Releases:** `v0.17.0` (Mar 7 2026) → `v0.20.0` (Apr 23 2026)
**Why:** vLLM is maturing into a *platform*. Two big bets define this era: **Model Runner V2** finally hits "production-grade" status, and **vLLM IR** lays down the substrate for the next 18 months of kernel work — a way to express ops once and lower them per-platform, replacing the long tail of hand-fused custom ops. FlashAttention 4, TurboQuant 2-bit KV, online quantization, gRPC serving, GPU-less render serving — the surface area widens dramatically.

## Timeline

| Date | Release | What happened |
|---|---|---|
| 2026-03-07 | `v0.17.0` | **PyTorch 2.10**. **FlashAttention 4 backend** (#32974). **Model Runner V2 maturation**: PP (#33960), Decode Context Parallel (#34179), Eagle3 + CUDA graphs (#35029, #35040), pooling support (#35120), piecewise+mixed graph capture (#32771), DP+EP for spec decode (#35294), ModelState architecture, design docs (#35819). Qwen3.5 (GDN) (#34110). **`--performance-mode {balanced, interactivity, throughput}`** (#34936). Anthropic API: thinking blocks (#33671), `count_tokens` (#35588). Weight Offloading V2 with prefetching (#29941). Quantized LoRA (#30286). CPU multi-ISA dispatcher (#35466). |
| 2026-03-20 | `v0.18.0` | **gRPC serving** via `--grpc` (#36169). **GPU-less render serving** (`vllm launch render`, #36166). NGram spec decode on GPU + async (#29184). Smart-CPU KV offloading (#35342), FlexKV backend (#34328). **Elastic EP Milestone 2** (NIXL-EP #35627). **Ray no longer a default dependency** (#36170). |
| 2026-04-03 | `v0.19.0` | Gemma 4. **Zero-bubble async scheduling + spec decode** (#32951). MRV2: piecewise CUDA graphs for PP (#35162), MM-embeddings for spec decode (#36097), streaming inputs (#37028), EPLB support (#37488). **ViT Full CUDA Graphs** (#35963). **General CPU KV offloading** (#37160). **DBO generalization** to arbitrary models (#37926). NVIDIA B300/GB300 (SM 10.3) all-reduce fusion default. Transformers v5 broad compat. |
| 2026-04-23 | `v0.20.0` | **CUDA 13.0 default** (#39878). **PyTorch 2.11**. **FA4 default for MLA prefill** (#38819) on SM90+ (#38835). **TurboQuant 2-bit KV cache** (#38479). **Online quantization frontend** (#38138). **vLLM IR skeleton** (#33825), OOT-platform kernel imports (#38807), `gemma_rms_norm` reworked on IR (#39014). MRV2 advances. **MoE refactor series**: Unquantized → Full Oracle Flow (#36286), `SharedExperts` class (#35153), `DefaultMoERunner` split (#35326). **`RayExecutorV2`** (#36836). |

## Architecture: where the substrate goes next

```
                             ┌─────────────────────────────────────┐
                             │ Frontend: REST / OpenAI / Anthropic │
                             │ /v1/{chat,completions,messages,     │
                             │  realtime,inference,responses}      │
                             │ + gRPC                               │
                             └────────────────┬────────────────────┘
                                              │
              ┌───────────────────────────────▼──────────────────┐
              │ API Server proc(s)  (1 per DP rank, autoscaled)  │
              └────────────────────────────┬─────────────────────┘
                                           │ ZMQ
              ┌────────────────────────────▼─────────────────────┐
              │ Engine Core proc                                 │
              │  Scheduler (async + zero-bubble)                 │
              │  KVCacheManager (hybrid)                         │
              │  KVConnector(s)  (NIXL/3FS/Mooncake/LMCache/PNCC)│
              └────────────────────────────┬─────────────────────┘
                                           │ ZMQ / RPC
              ┌────────────────────────────▼─────────────────────┐
              │ Worker(s)  TP × PP                               │
              │  ModelRunner V2 (mostly default for new features)│
              │   - ModelState (per-shape)                       │
              │   - PluggableLayer registry                      │
              │   - Helion kernels                               │
              │   - vLLM IR (initial: rms_norm; growing)         │
              │   - Attention backends:                          │
              │     FA2 / FA3 / FA4 / FlashInfer / Triton /      │
              │     Triton-MLA / Pallas / CUDNN / FlexAttention /│
              │     AITER / xpu-kernels                          │
              │   - Quant kernels (FP8/FP4/INT8/INT4/AWQ/GPTQ/   │
              │     MXFP4/MXFP8/W4A16/W8A8/TurboQuant/…)         │
              └──────────────────────────────────────────────────┘
```

The most architecturally consequential thing here is the **bottom edge of the worker
shrinking**. Where v0.5 had ~5 hand-fused custom ops per model and v0.11 had ~50, the
direction in v0.20 is to push them *up* into the IR — declared once, lowered per
platform — and let `torch.compile` + Inductor + Helion do the codegen.

## Key decisions made in this chapter

### 1. **vLLM IR is born** (#33825)

A small first PR — just the IR skeleton plus `rms_norm`. Rework of `gemma_rms_norm`
follows (#39014). Out-of-tree kernel imports (#38807). RFCs around the IR pop up
fast: [#39370](https://github.com/vllm-project/vllm/issues/39370) on `rms_norm`
weight passing, [#40628](https://github.com/vllm-project/vllm/issues/40628) on
batch-invariance dispatching in IR.

The bet is large and explicit: **vLLM has accumulated too many hand-fused custom
ops, each tuned per-platform and per-shape, each maintenance burden compounding**.
The IR layer expresses ops at a level where the lowering can choose between Triton,
CUTLASS, FlashInfer, AITER, xpu-kernels, etc. for the same op — without each model
file having to know about all of them.

This is the v0.20 equivalent of "V1 alpha in v0.7" — a small first-cut you can read
the bones of, with the team already RFC'ing the next two years of work on top.

### 2. **Model Runner V2 graduates** (v0.17 → v0.19)

After being experimental in Chapter 070, MRV2 picks up everything in v0.17–v0.19:
PP, Decode Context Parallel, Eagle3 with CUDA graphs, pooling, piecewise+mixed CUDA
graph capture, DP+EP for spec decode, MM embeddings for spec decode, streaming
inputs, EPLB. The new **ModelState** architecture is what holds per-shape state in
a clean way; design docs land in #35819. By v0.20 the MRV2-specific advances are
the big-ticket items in the release notes — and in v0.20 it's "Auto-resolve
cudagraph mode/sizes from attention backend" (#32936) which finally lets backends
own their cudagraph contract.

### 3. **FlashAttention 4 default for MLA prefill** (v0.20)

FA4 was added as a backend in v0.17 (#32974). In v0.20 FA4 becomes the **default
MLA prefill backend** (#38819) on SM90+ (#38835) with head-dim 512 + paged KV. MLA
is DeepSeek-style attention; this is the "we have invested enough in FA4 to make
it the default for the most important model family" decision. There's a knock-on
upstream sync (#38690).

### 4. **TurboQuant 2-bit KV cache** (#38479)

A new attention backend that compresses KV to 2 bits, giving ~4× capacity. This is
*architecturally* important not because 2-bit is novel, but because it *lands as
an attention backend* — proving the backend abstraction is now flexible enough to
let people ship completely new compression schemes without engine-core changes.

### 5. **MoE Refactor series** (v0.20)

A coordinated cleanup of the MoE stack:
- Unquantized migrated to "Full Oracle Flow" (#36286)
- `SharedExperts` class (#35153)
- `DefaultMoERunner` split (#35326)
- `ZeroExpertFusedMoE` in new framework (#35549)
- `compressed_tensors_moe.py` split (#38960)
- MoE DP chunking removed (#39107)

See [`docs/design/fused_moe_modular_kernel.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/fused_moe_modular_kernel.md)
and [`docs/design/moe_kernel_features.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/moe_kernel_features.md).
This is the kind of refactor that's only possible after V0 is gone and MRV2 has a
clear ownership story for layers — the "modular kernel" framing lets a model
declare what it needs and the engine selects an implementation.

### 6. **Online quantization frontend** (#38138)

Quantization can now be applied at *load* time, not just at offline-conversion time.
Combined with the consolidation of `experts_int8` into the FP8 online path (#38463),
this means one `vllm serve --quantization fp8` call gives you a quantized model
without a pre-baked checkpoint. Big UX win, and structurally significant because it
moves quantization out of "model-on-disk format" into "engine runtime config."

### 7. **Anthropic API compatibility** (v0.17, v0.19)

`/v1/messages`, thinking blocks, `count_tokens`, `tool_choice=none`. This is the
third API surface vLLM tracks (after OpenAI Chat/Completions and OpenAI Realtime).
Same playbook as Vision API and Realtime API in earlier chapters: **adopt the
spec, not invent one**.

### 8. **`RayExecutorV2`** (#36836)

A clean rewrite of the Ray executor specifically for V1's process model. Note that
v0.18 made Ray no longer a default dependency — but for the deployments that *use*
Ray (multi-node, complex topologies), V2 brings it up to the same maturity level
the MP executor has been at since v0.5.

## Q&A — seeds for an interactive review

> **Why is the IR being added now, after 3 years of "just write a Triton kernel"?**
> Three years of "just write a Triton kernel" is exactly what motivated this. The
> codebase has 30+ quantization paths × 10+ attention backends × 5+ platforms ×
> N model architectures. Cross-product of hand-fused kernels doesn't scale. The
> IR doesn't replace kernels — it gives a place for fusion logic, dispatch logic,
> and platform lowering to live once.

> **Is FlashAttention 4 strictly better than FA3?**
> On SM90+, for MLA prefill, yes — that's why it's the default there. For non-MLA,
> for older hardware, FA3 / FlashInfer / Triton-MLA still win in particular
> shapes. The attention backend abstraction is what lets the engine pick the
> right one. The 2026 RFC [#40628](https://github.com/vllm-project/vllm/issues/40628)
> argues for *batch-invariant dispatching* via the IR — meaning the choice
> stops being model-author-time and starts being request-shape-time.

> **What's the relationship between MRV2 and the IR?**
> MRV2 is the model runner — it owns input prep, ModelState, cudagraph
> selection, and dispatching to attention backends. The IR is a layer
> *underneath*: an op-level abstraction that kernels lower from. MRV2 is
> almost done; the IR is just starting. They're complementary — not
> overlapping rewrites.

> **What's the next "V1"-sized rewrite?**
> Look at the [`[Roadmap]`](https://github.com/vllm-project/vllm/issues/40902)
> and `[RFC]` issues from late April 2026 — *Rust front-end* (#40846),
> *Unified Device Capability Abstraction* (#40620), *Hybrid checkpoint ABI*
> (#40533), *Batch-invariance via IR* (#40628), *Fault-tolerant EPLB* (#40567,
> #39942). Multiple candidates. The team's pattern (RFC → in-tree alpha →
> default → cleanup, Chapters 050/060) suggests the next big thing will land
> as a `vllm/<thing>/` directory with an opt-in flag in 2026 H2 and become
> the default in 2027.

> **What should I read first if I'm joining the project at this point?**
> Read [`docs/design/arch_overview.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/arch_overview.md), then
> [`docs/design/multiprocessing.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/multiprocessing.md), then
> [`docs/design/torch_compile.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/torch_compile.md) and
> [`docs/design/attention_backends.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/attention_backends.md).
> After that, [`docs/design/hybrid_kv_cache_manager.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/hybrid_kv_cache_manager.md)
> and [`docs/design/model_runner_v2.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/model_runner_v2.md)
> are the pieces that move fastest right now.
