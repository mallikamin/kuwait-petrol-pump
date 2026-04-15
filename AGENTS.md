## Code Knowledge Graph

**IMPORTANT: This project has a knowledge graph (1,400+ nodes, 12,000+ edges).
ALWAYS query the graph BEFORE using grep/find/rg to explore the codebase.**
The graph gives you structural context (callers, dependents, test coverage)
that file scanning cannot.

### How to access the graph

**If you have MCP support** (Claude Code): use the `code-review-graph` MCP tools
(`semantic_search_nodes`, `query_graph`, `get_impact_radius`, etc.)

**If you do NOT have MCP support** (Codex, Cursor, any CLI agent): use the
standalone Python bridge script. It queries the same SQLite graph directly
with zero dependencies:

```bash
python scripts/graph-query.py <command> <args> [--limit N] [--json]
```

### Graph CLI Commands

| Command | Example | What it does |
|---------|---------|-------------|
| `search` | `python scripts/graph-query.py search backdated` | Find functions/classes/files by keyword |
| `callers` | `python scripts/graph-query.py callers getDailySalesReport` | Who calls this function? |
| `callees` | `python scripts/graph-query.py callees createBackdatedEntry` | What does this function call? |
| `tests` | `python scripts/graph-query.py tests BackdatedEntriesService` | What tests cover this? |
| `imports` | `python scripts/graph-query.py imports reports.service` | What does this file import? |
| `dependents` | `python scripts/graph-query.py dependents reports.service` | What imports this file? |
| `impact` | `python scripts/graph-query.py impact finalizeDailySummary` | Blast radius: callers + callers-of-callers + tests + files |
| `overview` | `python scripts/graph-query.py overview` | Architecture stats, node/edge counts, top files |
| `node` | `python scripts/graph-query.py node createBackdatedEntry` | Full details of a node (params, return type, line range) |
| `file` | `python scripts/graph-query.py file backdated-entries.service` | All symbols defined in a file |

Add `--json` for machine-readable output. Add `--limit N` to control result count.

### Pre-flight check

Run this first to verify the graph is healthy and not stale:
```bash
python scripts/graph-query.py health
```
If it reports EMPTY tables or wrong branch, rebuild: `code-review-graph build`

### When to use graph tools FIRST

- **Exploring code**: `search <keyword>` instead of grep
- **Understanding impact**: `impact <function>` instead of manually tracing imports
- **Finding relationships**: `callers`, `callees`, `imports`, `dependents`
- **Architecture questions**: `overview`
- **Test coverage**: `tests <function>`

Fall back to grep/find/read **only** when the graph doesn't cover what you need.

### MCP-specific tools (Claude Code only)

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes -- gives risk-scored analysis |
| `get_review_context` | Need source snippets for review -- token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks in Claude Code).
2. For other agents, run `python scripts/graph-query.py overview` to verify graph is loaded.
3. Use `search` / `callers` / `impact` before reading files.
4. Use `tests` to check coverage before making changes.

## Deployment Memory (Mandatory)

Use only the canonical deploy script:

```bash
./scripts/deploy.sh [auto|full|backend-only|frontend-only]
```

Default mode is `auto` and should be used unless there is a specific reason otherwise.

Deployment rules:
- Never perform manual production deploy steps (`ssh` deploy commands, ad-hoc `docker build`, ad-hoc `docker compose up`, ad-hoc `scp`).
- Never run deploy commands in background during production rollout.
- Respect deploy lock and commit pin checks from `scripts/deploy.sh`.
- Prefer targeted deploy modes to avoid full rebuilds:
  - `frontend-only` for web-only changes
  - `backend-only` for API/database package changes
  - `full` only when required

Docker hygiene rules:
- Safe cleanup only: `docker image prune -f` and `docker builder prune -af`.
- Never use destructive cleanup such as `docker system prune -a --volumes` in production.

