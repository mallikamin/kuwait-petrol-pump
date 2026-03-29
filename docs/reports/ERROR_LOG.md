# Kuwait Petrol Pump POS — Error Log

Cumulative log of errors encountered and fixed during development. Any agent (Claude, Codex, Cursor, DeepSeek) working on this project should read this file first to avoid repeating known mistakes, and append new entries when fixing errors.

---

## Format

Each entry follows:
### [DATE] — Short title
- **Error**: Exact error message or symptom
- **Context**: What was being done when it happened
- **Root Cause**: Why it happened
- **Fix**: What was changed
- **Rule**: What to do differently going forward

---

## Errors

### 2026-03-29 — Vitest 4.x Incompatibility with Vite 5
- **Error**: `Vitest requires vite@^6.0.0 but vite@5.4.21 is installed`
- **Context**: Installing Vitest for web component testing during Task 6 QuickBooks UI implementation
- **Root Cause**: Latest Vitest (v4) requires Vite 6+, but project uses Vite 5.4.21
- **Fix**: Downgraded to `vitest@^1.6.1` and `@vitest/ui@^1.6.1` which are compatible with Vite 5
- **Rule**: Always check Vitest compatibility matrix with project's Vite version before installing. Major version mismatches will fail.

### 2026-03-29 — Unused Import After API Client Refactor
- **Error**: `'handleApiError' is declared but its value is never read` in `apps/web/src/api/quickbooks.ts`
- **Context**: Simplified API client during Task 6.1 API contract corrections
- **Root Cause**: Removed error handler usage but forgot to clean up import statement
- **Fix**: Removed `handleApiError` from import statement: `import { apiClient } from './client';`
- **Rule**: Run TypeScript check (`tsc`) after removing function calls to catch orphaned imports

### 2026-03-29 — Double-Nested Property Access During Refactor
- **Error**: `Property 'controlsData' does not exist on type 'QBControlsResponse'. Did you mean 'controls'?` at `ControlsPanel.tsx:132`
- **Context**: Converting component state from `QBControls` type to `QBControlsResponse` wrapper type during Task 6.1 corrections
- **Root Cause**: Accidentally wrote `controlsData.controlsData.controls.killSwitch` instead of `controlsData.controls.killSwitch` during refactor
- **Fix**: Changed line 132 from `controlsData?.controlsData.controls.killSwitch` to `controlsData?.controls.killSwitch`
- **Rule**: When changing state type, use IDE "Find All References" feature to update ALL usages systematically. Don't rely on manual search.

### 2026-03-29 — Unused Icon Import After Delete Feature Removal
- **Error**: `'Trash2' is declared but its value is never read` in `apps/web/src/components/quickbooks/MappingsPanel.tsx:8`
- **Context**: Removed delete mapping functionality because backend doesn't implement DELETE endpoint
- **Root Cause**: Removed delete button and handler code but forgot to clean up Trash2 icon import from lucide-react
- **Fix**: Removed `Trash2` from import: `import { Plus, Upload, RefreshCw } from 'lucide-react';`
- **Rule**: When removing UI features, search for associated icon/component imports and remove them. Icons are often imported but not caught by unused variable checks.

### 2026-03-29 — Test Assertion Ambiguity with Multiple Text Matches
- **Error**: `Found multiple elements with the text: /Active/i` in `ControlsPanel.test.tsx`
- **Context**: Testing kill switch badge display when enabled during Task 6.1
- **Root Cause**: Badge shows "Active" text AND warning message below contains word "active", causing `getByText(/Active/i)` to match multiple elements
- **Fix**: Changed from `getByText(/Active/i)` to `getAllByText(/Active/i)` and assert `length > 0`
- **Rule**: Use `getAllBy*` queries when multiple matches are possible, or make query more specific (e.g., by role, test ID, or exact text). Case-insensitive regex queries often match more than expected.

---

## Prevention Guidelines

### Before Starting Work
1. **Read this ERROR_LOG.md first** — avoid repeating known mistakes
2. **Check dependency compatibility** — especially Vitest/Vite, React versions
3. **Review project constraints** — see MEMORY.md for user requirements (no GitHub Actions, desktop app required, etc.)

### During Development
4. **Run TypeScript checks frequently** — catch unused imports, type errors early
5. **Use IDE refactoring tools** — for type changes, use "Find All References" not manual search
6. **Test queries carefully** — prefer specific queries over broad regex patterns
7. **Clean up after feature removal** — search for imports, types, test mocks related to deleted code

### Before Committing
8. **Run full verification** — `npm run build` + `npm run test` for affected workspaces
9. **Check git status** — ensure no unintended file changes
10. **Review error messages** — if fixed during session, add to this log

---

## Session Log

### 2026-03-29 — Task 6 + Task 6.1 (QuickBooks UI + API Contract Fixes)
- **Total Errors**: 5 (all resolved)
- **Time Lost**: ~10 minutes cumulative (mostly TypeScript build iterations)
- **Outcome**: ✅ All tests passing (13/13), 0 build errors, ready for commit
- **Files Modified**: 5 modified + 13 new files (components, tests, config)
