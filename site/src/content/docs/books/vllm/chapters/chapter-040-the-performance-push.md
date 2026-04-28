---
title: "Chapter 040: The Performance Push — 2× throughput (Sep–Dec 2024)"
---
**Releases:** `v0.6.0` (Sep 4 2024) → `v0.6.6` (Dec 2024)
**Why:** With models, modalities, and quantization in place, the bottleneck moved out of the kernels and into the **CPU side of the engine**. The v0.6 line is a deliberate, top-to-bottom CPU-overhead audit of vLLM that delivers ~2× throughput vs v0.5.3 and seeds every architectural assumption that becomes V1.

## Timeline

| Date | Anchor | What happened |
|---|---|---|
| 2024-09-04 | `v0.6.0` | Headline: **2× throughput vs v0.5.3** via multi-step scheduling, async output processor, FlashInfer FP8 KV. Multi-step scheduling: schedule N iterations once, run them, return — amortising scheduler cost over N steps. |
| 2024-09 | (#7049 *Async Output Processor* by @megha95) | Overlap detokenization + Python output construction with the *next* GPU step. **+12% throughput on its own.** |
| 2024-09 → 2024-10 | various | FlashInfer for FP8 KV (#7798, #7985), rejection sampling for spec decode (#7244). torch.compile lazy import (#7831). |
| 2024-10-22 | [#9289](https://github.com/vllm-project/vllm/pull/9289) | **`[V1] Implement vLLM V1 [1/N]`** — the first commit of the new engine lands as `vllm/v1/`. V1 is born inside v0.6.x. |
| 2024-10 → 2024-11 | many | Idefics3, Qwen2-Audio, Pixtral (HF format), bge embeddings, RoBERTa, Llama embeddings — vLLM picks up the **embeddings/pooling task**. |
| 2024-11-15 | `v0.6.4` | "Significant progress in V1" *as a release note bullet* — the team is doing the V1 rewrite **in tree** while v0.6 ships. **Stateless process group** (#10072, #10216) for RLHF and disaggregated prefill — the seed of KV connectors. |
| 2024-11 | (#9302) | **Move parallel sampling out from vllm core, paving way for V1 engine** — explicit V1-prep refactor. |
| 2024-12 | `v0.6.5`–`v0.6.6` | DeepSeek-V3 support; **Apple Silicon native** (#11696); **FlashAttention 3** (#12093). |

## Architecture: the hidden break

On the surface v0.6 still looks like the v0.5 engine. Underneath, a parallel
construction is happening:

- `vllm/` — the production V0 engine, getting all the v0.6 perf wins.
- `vllm/v1/` — the V1 rewrite, started Oct 22 2024 in #9289, hidden behind
  `VLLM_USE_V1=1`.

Most of what makes v0.6 fast is **moving Python work off the critical path**:

```
   V0.5 step:  schedule → prepare_inputs → forward → sample → detokenize → output
                          ^^^^^^^^^^^^^^^^^^         ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                          (CPU stalls here)          (CPU stalls here too)

   V0.6 step:  schedule N steps                 ┐
               step1.forward + step1.sample     │  GPU
               ...                               │
               stepN.forward + stepN.sample     ┘
               ──── async output processor ──── ←  CPU runs in parallel,
                                                    feeding step N+1 inputs
```

This is the model that V1 then turns into "the workers are stateful, the driver only
sends diffs, scheduling is async by default" (Chapter 050).

## Key decisions made in this chapter

### 1. Multi-step scheduling (#7789, #7652)

Schedule once, run N forward passes, return. The scheduler's per-iteration cost stops
dominating at small batch sizes / fast GPUs. **Trade-off:** preemption / abort
granularity becomes N steps instead of 1, and combining with chunked prefill is
non-trivial (release notes flag known issues at #7528). Multi-step is later subsumed
by V1's *async scheduling* — see RFC [#20727](https://github.com/vllm-project/vllm/issues/20727).

### 2. **Async output processor (#7049)** — the hidden hero

While the GPU is computing iteration N+1, the CPU detokenizes iteration N's output and
constructs the user-facing `RequestOutput` objects. This single change was worth
+12%, because Python output construction was that expensive. It is the empirical
evidence that **everything CPU-bound on the critical path will eventually be moved off
it**, which becomes the V1 design thesis.

### 3. FlashInfer is admitted as a first-class attention backend

Until v0.6, FlashAttention/xformers were the two paths. FlashInfer's strengths —
FP8 KV, persistent kernels, sampling kernels — make it the right choice for new
hardware (H100/H200). The decision to plumb it in *as another backend* rather than
replacing the existing ones is what makes
[`docs/design/attention_backends.md`](https://github.com/vllm-project/vllm/blob/main/docs/design/attention_backends.md) eventually
necessary; you can see the abstraction strain in the v0.6 codebase.

### 4. **The V1 rewrite begins in-tree (#9289)**

The team chose **not** to fork. The V1 directory grows alongside the V0 codebase, with
a shared `VLLM_USE_V1` env var deciding which engine boots up. This is risky — both
codebases must compile and pass CI — but it lets the team incrementally migrate
features and lets users opt in with one env var. The v0.7.0 alpha and v0.8.0 default
flip would not have been smooth without this discipline.

### 5. Stateless process group for RLHF (#10072, #10216)

A small, easy-to-miss PR with an outsized future. By making the TP/PP process group
*stateless* (you can hand its rendezvous info to another process), vLLM becomes
embeddable inside RLHF training loops (the trainer can swap weights into a paused
engine). This is the seed of:
- `LLM.sleep` / `LLM.wake_up` / `LLM.collective_rpc` (Chapter 050)
- The KV transfer / disaggregated prefill story (Chapter 060)
- The native NCCL weight-syncing API in v0.16 (Chapter 070)

### 6. The contributor base goes from "Berkeley + friends" to "everyone"

By v0.6.4, releases note **400 commits from 132 contributors, 57 new** — release notes
this chapter consistently flag dozens of new contributors per release. Red Hat (Michael
Goin, Robert Shaw, Russell Bryant), Neural Magic (alexm-neuralmagic), AnyScale (Yard1),
NVIDIA, AMD, Intel are all upstreaming directly. The maintainer team (Simon Mo, Woosuk
Kwon, Zhuohan Li, Cyrus Leung, youkaichao, Nick Hill, …) has to learn to **review at
scale** — this is when AGENTS.md, the `[RFC]:` label workflow, and the Buildkite
gating get real.

## Q&A — seeds for an interactive review

> **Why didn't multi-step scheduling solve the CPU bottleneck completely?**
> It amortises the scheduler, but the *output processor*, *sampler pythonization*,
> and *input prep* are still per-step. Async output processor gets one of those; V1
> attacks the rest.

> **Why was V1 written as `vllm/v1/` rather than feature-flagging the existing engine?**
> The V1 RFC ([#8779](https://github.com/vllm-project/vllm/issues/8779)) is explicit
> that the goal is to *clean up tech debt* — `SequenceGroup`, beam search, ad-hoc
> spec decode, `PyObjectCache` — and feature flags wouldn't have allowed those
> removals. A parallel directory makes the tech-debt cleanup possible while keeping
> V0 stable for production.

> **Why FlashAttention 3 specifically over FA2?**
> H100 + Hopper async + FP8 + variable-length attention. FA3's "warpgroup
> async-softmax" pattern is what lets the attention kernel keep up with the rest
> of the V1 design assumptions on Hopper.

> **Why was DeepSeek-V3 the spike on the chart?**
> DeepSeek-V3 is huge (671B), MoE-heavy, and uses **MLA** (Multi-head Latent
> Attention), which has a very different KV layout from classic MHA/GQA. Supporting
> it well required FP8 GEMMs, expert-parallelism, MLA-aware kernels, and
> (eventually) chunked-prefill-with-MLA — all of which became standard features.
> See Chapter 050 for the bulk of the MLA work.
