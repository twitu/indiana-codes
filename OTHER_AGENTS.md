# Code Archaeology on other agents

Claude Code, OpenCode, and Cursor get plug-and-play install (see [README](./README.md)).
For agents that don't have a skills/commands directory, you have to hand-mount the
instructions yourself. The good news: the entire skill is one markdown file.

The pattern is the same everywhere:

1. Copy the contents of [`dig/SKILL.md`](./dig/SKILL.md) into your agent's
   long-lived instruction file (`AGENTS.md`, `.aider.conf.yml`, system prompt, etc.).
2. Tell the agent "follow the dig skill" or "do an excavation pass" — the
   skill contents do the rest.

Per-agent notes below.

## Codex CLI

Codex reads `AGENTS.md` from the repo root and from `~/.codex/AGENTS.md`.

```bash
# user-scoped (every repo)
mkdir -p ~/.codex
cat dig/SKILL.md >> ~/.codex/AGENTS.md
```

Or, if you'd rather not pollute every conversation, paste it inline when you want
to dig:

```
Follow these instructions to excavate this codebase:

<paste contents of dig/SKILL.md>
```

## Aider

Aider supports a `--read` flag and a config-level `read:` list for files always loaded
into context.

```yaml
# ~/.aider.conf.yml
read:
  - ~/aider-skills/dig.md
```

Then drop the SKILL into that path:

```bash
mkdir -p ~/aider-skills
cp dig/SKILL.md ~/aider-skills/dig.md
```

Start aider and say "follow the dig skill".

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

Drop the contents into a `.rules` file at the repo root, or paste into the assistant
panel as a system message. Zed honours `.rules` automatically when its assistant runs.

## Generic / any chat-style assistant

The skill is self-contained. Paste `dig/SKILL.md` into the system prompt of
whatever assistant you're using and say "begin Phase 1." It works in raw Claude /
GPT / Gemini chat windows too — you just lose the slash-command ergonomics and have
to run `git` commands yourself when the assistant asks for output.

## A note on tool access

Code archaeology gets *much* better when the agent can call `git`, `gh`, and any
issue-tracker MCPs you have configured. Agents that can't shell out (most chat
sandboxes) will stall at Phase 1 — you'll have to be the hands-and-feet, pasting
command output back to the model. Workable, but slow. Prefer an agent with shell
access if you have the choice.
