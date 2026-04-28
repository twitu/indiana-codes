---
name: dig
description: >
  Build deep architectural understanding of a codebase by excavating its git history,
  GitHub issues/PRs/discussions, and any available documentation. Produces a chapter-based
  narrative of how the system evolved, reviewed interactively with the user through
  challenge-and-response Q&A. Use when onboarding onto a codebase, preparing for a major
  refactor, or documenting tribal knowledge.
disable-model-invocation: true
---

# Code Archaeology

You are guiding the user through a structured, interactive exploration of a codebase's
history. The goal is not just to document what happened, but to build genuine understanding
through chapter-by-chapter review and challenging Q&A.

The user is the learner. You are the guide. Your job is to extract the story from git
history (and whatever other context is available — GitHub issues/PRs, design docs, ADRs)
and present it in digestible chapters, then let the user challenge every decision until
they truly understand why things are the way they are.

## How this works

There are three phases. Do them in order.

### Phase 1: Survey (you do this, present results to user)

Scan the repository to understand its shape and scale. Start with a quick *data-source
discovery pass* before drilling into git — different projects keep their reasoning in
very different places, and on a large repo the rich seam is rarely the raw commit log.

**0. Data-source discovery — what's actually rich on this project?**

   Spend ~2 minutes finding the seams worth mining. There is **no universal convention**;
   skim each of these and note which ones turn up substantive content:

   - Releases and their notes — `gh release list --repo <O>/<R> --limit 30`. Substantive
     release notes are the chapter outline the maintainers already wrote.
   - In-tree design / decision records — `find . -type d \( -iname 'adr' -o -iname 'rfc' -o -iname 'design' -o -iname 'proposals' -o -iname 'docs' \) 2>/dev/null`.
   - Issue / PR title and label conventions — `gh label list --repo <O>/<R>` plus a skim
     of the most-recent ~50 issues. Some projects use an `[RFC]:` title prefix; some a
     `design`/`proposal`/`epic` label; some use GitHub Discussions; some keep all design
     in a wiki. **Discover the convention this project uses; do not assume one.**
   - A long-running `CHANGELOG.md`, `RELEASES.md`, or `MIGRATIONS.md`.
   - `CONTRIBUTING.md`, `AGENTS.md`, PR templates — often point to where decisions live.
   - External MCPs available in your agent (Linear, Jira, Notion, Confluence, Slack).

   The rest of the survey, and especially Phase 2's deep dive, should lean on whichever
   seams turned up. **For repos with thousands of commits, you will get most of the
   chapter narrative from release notes + design discussions; treat `git log` as anchor
   lookup, not as the spine.**

Then run these git-side passes in parallel:

1. **Commit count and date range:**
   ```
   git log --oneline | wc -l
   git log --reverse --oneline | head -1
   git log --oneline | head -1
   ```

2. **Top contributors and active periods:**
   ```
   git shortlog -sn --no-merges
   ```
   Contributor changes signal team handovers — one of the most important things to identify.

3. **Ticket / issue prefix patterns** (reveals project phases, team transitions, and which
   tracker is in use):
   ```
   git log --oneline --no-merges | sed 's/^[a-f0-9]* //' | grep -oE '(^|[^A-Za-z])([A-Z]+-[0-9]+|#[0-9]+)' | sort | uniq -c | sort -rn | head -20
   ```
   `#NNNN` references usually point to GitHub issues/PRs. `ABC-123` style references
   usually point to Jira/Linear.

4. **Commit density by month** (gaps reveal transitions, spikes reveal incidents):
   ```
   git log --format='%ai' | cut -d- -f1,2 | sort | uniq -c
   ```

5. **Infrastructure files** (migrations, Dockerfiles, CI configs, Helm charts):
   ```
   find . -path '*/migrations/*' -o -name 'Dockerfile*' -o -name '*.yml' -path '*chart*' -o -name '.github/workflows/*' -o -name '.gitlab-ci.yml' -o -name 'Jenkinsfile' 2>/dev/null | head -30
   ```

6. **Architecture-decision records and design docs** (often the gold seam):
   ```
   find . -type d \( -iname 'adr' -o -iname 'adrs' -o -iname 'rfc' -o -iname 'rfcs' -o -iname 'design' -o -iname 'docs' \) 2>/dev/null | head -10
   ```

7. **Tagged releases** (chapter boundaries are often release-shaped):
   ```
   git tag --sort=-creatordate | head -30
   ```
   For projects that publish substantive release notes, *read a few of the major-version
   ones now* — they often pre-segment history for you:
   ```
   gh release view <TAG> --repo <O>/<R>
   ```
   Tag names that don't fit the version pattern (e.g. `submission`, `demo`, `v1-frozen`)
   are themselves chapter signals — look at what they point to.

8. **High-engagement issues / PRs** (signal where the design got argued out):
   ```
   gh issue list --repo <O>/<R> --state all --sort comments --limit 20
   gh pr list    --repo <O>/<R> --state all --search "sort:comments-desc" --limit 20
   ```
   Threads with hundreds of comments or many reactions are usually the contentious
   architectural decisions, incidents, or large epics. They make excellent chapter
   anchors. Pair with whatever label / title convention you discovered in step 0
   (`--label <design-label>`, `--search "<convention>: in:title"`, etc.) to filter
   to design discussions specifically.

From this, identify **chapter boundaries** — natural phases in the project's life. Common
boundaries are: team changes (contributor shifts), ticket prefix changes, large gaps in
activity, infrastructure migrations, major releases, incidents, license changes, big rewrites.
Codename → real-name renames (visible in early commit messages or directory names) are
themselves chapter boundaries.

**Present the survey to the user as a numbered chapter list** with date ranges and one-line
descriptions. Example:

```
Chapter 1: Apr–Jun 2023   (50 commits)            — Prototype phase
Chapter 2: Jul–Oct 2023   (120 commits, v1.0)     — Production hardening
Chapter 3: Nov 2023       (5 commits, gap)        — Team transition
Chapter 4: Dec 2023–...   (300 commits, v2.0)     — Rewrite era
...
```

Save this as `PROJECT_HISTORY.md` in the repo root. This file is a reference index for
the chapter-by-chapter work that follows. Keep it concise — a timeline table and chapter
list, not a deep analysis.

Ask the user: **"Which chapter do you want to start with?"** Most people start at
Chapter 1, but some prefer to start with the most recent and work backward.

### Phase 2: Chapter deep dive (you research, then present to user)

For the chapter the user chose:

1. **Scope the commit list to a manageable size.** If the chapter has fewer than ~200
   non-merge commits, list them all:
   ```
   git log --reverse --oneline --no-merges --after="YYYY-MM-DD" --before="YYYY-MM-DD"
   ```
   If it's larger, *do not* try to read them all. Scope by one or more of:
   - The relevant releases' notes (read those first — they pre-summarise the chapter).
   - A subdirectory or file: `git log --no-merges -- <path>`
   - A keyword: `git log --grep='<term>' --no-merges`
   - A dominant author for that period: `git log --author='<name>' --no-merges`
   - High-engagement issues/PRs from Phase 1's step 8, opened in this window:
     `gh issue list --search "created:YYYY-MM-DD..YYYY-MM-DD sort:comments-desc"`
   The goal is a **shortlist of anchor commits/PRs/issues**, not full coverage. Coverage
   is what release notes are for.

2. **Read important commits in full** (not just oneline). Focus on commits that:
   - Create new files or modules
   - Add dependencies
   - Change migrations or deployment configs
   - Have long commit messages (these explain the "why")
   - Reference incidents
   ```
   git show <hash> --format="%B" --stat | head -40
   ```

3. **Follow ticket / issue links.** If commits reference issues, read them. Use whatever
   source is available, in this priority order:

   - **GitHub issues, PRs, and discussions** (the most common case for open-source repos).
     If a GitHub MCP is configured in the agent, use it. Otherwise fall back to the
     `gh` CLI:
     ```
     gh issue view <NUMBER> --repo <OWNER>/<REPO>
     gh pr view <NUMBER> --repo <OWNER>/<REPO> --comments
     gh pr list --repo <OWNER>/<REPO> --search "<keyword>" --state all
     ```
     For each PR, **read the discussion** — the actual debate often happens in review
     comments, not the description. Look for "alternatives considered", "I changed my
     mind because", and "this is a hack until X".

   - **GitHub releases** for major-version chapters:
     ```
     gh release view <TAG> --repo <OWNER>/<REPO>
     gh release list --repo <OWNER>/<REPO>
     ```
     Release notes are the team's own chapter summary — use them to validate your own.

   - **Jira / Linear / Confluence / Notion**, if the agent has the corresponding MCPs
     configured. If commits reference `ABC-123` style IDs, try the project's MCP tools.
     If none are available, note the missing context in the chapter and move on — don't
     guess.

   - **Local documentation** — look for `docs/`, `adr/`, `rfc/`, `CHANGELOG.md`,
     `MIGRATIONS.md`, `ROADMAP.md`. ADRs and RFCs are pure gold when they exist; they
     contain the alternatives-considered discussion that's invisible in code.

4. **Read architecturally significant diffs:**
   ```
   git show <hash>
   ```
   Focus on: new modules, config changes, migration files, dependency additions.

5. **Read migration files** if any exist in this period — they tell the data model story.

6. **Read deployment / infrastructure changes** — resource sizing, networking, and
   feature flags reveal operational reality invisible in application code.

**Present the chapter to the user as a narrative** covering:
- Timeline of key events (commit hash + date + what happened)
- Architecture state before and after
- Key decisions made and their apparent trade-offs
- Any incidents or rollbacks

Keep your presentation concise but thorough. The user needs enough context to ask
good questions, not a wall of text.

Then say: **"That's Chapter N. What questions do you have? Challenge anything that
doesn't make sense."**

### Phase 3: Interactive Q&A (the most valuable phase)

This is where real understanding happens. The user will challenge decisions, ask about
alternatives, and probe things they don't understand. Your job:

**When the user asks "why not the simpler thing?"** — take it seriously. Don't
reflexively justify the status quo. Evaluate the alternative honestly. If the simpler
thing would have worked, say so. If there were constraints that forced the complex
approach, explain those constraints concretely (link to the commit or PR where the
constraint became apparent).

**When the user asks about unfamiliar concepts** (K8s, Delta Lake, specific frameworks) —
explain them clearly with concrete examples from the codebase. Don't assume knowledge.
These explanations often reveal important system properties.

**When the user asks "what breaks if this is wrong?"** — think through the failure mode
concretely. This builds operational intuition that reading code alone cannot provide.

**When the user asks "was this eventually replaced?"** — check if later chapters changed
this decision. If so, the replacement validates (or invalidates) the original trade-off.

After Q&A, ask: **"Ready for the next chapter, or do you want to dig deeper into
anything here?"**

### Recording (optional, suggest to user)

After completing Q&A for a chapter, offer to record findings. If the user wants this:

#### Chapter file

Create a file in a `chapters/` directory:

```
chapters/<period>-chapter-<NNN>-<summary>.md
```

- Period: `YYYY-mon` or `YYYY-mon-YYYY-mon`
- Number: three digits starting at 010, incrementing by 10 (leaves room for sub-chapters)
- Summary: kebab-case, 3–5 words

Structure:

```markdown
# Chapter NNN: <Title> (<Date Range>)

**Issue / Epic:** [#123](link)
**Why:** One sentence motivation.

## Timeline

| Date | Commit | What happened |
|------|--------|---------------|
| ... | `abc1234` | Brief description |

## Architecture change

For chapters that span a structural shift (rewrite, new abstraction, process-model
change), include an **ASCII diagram of the system shape before and after**. Boxes and
arrows are fine — the point is the shape. Diagrams are the highest-leverage content in
this kind of chapter; prose alone underdelivers.

Before:
<ASCII diagram>

After:
<ASCII diagram>

## Key decisions

### <Decision name>
Trade-offs and rationale.

## Casualties

What got removed, abandoned, deprecated, or replaced in this chapter — APIs deleted,
modules torn out, scrapped experiments, deprecation warnings introduced, env vars
retired. *What we tried and abandoned* often explains the shape of current code better
than what survived. Skip the section only if nothing notable was removed.

## Q&A

### <Question from review>
Answer with alternatives considered and constraints identified.
```

The Q&A section is the most valuable part — it captures the interactive insights that
are invisible from code alone.

#### Insights file

Maintain an `ARCHITECTURE_INSIGHTS.md` with distilled lessons per chapter. This is
the "what I wish someone had told me" document — opinionated, concise, useful for
daily work. Focus on patterns, trade-offs, and gotchas.

#### Update the index

Update `PROJECT_HISTORY.md` with any cross-chapter information that surfaced during Q&A.

## Tips for effective excavation

- **Don't read every commit.** After the survey, focus on commits that create new
  files/modules, add dependencies, change migrations, modify deployment configs, or
  have long commit messages.
- **Scale changes the rich seam.** On small repos (<~500 commits), `git log` is the
  spine. On large repos (thousands of commits, multi-year history), release notes and
  high-engagement issues/PRs carry far more signal per minute of reading; treat git log
  as anchor lookup. Spend the first few minutes finding which sources are rich on *this*
  project before committing to a survey approach.
- **High-engagement issues surface contentious decisions.** `gh issue list --sort
  comments --state all` (and the equivalent for PRs) finds the threads where the design
  got argued out — usually the real chapter anchors. Pair with whatever design-discussion
  convention you discovered (`[RFC]:` titles, a `design`/`proposal` label, GitHub
  Discussions, etc.) — it varies by project.
- **Diagram structural rewrites.** When a chapter spans a process-model shift, a new
  abstraction layer, or a major rewrite, an ASCII before/after diagram is worth more
  than a page of prose. Make it part of the chapter, not optional.
- **Merge commits are noise.** Use `--no-merges` when listing commits.
- **Gaps between chapters are informative.** A 3-month gap with 5 commits usually
  means a team transition, planning phase, or organizational change.
- **Incidents are goldmines.** Search for "INCIDENT", "hotfix", "revert", "regression",
  "rollback" in commit messages. These reveal what actually broke and what the
  system's real weaknesses are.
- **Follow the epic / parent issue, not just the ticket.** Individual issues tell you
  what was done. The epic tells you why and what the full scope was.
- **Read the spec / RFC / ADR if one exists.** This is where alternatives were
  considered and rejected — exactly the context invisible in code.
- **Read the PR review thread, not just the merged code.** Reviewers often surface
  the constraints that shaped the final design.
- **Deployment config tells a parallel story.** Helm values, resource limits, replica
  counts, and feature flags reveal operational reality that code alone doesn't show.
- **Release notes are a cheat sheet.** If the project has GitHub releases, the
  maintainer has already chunked the history for you.

## Adapting to different projects

| Situation | Adjustment |
|-----------|-----------|
| Monorepo | Use `git log -- <path>` to scope commits per service |
| No issue tracker | Rely on commit messages, PRs, and `CHANGELOG.md`. Look for TODO/FIXME/HACK |
| Short history (<100 commits) | Skip the survey, read every commit message |
| Many contributors | Use `git log --author=<name>` to trace individual contributions |
| Poor commit messages | Fall back to `git diff` analysis. Focus on file creation dates and config changes |
| Infrastructure-heavy | Weight deployment/infra changes equally with application code |
| Fork of another project | Run the survey on the original first to understand the inherited baseline, then on the fork to find where it diverged |
