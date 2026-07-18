# Explicit Agent Workflow MVP

## Goal

Keep Mauz's cursor-first, fast answer flow as the default. Add an explicit, supervised **Work on this** flow for Hermes-backed tasks so users choose an outcome rather than an implementation mode. The MVP makes gateway readiness legible, gathers a task goal before agent execution, and removes YOLO from the normal Lens surface.

## Scope decisions

- Preserve the existing Simple/Agentic setting internally for compatibility.
- Do not add gateway process management, a task database, automatic desktop control, or new backend tools.
- A Work task reuses the existing Hermes run lifecycle, approvals, stop control, and chat persistence.
- The first agent request asks Hermes to state a concise plan, execute read-only investigation, and seek approval before mutations.
- Keep the advanced agent-mode setting available in Settings; remove its duplicate Approve/YOLO toggle from Lens.

## User journeys

1. **Fast contextual answer:** A user selects Ask/Explain/Transform and gets the current behavior with no task-planning ceremony.
2. **Intentional agent task:** A user selects Work on this, enters a desired outcome, reviews the generated request framing, and starts a Hermes run with existing approval controls.
3. **Agent unavailable:** A user sees whether the configured gateway is ready, unavailable, or does not support supervised runs before starting work.
4. **Supervised action:** During a Work task, a user sees existing activity/approval/stop controls; mutations still require gateway approval.

## Task 1: Add gateway readiness status

- **Files:** `packages/shared/src/{types.ts,schemas.ts,constants.ts}`, `apps/api/src/backend/capabilities.ts`, `apps/api/tests/backendCapabilities.test.ts`, `apps/desktop/src/{main/ipc/registerIpcHandlers.ts,preload/index.ts,renderer/src/lib/mauzClient.ts}`, associated existing IPC/shared tests.
- **Spec:** Add a validated bridge method returning one of: `simple`, `ready`, `unavailable`, or `unsupported`. `ready` is returned only when the user selected Agentic mode and the configured gateway responds with the required run capabilities. `unavailable` covers an unreachable/unrecognised gateway; `unsupported` covers a reachable gateway that lacks the full run feature set. The result includes a short user-safe message and no secrets.
- **Tests:** Add API capability-status tests for all four states and IPC/preload contract tests where the project has equivalent coverage.
- **Acceptance:** `pnpm --filter @mauzai/api test` and `pnpm --filter @mauzai/desktop test` pass.
- **Depends on:** none.

## Task 2: Add Work on this task preflight

- **Files:** `apps/desktop/src/renderer/src/{components/MauzMenu.tsx,components/TaskPanel.tsx,components/Desk* as required,state/useMauzStore.ts,lib/mauzClient.ts,styles.css}`, desktop component/unit tests.
- **Spec:** Add a menu entry that captures the same user-approved context as Ask and opens a TaskPanel. The panel asks for one outcome, displays context/scope, shows gateway readiness, and starts only when status is `ready`. Submitting uses the existing Ask bridge with a concise task prompt instructing Hermes to state a plan, perform read-only investigation first, and request approval before any mutation. Reuse existing run activity, approval, stop, answer, and error behavior; do not add a parallel agent transport.
- **Tests:** Write tests first for task navigation, unavailable/unsupported blocking, prompt framing, and submit loading/error states. Add unit tests for the task-prompt builder.
- **Acceptance:** desktop tests and typecheck pass; Work flow never submits to a non-ready gateway.
- **Depends on:** Task 1.

## Task 3: Simplify everyday agent configuration and document the workflow

- **Files:** `apps/desktop/src/renderer/src/components/{LensPanel.tsx,SettingsPanel.tsx}`, `setup.md`, relevant tests.
- **Spec:** Remove the duplicated Approve/YOLO toggle from Lens, leaving the advanced agent-mode setting in Settings. Add a concise gateway readiness/status display in Settings and explain that Work on this is the supervised tool-enabled path. Update setup documentation to explain gateway readiness and the Work flow without describing Hermes internals as a user choice.
- **Tests:** Update focused Settings/Lens tests for the new behavior and ensure existing agent approval behavior remains covered.
- **Acceptance:** desktop tests and lint pass.
- **Depends on:** Task 1.

## Integration acceptance

- `pnpm check` passes.
- `pnpm security:audit` is reported separately; existing low-severity advisories do not block the feature check.
- Manually verify: Simple fast Ask; ready Work task; unavailable gateway; an approval request; Stop; popover close.
