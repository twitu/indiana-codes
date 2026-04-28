---
title: "Chapter 020: Open-Source Launch & Early Ecosystem (Jul 2023 – Mar 2024)"
---
**Releases:** `v0.1.x` → `v0.3.x`
**Why:** vLLM goes from a research prototype to a community project. The team adds the model zoo, the quantization story (GPTQ/AWQ/SqueezeLLM), the first non-NVIDIA hardware target, and seeds three features — *prefix caching*, *multi-LoRA*, *speculative decoding* — that define every subsequent chapter.

## Timeline

| Date | Anchor | What happened |
|---|---|---|
| 2023-06-19 | `v0.1.0` | First public release; AsyncLLMEngine + OpenAI-compatible server land for online serving. |
| 2023-07–08 | (post-paper) | SOSP'23 paper *"Efficient Memory Management for Large Language Model Serving with PagedAttention"* accepted; project momentum spikes. |
| 2023-09-28 | `v0.2.0` | "Up to 60% improvement by optimizing de-tokenization and sampler." Initial **AWQ** support (#1032). RoPE scaling, LongChat, Mistral-7B. |
| 2023-09 | #1086 | vLLM Discord opens — first dedicated community channel. |
| 2023-10 | `v0.2.1` … `v0.2.7` | GPTQ, SqueezeLLM, AMD ROCm seedlings, Yi/Qwen/Baichuan model support, Mixtral-MoE. |
| 2024-01-31 | `v0.3.0` | Headline features: **experimental multi-LoRA**, **experimental prefix caching**, **FP8 KV cache**, optimized MoE / DeepSeek MoE, batch completion in server. CI gates PRs (#2355 — Buildkite). |
| 2024-02 → 2024-03 | `v0.3.1` … `v0.3.3` | Speculative decoding scaffolding lands incrementally (#2336 *Optimized rejection sampler* opens the [1/9] series by @cadedaniel). |

## Architecture: the shape that survives this chapter

Still a single-process Python engine, but the **plug-points** that the ecosystem will
build on for the next 18 months get drilled in:

```
LLMEngine
├─ Scheduler          (now with multi-LoRA awareness, prefix-cache hits)
├─ BlockManager       (V1 still — V2 doesn't exist yet)
│   └─ PrefixCacheManager   (experimental, opt-in)
├─ Worker(s)
│   ├─ ModelRunner    (the surface model authors implement against)
│   ├─ AttentionImpl  (xformers / FlashAttention; backend selection by hand)
│   ├─ Quantization   (AWQ / GPTQ / SqueezeLLM / FP8 KV)
│   └─ LoRAManager    (multi-LoRA serving, S-LoRA-style)
└─ AsyncLLMEngine     (busy-loop async wrapper for the OpenAI server)
```

## Key decisions made in this chapter

### 1. **Quantization is plural, not singular**

Within ~6 months of launch, vLLM adds AWQ (#1032), GPTQ, and SqueezeLLM, each with its
own kernel path. The decision *not* to pick one and force everyone onto it is what
seeds the modern `vllm/model_executor/layers/quantization/` directory and the
`QuantizationMethod` interface. By 2026 the file tree under that directory has 30+
schemes; the early multi-method habit is what made that scalable.

**Trade-off:** maintenance burden balloons forever. But the ecosystem (HuggingFace,
TheBloke, Neural Magic, Modelopt, AutoRound) gets to ship through vLLM, which makes
vLLM the default deployment target.

### 2. **Multi-LoRA as a serving feature, not an offline merge**

#1804 / #2275 land the S-LoRA-style multi-LoRA serving: a single engine instance
serves many LoRA adapters concurrently, swapping per-batch. This is one of vLLM's
biggest *product* differentiators in 2024 — neither vanilla HF nor TGI did it well —
and it's why the "LoRA expansion" line item never disappears from release notes
afterwards.

### 3. **Automatic prefix caching as opt-in (`--enable-prefix-caching`)**

Lands in v0.3 ([#2762](https://github.com/vllm-project/vllm/pull/2762),
[#3703](https://github.com/vllm-project/vllm/pull/3703), official in v0.4) as an
**opt-in flag** because the team wasn't yet sure of its correctness corner cases
(sliding window, sampling-with-cache, copy-on-write block sharing). It eventually
becomes default-on in V1 — see Chapter 050 — but the conservative roll-out here is the
template every later major feature follows: **opt-in flag → "ready for testing" →
default**.

### 4. **AMD ROCm becomes a target, not just a hope**

Through `v0.2.x` and `v0.3.x` AMD/ROCm gets first-class CI and kernels (re-implemented
`paged_attention` in HIP, AWQ dequant in Triton). This is the first hardware fan-out
event in the project; it forces an honest abstraction between "the device" and "the
attention kernel". The clean separation didn't exist yet in this chapter — but the
*pressure* to invent it did, which led directly to the
[`docs/design/attention_backends.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/attention_backends.md)
abstraction in V1.

### 5. **AsyncLLMEngine + OpenAI server**

The `vllm.entrypoints.openai.api_server` becomes the canonical serving entrypoint,
fronted by an `AsyncLLMEngine` busy loop. This shape — sync core engine, async wrapper
on top, `vllm serve` command — survives all the way through the V1 rewrite. What
*changes* in V1 is that the async wrapper is no longer in the same Python process as
the engine core (Chapter 050).

### 6. **CI as a gate (Buildkite arrives)**

[#2355](https://github.com/vllm-project/vllm/pull/2355) by Simon Mo introduces
Buildkite-based CI — the moment vLLM transitions from "it works on Woosuk's box" to
"PRs must pass tests on multiple hardware tiers before merge." The entire `.buildkite/`
directory you see in 2026 traces back to this PR.

## Q&A — seeds for an interactive review

> **Why did vLLM ship its own AWQ kernel rather than using a library?**
> AWQ originally came from a research codebase that wasn't structured for serving
> (per-layer dequantize-then-matmul, no support for the PagedAttention KV layout).
> #1032 wraps AWQ as a `QuantizationMethod` so the dequantization fuses into the
> linear-layer path used by the worker. The cost is that vLLM owns the kernel
> forever; the benefit is that AWQ "just works" with TP, multi-LoRA, prefix caching.

> **Why was multi-LoRA not just "swap weights between requests"?**
> Per-request weight swap on GPU stalls the model; you'd lose the iteration-level
> batching that's vLLM's whole point. Instead, multi-LoRA fuses adapter outputs into
> the base linear's output via a Triton/CUDA kernel that takes the per-request adapter
> ID as a parameter. So *one batch* can mix base + N adapters with no weight motion.

> **Why was prefix caching opt-in for so long?**
> Sharing blocks across requests breaks naive correctness assumptions (sampling that
> reads `seq.tokens`, KV writes that mutate a shared block, etc.). The team wanted
> production users to opt in until they'd seen the failure modes. Default-on only
> happens in V1, where the scheduler is rewritten with prefix caching as a core
> assumption.

> **Why didn't the team just upstream AWQ kernels into PyTorch / xformers?**
> Both communities had their own quantization stories at the time and weren't
> willing to take on serving-specific kernels. Owning them in vLLM let the project
> ship faster and tune for the PagedAttention layout. The cost surfaces years later
> in the **vLLM IR** push (Chapter 080), which is partly an attempt to *escape* this
> ownership burden.
