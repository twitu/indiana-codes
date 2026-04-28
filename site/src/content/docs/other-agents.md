---
title: Other agents
description: Per-agent recipes for Codex, Aider, Continue.dev, Zed, and raw chat assistants.
---

[Claude Code, OpenCode, and Cursor](/indiana-codes/install/) get plug-and-play install. Other agents need a one-time copy-paste because they don't have a skills directory.

The pattern is the same everywhere:

1. Copy the contents of `dig/SKILL.md` into your agent's long-lived instruction file (`AGENTS.md`, `~/.aider.conf.yml`, system prompt, etc.).
2. Tell the agent _"follow the dig skill"_ or _"do an excavation pass"_ — the skill instructions do the rest.

## Codex CLI

Codex reads `AGENTS.md` from the repo root and from `~/.codex/AGENTS.md`.

```bash
mkdir -p ~/.codex
cat ~/.local/share/indiana-codes/dig/SKILL.md >> ~/.codex/AGENTS.md
```

Or, if you'd rather not pollute every conversation, paste it inline when you want to dig:

```
Follow these instructions to excavate this codebase:

<paste contents of dig/SKILL.md>
```

## Aider

Aider supports a config-level `read:` list for files always loaded into context.

```yaml
# ~/.aider.conf.yml
read:
  - ~/.local/share/indiana-codes/dig/SKILL.md
```

Start aider and say _"follow the dig skill"_.

## Continue.dev

Add a custom slash command in `~/.continue/config.yaml`:

```yaml
customCommands:
  - name: dig
    description: Code archaeology — chapter-based history walkthrough
    prompt: |
      <paste contents of dig/SKILL.md>
```

## Zed AI

Drop the contents into a `.rules` file at the repo root, or paste into the assistant panel as a system message. Zed honours `.rules` automatically when its assistant runs.

## Generic / any chat-style assistant

The skill is self-contained. Paste `dig/SKILL.md` into the system prompt of whatever assistant you're using and say _"begin Phase 1."_ Works in raw Claude / GPT / Gemini chat windows too — you just lose the slash-command ergonomics and have to run `git` commands yourself when the assistant asks for output.

## A note on tool access

Code Archaeology gets _much_ better when the agent can call `git`, `gh`, and any issue-tracker MCPs you have configured. Agents that can't shell out (most chat sandboxes) will stall at Phase 1 — you'll have to be the hands-and-feet, pasting command output back to the model. Workable, but slow. Prefer an agent with shell access if you have the choice.
