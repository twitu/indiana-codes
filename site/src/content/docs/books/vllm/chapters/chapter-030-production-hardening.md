---
title: "Chapter 030: Production Hardening — prefix caching, VLMs, FP8 (Apr–Aug 2024)"
---
**Releases:** `v0.4.0` (Mar 30 2024) → `v0.5.4` (mid-Aug 2024)
**Why:** vLLM stops being "the fast PagedAttention engine" and starts being the **default open-source LLM serving stack**. Three things land that change its product surface forever: automatic prefix caching becomes default-quality, vision-language models become first-class, and FP8 makes it practical to serve big models on commodity hardware.

## Timeline

| Date | Anchor | What happened |
|---|---|---|
| 2024-03-30 | `v0.4.0` | Automatic prefix caching ([#2762](https://github.com/vllm-project/vllm/pull/2762), [#3703](https://github.com/vllm-project/vllm/pull/3703)). First VLM: **LLaVA** (#3042). New models: Command+R, Qwen2-MoE, **DBRX**. **CMake-based build** for extensibility. cupy dependency replaced. |
| 2024-04 → 2024-05 | `v0.4.1`–`v0.4.3` | Chunked prefill scheduler progress (#3236, #3538). Speculative decoding lands as merged feature (#3103). Custom all-reduce re-enabled. Replaced cupy. |
| 2024-06-11 | `v0.5.0` | **FP8 weights+activations** (#5352, #5388, …). **OpenAI Vision API** (#5237, #5383, #4199). bitsandbytes / QLoRA (#4776). Multiprocessing **becomes the default backend** for single-node distributed (#5230) — Ray is no longer required. |
| 2024-07–08 | `v0.5.1`–`v0.5.5` | LLaVA-NeXT, Phi-3-vision, Idefics, Ultravox audio. FlashInfer integration begins. Tools API + streaming for Hermes/Mistral (#5649). Outlines `FSM` → `Guide` (#4109). |

## Architecture: where the real shape changes

The single-process LLMEngine of Chapter 020 starts splitting along three new seams:

1. **The KV cache gains a second life.** Prefix caching is no longer an experimental
   side-table — it is built into the `BlockSpaceManagerV2` design that lands in
   parallel. The block manager learns about *evictable* blocks (cached but not
   currently referenced) and a clean LRU policy.

2. **The model surface gains modalities.** A model is no longer just "tokens in,
   logits out." VLMs need vision encoders, image tokens, and a **multi-modal
   processor** that hangs off `LLM.generate(..., multi_modal_data=...)` and the
   OpenAI Chat Completions message format. The shape of `vllm/multimodal/` is
   established here; it will be refactored multiple times (Chapter 050: Merged
   Multi-Modal Processor; Chapter 070: Mm caching, mm scheduling).

3. **The "executor" becomes a thing.** Multiprocessing-as-default means the engine
   needs an explicit *executor* abstraction (Ray executor, MP executor, single-GPU
   executor) instead of "just call the worker on rank 0." The
   `vllm/executor/` directory — and later `RayExecutorV2` in 2026 — descends from
   this.

```
LLMEngine
├─ Scheduler
├─ BlockManagerV2      ← chunked prefill, prefix-cache LRU
├─ Executor            ← NEW abstraction (Ray | MP | single-GPU)
│   └─ Worker(s)
│       ├─ ModelRunner (now multi-modal aware)
│       ├─ Quantization (+ FP8 W8A8)
│       ├─ Spec decode runner   ← NEW
│       └─ AttentionImpl (xformers / FA2 / FlashInfer experimental)
└─ AsyncLLMEngine + OpenAI server
    ├─ Vision API (OpenAI-compatible)
    └─ Tools API
```

## Key decisions made in this chapter

### 1. Multiprocessing as the default for single-node distributed (#5230)

Until v0.5.0, you needed Ray installed even to run TP=2 on a single box. #5230 makes
**multiprocessing** the default backend; Ray becomes opt-in for multi-node. This lowers
the friction of `pip install vllm && vllm serve` enormously and is the first time the
team explicitly chose **standard library over an ecosystem dependency** for a hot path
— a pattern that recurs (e.g. ZMQ over Ray RPC for V1 in Chapter 050).

### 2. **FP8 lands at production quality**

A lot of plumbing (#5352, #5388, #5159, #5238, #5294, #5183, #5144, #5231) — the
critical insight is that FP8 isn't bolted on as a quantization method; it's plumbed
through the **kernel selection layer** (CUTLASS FP8 GEMMs, FP8 KV cache layout) and the
**block manager** (the KV cache type changes per layer, so the block sizing logic
generalises). This generalisation is the predecessor of the *hybrid KV cache manager*
in Chapter 060.

### 3. CMake build system replaces ad-hoc setup.py extensions

Landed in v0.4.0. The CMake build is what later supports per-arch builds (sm90 vs
sm120 vs sm103a), CUDA 12.x → 13.0 transitions, the AMD ROCm build, the IBM Z s390x
build, and ultimately the inclusion of DeepGEMM into the wheel via CMake (#37980 in
v0.20). If you ever wonder *why* `CMakeLists.txt` is 51 KB in 2026, this is the chapter
where it became load-bearing.

### 4. **Vision API as part of the OpenAI surface (#5237)**

The team decides to support multi-modal **through** the OpenAI Chat Completions
"image_url" content-part schema rather than inventing a vLLM-specific API. This is a
small product decision that pays huge dividends: every OpenAI-SDK client (LangChain,
LlamaIndex, Haystack, …) "just works" against vLLM for VLMs without needing a vLLM
adapter. The OpenAI Realtime API in Chapter 070 follows the same playbook.

### 5. Speculative decoding gets merged (#3103, #2336 series)

Cade Daniel's [1/9] series finally lands speculative decoding. The architectural cost
is **non-trivial**: it forces a "draft-then-verify" execution path that doesn't fit
neatly into the iteration scheduler. The compromise (a parallel draft worker with
batch expansion) is workable but ugly. V1 — and especially the 2026 *Unified Parallel
Drafting* RFC — spends a lot of energy cleaning this up.

### 6. **Chunked prefill becomes a real feature**

(#3236, #3538) — the scheduler can split a long prefill across iterations so it
doesn't starve decoding. This is the single biggest TTFT-vs-throughput-vs-fairness
trade-off knob in the engine. It interacts with prefix caching (#7753, #8120 in v0.6)
and remains a hot tuning surface in 2026.

## Q&A — seeds for an interactive review

> **Why was Ray ever the default executor in the first place?**
> History. The original Berkeley group used Ray for everything; it gave a free RPC +
> actor + lifecycle layer when the project was 1 person and the deadline was a paper.
> By v0.5 the costs (heavyweight startup, opaque failure modes, pip-install pain) had
> outgrown the benefits *for the single-node case* — but Ray is still the right
> answer for multi-node, which is why it stays as an option.

> **Why "automatic prefix caching" instead of explicit per-request cache control?**
> Two reasons. (1) Real-world workloads (system prompts, RAG contexts, agentic loops)
> have prefix overlap that the user can't easily annotate. (2) The block manager
> already had reference-counted blocks, so block-level dedup falls out almost for
> free once you hash blocks. The "automatic" framing also means the engine can
> opportunistically cache without breaking semantics. The cost is the corner-case
> debugging you see throughout 2024–2025 (sliding window + APC, sampling + APC, etc.).

> **Why did the team add VLMs *now*, not earlier?**
> Until v0.4 the only way to do VLMs in vLLM would have been to glue a vision
> encoder onto the request preprocessing in user code. The block manager + scheduler
> couldn't represent the "image tokens are pre-allocated, text tokens are generated"
> distinction cleanly. Once chunked prefill landed, the scheduler had a primitive
> for "consume these prefilled tokens at this rate" that VLMs could hook into.

> **Why FP8 over INT8?**
> Two lines: (1) H100 has native FP8 tensor cores → free perf; (2) FP8 keeps a real
> exponent so it tolerates the dynamic range of LLM activations much better than
> INT8 without per-channel calibration. INT8 still ships (W8A8 INT8 GEMMs, AWQ, ARM
> KleidiAI INT4) but FP8 becomes the *default* "we want speed and we accept tiny
> quality loss" knob.
