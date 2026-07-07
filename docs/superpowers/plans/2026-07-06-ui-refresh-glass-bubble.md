# UI Refresh — Glass Tokens + Bubble Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mauz's static light-only look with a glass-morphism token system and a bubble-cluster launcher that replaces the old card-based MauzMenu.

**Architecture:** Two CSS commits (tokens+migration, then bubble-menu CSS) and one TSX commit (MauzMenu rewrite). All behavioral logic in MauzMenu.tsx is preserved verbatim — only presentation changes. styles.css gains a `:root` token layer and every panel/button class is migrated to use those tokens so dark-mode works globally without touching the other panel TSX files.

**Tech Stack:** React 18, TypeScript, Tailwind v4 (utility layer only — existing classes stay), plain CSS custom properties, lucide-react icons, no new npm dependencies.

---

## Global Constraints

- Window content area: 330×390 (`.mauz-panel` width/height — do not change layout dimensions)
- Tailwind v4 imported at top of styles.css — custom properties and plain CSS classes coexist; do not use `@layer`-wrapped Tailwind utilities inside the new keyframes/vars block
- No changes to: main-process code, IPC, any file outside `apps/desktop/src/renderer/src/styles.css` and `apps/desktop/src/renderer/src/components/MauzMenu.tsx` (except the report file)
- All tests must stay green: `pnpm --filter @mauzai/desktop test` and `pnpm --filter @mauzai/api test`
- `pnpm -r build` must succeed before committing
- Commit message format: `<type>: <description>` — no Co-Authored-By footer
- Report path: `/Users/zidane/Mauz/.claude/worktrees/hermes-backend/.superpowers/sdd/ui-refresh-a-report.md`

---

## File Map

| File                                                    | Action                        | Responsibility                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/styles.css`              | Modify                        | Add `:root` token block + dark-mode overrides; migrate ~333 hardcoded color instances to variables; add `panel-in` keyframe; add bubble-cluster CSS classes |
| `apps/desktop/src/renderer/src/components/MauzMenu.tsx` | Modify (presentation rewrite) | Replace card layout with bubble cluster; preserve all handlers/state/mauzClient calls exactly                                                               |
| `.superpowers/sdd/ui-refresh-a-report.md`               | Create                        | Post-implementation report                                                                                                                                  |

No other TSX files are touched.

---

### Task 1: Design token block in styles.css

**Files:**

- Modify: `apps/desktop/src/renderer/src/styles.css:1-19`

**Interfaces:**

- Produces: CSS custom property names consumed by Tasks 2, 3, 4, and 5

- [ ] **Step 1: Read the current `:root` block (lines 1-19)**

```
:root {
  color-scheme: light;   ← change to: light dark
  ...
  color: #171717;        ← will be replaced by var(--text-primary)
}
```

- [ ] **Step 2: Replace the `:root` block with the full token block**

Replace lines 1–19 of `apps/desktop/src/renderer/src/styles.css` with this exact text (insert after the `@import "tailwindcss";` line):

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  background: transparent;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  /* ── Surfaces ── */
  --surface-base: #fafaf8;
  --surface-panel: rgba(250, 250, 248, 0.78);
  --surface-card: rgba(255, 255, 255, 0.68);
  --surface-input: #ffffff;
  --surface-dark: #050505;
  --backdrop-filter: blur(24px) saturate(1.4);

  /* ── Borders ── */
  --border-hairline: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.12);
  --border-accent: rgba(22, 122, 107, 0.22);
  --border-danger: rgba(155, 44, 44, 0.16);
  --border-yolo: rgba(157, 94, 31, 0.18);

  /* ── Text ── */
  --text-primary: #171717;
  --text-secondary: #686f6b;
  --text-tertiary: #777d79;
  --text-accent: #174b43;
  --text-accent-mid: #167a6b;
  --text-muted: #77736b;

  /* ── Accent channels ── */
  --accent-answer: #167a6b;
  --accent-answer-text: #174b43;
  --accent-answer-bg: rgba(22, 122, 107, 0.09);
  --accent-answer-bg-strong: rgba(22, 122, 107, 0.12);
  --accent-answer-border: rgba(22, 122, 107, 0.22);

  --accent-agent: #7c5cff;
  --accent-agent-text: #3b2a8a;
  --accent-agent-bg: rgba(103, 76, 172, 0.08);
  --accent-agent-border: rgba(103, 76, 172, 0.18);

  --accent-yolo: #e8930c;
  --accent-yolo-text: #6d4b29;
  --accent-yolo-bg: rgba(157, 94, 31, 0.08);
  --accent-yolo-border: rgba(157, 94, 31, 0.18);

  /* ── Semantic ── */
  --ok: #167a6b;
  --ok-bg: rgba(22, 122, 107, 0.09);
  --danger: #8b2424;
  --danger-bg: rgba(155, 44, 44, 0.09);
  --danger-border: rgba(155, 44, 44, 0.16);

  /* ── Radii ── */
  --radius-panel: 20px;
  --radius-card: 14px;
  --radius-control: 10px;
  --radius-pill: 999px;

  /* ── Shadows ── */
  --shadow-panel: 0 24px 64px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.16);
  --shadow-float: 0 18px 48px rgba(18, 24, 29, 0.18), 0 4px 12px rgba(18, 24, 29, 0.1);
  --shadow-card: 0 18px 42px rgba(18, 24, 29, 0.15), 0 3px 10px rgba(18, 24, 29, 0.08);

  /* ── Motion ── */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 150ms;
  --dur-base: 220ms;
  --dur-slow: 320ms;

  color: var(--text-primary);
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-base: #1c1c1e;
    --surface-panel: rgba(28, 28, 30, 0.72);
    --surface-card: rgba(44, 44, 46, 0.68);
    --surface-input: rgba(44, 44, 46, 0.9);
    --surface-dark: #f0f0ee;

    --border-hairline: rgba(255, 255, 255, 0.12);
    --border-strong: rgba(255, 255, 255, 0.14);
    --border-accent: rgba(61, 219, 191, 0.28);
    --border-danger: rgba(255, 100, 100, 0.2);
    --border-yolo: rgba(255, 179, 64, 0.22);

    --text-primary: #f5f5f7;
    --text-secondary: #aeaeb2;
    --text-tertiary: #8e8e93;
    --text-accent: #3ddbbf;
    --text-accent-mid: #3ddbbf;
    --text-muted: #8e8e93;

    --accent-answer: #3ddbbf;
    --accent-answer-text: #3ddbbf;
    --accent-answer-bg: rgba(61, 219, 191, 0.1);
    --accent-answer-bg-strong: rgba(61, 219, 191, 0.14);
    --accent-answer-border: rgba(61, 219, 191, 0.28);

    --accent-agent: #9d85ff;
    --accent-agent-text: #9d85ff;
    --accent-agent-bg: rgba(157, 133, 255, 0.1);
    --accent-agent-border: rgba(157, 133, 255, 0.22);

    --accent-yolo: #ffb340;
    --accent-yolo-text: #ffb340;
    --accent-yolo-bg: rgba(255, 179, 64, 0.1);
    --accent-yolo-border: rgba(255, 179, 64, 0.22);

    --ok: #3ddbbf;
    --ok-bg: rgba(61, 219, 191, 0.1);
    --danger: #ff6b6b;
    --danger-bg: rgba(255, 107, 107, 0.1);
    --danger-border: rgba(255, 107, 107, 0.2);

    --shadow-panel: 0 24px 64px rgba(0, 0, 0, 0.56), 0 2px 8px rgba(0, 0, 0, 0.32);
    --shadow-float: 0 18px 48px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.24);
    --shadow-card: 0 18px 42px rgba(0, 0, 0, 0.36), 0 3px 10px rgba(0, 0, 0, 0.2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubble-cluster .bubble,
  .mauz-panel,
  .ask-panel,
  .lens-panel,
  .history-panel,
  .settings-panel,
  .realtime-panel {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 3: Verify the file parses (no duplicate @import)**

```bash
head -5 /Users/zidane/Mauz/.claude/worktrees/hermes-backend/apps/desktop/src/renderer/src/styles.css
```

Expected: `@import "tailwindcss";` appears exactly once on line 1.

---

### Task 2: Migrate panel and button classes to tokens

**Files:**

- Modify: `apps/desktop/src/renderer/src/styles.css` (lines ~63 onward)

**Interfaces:**

- Consumes: all `--*` variables defined in Task 1
- Produces: updated class families used by all panel TSX components without any TSX changes

This task is a mechanical find-and-replace of hardcoded color values with CSS variables. Work section by section, top to bottom.

**Color substitution map** (apply across entire file):

| Old value                                                                                                                                                                                                                                                                         | Replace with                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `#f4f5f1`                                                                                                                                                                                                                                                                         | `var(--surface-base)`                                                                                                     |
| `#ffffff` (pure white backgrounds)                                                                                                                                                                                                                                                | `var(--surface-card)`                                                                                                     |
| `rgb(255 255 255 / 72%)`, `rgb(255 255 255 / 76%)`, `rgb(255 255 255 / 74%)`, `rgb(255 255 255 / 70%)`, `rgb(255 255 255 / 97%)`                                                                                                                                                  | `var(--surface-card)`                                                                                                     |
| `rgb(248 250 249 / 96%)`                                                                                                                                                                                                                                                          | `var(--surface-card)`                                                                                                     |
| `#fbfaf6`                                                                                                                                                                                                                                                                         | `var(--surface-card)`                                                                                                     |
| `#050505`                                                                                                                                                                                                                                                                         | `var(--surface-dark)`                                                                                                     |
| `#111312` (pure-dark bg only, e.g. `.submit-button`, `.formatted-answer pre`)                                                                                                                                                                                                     | `var(--surface-dark)`                                                                                                     |
| `#171717` (color/text)                                                                                                                                                                                                                                                            | `var(--text-primary)`                                                                                                     |
| `#171717` (background, `.desktop-app color`)                                                                                                                                                                                                                                      | `var(--text-primary)`                                                                                                     |
| `#686f6b`                                                                                                                                                                                                                                                                         | `var(--text-secondary)`                                                                                                   |
| `#686f6b !important`                                                                                                                                                                                                                                                              | `var(--text-secondary) !important`                                                                                        |
| `#777d79`, `#77736b`                                                                                                                                                                                                                                                              | `var(--text-tertiary)`                                                                                                    |
| `#8a8f8b` (placeholder)                                                                                                                                                                                                                                                           | `var(--text-tertiary)`                                                                                                    |
| `#a8b6af` (code-language)                                                                                                                                                                                                                                                         | `var(--text-secondary)`                                                                                                   |
| `#167a6b`                                                                                                                                                                                                                                                                         | `var(--accent-answer)`                                                                                                    |
| `#167a6b !important`                                                                                                                                                                                                                                                              | `var(--accent-answer) !important`                                                                                         |
| `#174b43`                                                                                                                                                                                                                                                                         | `var(--accent-answer-text)`                                                                                               |
| `#174b43 !important` (never appears but guard)                                                                                                                                                                                                                                    | `var(--accent-answer-text) !important`                                                                                    |
| `rgb(22 122 107 / 7%)`, `rgb(22 122 107 / 8%)`, `rgb(22 122 107 / 9%)`                                                                                                                                                                                                            | `var(--accent-answer-bg)`                                                                                                 |
| `rgb(22 122 107 / 6%)`                                                                                                                                                                                                                                                            | `var(--accent-answer-bg)`                                                                                                 |
| `rgb(22 122 107 / 10%)`, `rgb(22 122 107 / 11%)`, `rgb(22 122 107 / 12%)`                                                                                                                                                                                                         | `var(--accent-answer-bg-strong)`                                                                                          |
| `rgb(22 122 107 / 14%)`, `rgb(22 122 107 / 15%)`, `rgb(22 122 107 / 16%)`, `rgb(22 122 107 / 18%)`, `rgb(22 122 107 / 20%)`, `rgb(22 122 107 / 22%)`, `rgb(22 122 107 / 24%)`, `rgb(22 122 107 / 26%)`, `rgb(22 122 107 / 28%)`, `rgb(22 122 107 / 36%)`, `rgb(22 122 107 / 48%)` | `var(--accent-answer-border)` (border-color uses) or `var(--accent-answer-bg)` (background uses — judge by property name) |
| `rgb(23 23 23 / 4%)`                                                                                                                                                                                                                                                              | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 6%)`                                                                                                                                                                                                                                                              | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 7%)`                                                                                                                                                                                                                                                              | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 8%)`                                                                                                                                                                                                                                                              | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 9%)`                                                                                                                                                                                                                                                              | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 10%)`                                                                                                                                                                                                                                                             | `var(--border-hairline)`                                                                                                  |
| `rgb(23 23 23 / 12%)`                                                                                                                                                                                                                                                             | `var(--border-strong)`                                                                                                    |
| `rgb(23 23 23 / 14%)`                                                                                                                                                                                                                                                             | `var(--border-strong)`                                                                                                    |
| `rgb(18 24 29 / 15%)` through `rgb(18 24 29 / 18%)` (shadow)                                                                                                                                                                                                                      | leave as-is OR use `--shadow-float` / `--shadow-card` variable for the `box-shadow` property itself                       |
| `rgb(155 44 44 / 8%)`, `rgb(155 44 44 / 9%)`                                                                                                                                                                                                                                      | `var(--danger-bg)`                                                                                                        |
| `rgb(155 44 44 / 14%)`                                                                                                                                                                                                                                                            | `var(--danger-bg)`                                                                                                        |
| `rgb(155 44 44 / 16%)`, `rgb(155 44 44 / 18%)`, `rgb(155 44 44 / 30%)`                                                                                                                                                                                                            | `var(--danger-border)`                                                                                                    |
| `#8b2424`                                                                                                                                                                                                                                                                         | `var(--danger)`                                                                                                           |
| `#8b2424`                                                                                                                                                                                                                                                                         | `var(--danger)`                                                                                                           |
| `#9b2c2c`                                                                                                                                                                                                                                                                         | `var(--danger)`                                                                                                           |
| `rgb(157 94 31 / 7%)`, `rgb(157 94 31 / 8%)`                                                                                                                                                                                                                                      | `var(--accent-yolo-bg)`                                                                                                   |
| `rgb(157 94 31 / 18%)`, `rgb(157 94 31 / 22%)`                                                                                                                                                                                                                                    | `var(--accent-yolo-border)`                                                                                               |
| `#6d4b29`                                                                                                                                                                                                                                                                         | `var(--accent-yolo-text)`                                                                                                 |
| `#5e3615`                                                                                                                                                                                                                                                                         | `var(--accent-yolo-text)`                                                                                                 |
| `#9d5e1f`                                                                                                                                                                                                                                                                         | `var(--accent-yolo)`                                                                                                      |
| `rgb(103 76 172 / 7%)`, `rgb(103 76 172 / 8%)`                                                                                                                                                                                                                                    | `var(--accent-agent-bg)`                                                                                                  |
| `rgb(103 76 172 / 15%)`, `rgb(103 76 172 / 18%)`                                                                                                                                                                                                                                  | `var(--accent-agent-border)`                                                                                              |
| `#513c88`                                                                                                                                                                                                                                                                         | `var(--accent-agent-text)`                                                                                                |
| `rgb(46 98 176 / 7%)`, `rgb(46 98 176 / 8%)`                                                                                                                                                                                                                                      | `var(--accent-agent-bg)`                                                                                                  |
| `rgb(46 98 176 / 15%)`, `rgb(46 98 176 / 18%)`                                                                                                                                                                                                                                    | `var(--accent-agent-border)`                                                                                              |
| `#284d82`                                                                                                                                                                                                                                                                         | `var(--accent-agent-text)`                                                                                                |
| `#f5f6f2` (pre text)                                                                                                                                                                                                                                                              | keep as-is (it's inside a dark surface and should remain light)                                                           |
| `#26312f`, `#1f2523`, `#111312` (text on light bg)                                                                                                                                                                                                                                | `var(--text-primary)`                                                                                                     |
| `#31544f`, `#174b43`, `#4d5f5a`, `#53615d` (teal-tint text)                                                                                                                                                                                                                       | `var(--accent-answer-text)`                                                                                               |
| `#4b5350`, `#303735`, `#424a47`, `#626a66` (mid-grey text)                                                                                                                                                                                                                        | `var(--text-secondary)`                                                                                                   |
| `#232826` (cue text)                                                                                                                                                                                                                                                              | `var(--text-primary)`                                                                                                     |

**Key class-specific changes** beyond color:

- `.mauz-panel`: add `background: var(--surface-panel); -webkit-backdrop-filter: var(--backdrop-filter); backdrop-filter: var(--backdrop-filter); border-radius: var(--radius-panel); box-shadow: var(--shadow-panel); border-color: var(--border-hairline);`
- `.ask-panel`, `.history-panel`, `.settings-panel`, `.realtime-panel`: same glass treatment with `--shadow-float`
- `.lens-panel`: glass with `--shadow-card`
- `.lens-task-panel`: glass with `--shadow-float`
- `.menu-lens-card`, `.mauz-auth-card`, `.settings-section`, `.auth-provider-card`, `.history-conversation`, `.conversation-message`, `.answer-area`, `.transcript-cue`, `.lens-memory-row`, `.history-empty`: set `background: var(--surface-card); border-color: var(--border-hairline);`
- `.submit-button`: `background: var(--surface-dark); color: var(--surface-base);` (inverted — dark bg, light text)
- `.desktop-app`: `background: var(--surface-base);`
- `.desktop-sidebar`: `background: var(--surface-card);`

- [ ] **Step 1: Apply color substitutions — desktop-app and desktop-nav classes (lines 63–165)**

Read lines 63–165. For each hardcoded color, apply the substitution map above. Example changes:

```css
/* line 70 before: */
background: #f4f5f1;
/* line 70 after:  */
background: var(--surface-base);

/* line 71 before: */
color: #171717;
/* line 71 after:  */
color: var(--text-primary);

/* line 80 before: */
background: #ffffff;
/* line 80 after:  */
background: var(--surface-card);

/* line 95 before: */
background: #050505;
/* line 95 after:  */
background: var(--surface-dark);

/* line 107 before: */
color: #171717;
/* line 107 after:  */
color: var(--text-primary);

/* line 116 before: */
color: #686f6b;
/* line 116 after:  */
color: var(--text-secondary);

/* line 150 before: */
color: #167a6b;
/* line 150 after:  */
color: var(--accent-answer);

/* line 155-156: rgb(22 122 107 / ...) */
border-color: var(--accent-answer-border);
background: var(--accent-answer-bg);

/* line 164 before: */
color: #174b43;
/* line 164 after:  */
color: var(--accent-answer-text);
```

- [ ] **Step 2: Apply substitutions — .mauz-panel, .mauz-header, .mauz-brand, .icon-button (lines 183–258)**

```css
/* .mauz-panel before: */
.mauz-panel {
  ...
  border: 1px solid rgb(23 23 23 / 12%);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgb(18 24 29 / 15%), 0 3px 10px rgb(18 24 29 / 8%);
}

/* .mauz-panel after: */
.mauz-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-panel);
}

/* .mauz-brand-logo before: */  background: #050505;
/* .mauz-brand-logo after:  */  background: var(--surface-dark);

/* .mauz-brand p before: */  color: #686f6b;
/* .mauz-brand p after:  */  color: var(--text-secondary);

/* .icon-button before: */  color: #626a66;
/* .icon-button after:  */  color: var(--text-secondary);

/* .icon-button:hover before: */  background: rgb(16 16 16 / 7%); color: #171717;
/* .icon-button:hover after:  */  background: var(--border-hairline); color: var(--text-primary);

/* .icon-button:focus-visible before: */  background: rgb(22 122 107 / 9%); color: #174b43; box-shadow: 0 0 0 2px rgb(22 122 107 / 18%);
/* .icon-button:focus-visible after:  */  background: var(--accent-answer-bg); color: var(--accent-answer-text); box-shadow: 0 0 0 2px var(--accent-answer-border);
```

- [ ] **Step 3: Apply substitutions — auth card, lens card, menu commands, mauz-actions, mauz-footer (lines 260–554)**

Key changes (apply the full map; representative examples):

```css
/* .mauz-auth-card: */
border: 1px solid var(--border-hairline);
background: var(--surface-card);

/* .mauz-auth-card[data-status="connected"]: */
border-color: var(--accent-answer-border);
background: var(--accent-answer-bg);

/* .mauz-auth-card[data-status="disconnected"]: */
border-color: var(--accent-yolo-border);
background: var(--accent-yolo-bg);

/* .menu-lens-card: */
border: 1px solid var(--border-hairline);
background: var(--surface-card);

/* .menu-command: */
border: 1px solid var(--border-hairline);
background: var(--surface-card);
color: var(--text-primary);

/* .menu-command > svg:first-child: */
color: var(--accent-answer);
/* .menu-command > svg:last-child: */
color: var(--text-tertiary);
/* .menu-command small: */
color: var(--text-secondary);

/* .menu-command:hover,.menu-command:focus-visible: */
border-color: var(--accent-answer-border);
background: var(--accent-answer-bg);

/* .mauz-auth-status: */
border: 1px solid var(--accent-answer-border);
background: var(--surface-card);
color: var(--accent-answer) !important;

/* .mauz-auth-card[data-status="missing"] .mauz-auth-status,
   .mauz-auth-card[data-status="disconnected"] .mauz-auth-status: */
border-color: var(--border-hairline);
color: var(--text-secondary) !important;

/* .menu-auth-button: */
border: 1px solid var(--accent-answer-border);
background: var(--accent-answer-bg);
color: var(--accent-answer-text);

/* .menu-auth-button.danger: */
border-color: var(--danger-border);
background: var(--danger-bg);
color: var(--danger);

/* .mauz-action svg: */
color: var(--accent-answer);
/* .mauz-action:hover,.mauz-action:focus-visible: */
border-color: var(--accent-answer-border);
background: var(--accent-answer-bg);

/* .mauz-footer: */
color: var(--text-muted);
```

- [ ] **Step 4: Apply substitutions — .ask-panel, .lens-panel, panel headers (lines 556–700)**

```css
/* .ask-panel: */
.ask-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-float);
}

/* .lens-panel: */
.lens-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-card);
}

/* .panel-title-logo: */  background: var(--surface-dark);

/* .ask-header h1, .lens-header h1: */  color: var(--text-primary);
/* .ask-header p,  .lens-header p:  */  color: var(--text-secondary);

/* .lens-object: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .lens-object-topline span: */  color: var(--accent-answer-text);
/* .lens-object h2: */            color: var(--text-primary);
/* .lens-object p: */             color: var(--accent-answer-text);
```

- [ ] **Step 5: Apply substitutions — lens body, form, answer area (lines 700–1250)**

Apply the full map. Key items:

```css
/* .lens-memory-row: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--accent-answer-text);

/* .lens-memory-row[data-empty="true"]: */
  color: var(--text-secondary);
  background: var(--border-hairline);

/* .lens-memory-row svg: */  color: var(--accent-answer);

/* .lens-memory-row button: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-secondary);

/* .lens-context-line: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .lens-actions button: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-primary);

/* .lens-action-arrow: */  color: var(--text-tertiary) !important;

/* .lens-actions button[aria-pressed="true"]: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg-strong);
  color: var(--accent-answer-text);

/* .lens-actions button:hover,.lens-actions button:focus-visible: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .lens-actions svg: */   color: var(--accent-answer);
/* .lens-actions small: */ color: var(--text-secondary);

/* .lens-form textarea, .lens-task-form textarea, .ask-form textarea: */
  border: 1px solid var(--border-strong);
  background: var(--surface-input);
  color: var(--text-primary);

/* textarea:focus: */
  border-color: var(--accent-answer-border);
  box-shadow: 0 0 0 3px var(--accent-answer-bg);

/* textarea::placeholder: */  color: var(--text-tertiary);

/* textarea:disabled: */
  color: var(--text-tertiary);
  background: var(--border-hairline);

/* .lens-footer-status: */  color: var(--text-tertiary);
/* .lens-footer-status svg: */  color: var(--accent-answer);

/* .lens-task-panel: */
.lens-task-panel {
  ...
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-float);
}

/* .lens-task-summary: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .lens-task-summary-icon: */
  border: 1px solid var(--accent-answer-border);
  background: var(--surface-card);
  color: var(--accent-answer);

/* .lens-task-eyebrow: */  color: var(--accent-answer-text);
/* .lens-task-summary h2: */ color: var(--text-primary);
/* .lens-task-summary p: */  color: var(--accent-answer-text);

/* .lens-remember-card strong: */  color: var(--accent-answer-text);
/* .lens-remember-card span: */    color: var(--accent-answer-text);
/* .lens-remember-card button: */
  border: 1px solid var(--accent-answer-border);
  background: var(--surface-card);
  color: var(--accent-answer-text);

/* .context-strip span: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .context-strip svg: */  color: var(--accent-answer);

/* .quick-prompts button: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-primary);

/* .quick-prompts button:hover,.quick-prompts button:focus-visible: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .permission-note: */
  border: 1px solid var(--accent-yolo-border);
  background: var(--accent-yolo-bg);
  color: var(--accent-yolo-text);

/* .permission-note strong: */  color: var(--accent-yolo-text);

/* .submit-button: */
  background: var(--surface-dark);
  color: var(--surface-base);

/* .answer-area: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);

/* .ask-empty: */  color: var(--text-muted);
/* .ask-error: */  color: var(--danger);

/* .saved-chat-title: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .formatted-answer: */       color: var(--text-primary);
/* .formatted-answer h2/h3/h4: */  color: var(--text-primary);
/* .formatted-answer strong: */    color: var(--text-primary);
/* .formatted-answer p code etc: */
  border: 1px solid var(--border-hairline);
  background: var(--border-hairline);
  color: var(--text-primary);
/* .formatted-answer pre: */
  background: var(--surface-dark);
  color: var(--surface-base);
/* .formatted-answer .code-language: */  color: var(--text-secondary);
```

- [ ] **Step 6: Apply substitutions — .history-panel and conversation classes (lines 1459–1688)**

```css
/* .history-panel: */
.history-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-float);
}

/* .history-header h1: */  color: var(--text-primary);
/* .history-header p: */   color: var(--text-secondary);
/* .history-date-group h2: */  color: var(--text-secondary);

/* .history-conversation: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-primary);

/* .history-conversation:hover,.history-conversation:focus-visible: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .history-conversation svg: */    color: var(--accent-answer);
/* .history-conversation strong: */ color: var(--text-primary);
/* .history-conversation small: */  color: var(--text-secondary);

/* .history-empty,.history-loading: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-secondary);

/* .history-error: */
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);

/* .conversation-message: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);

/* .conversation-message[data-role="user"]: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .conversation-message > span: */  color: var(--text-secondary);
/* .conversation-message > p: */     color: var(--text-primary);
```

- [ ] **Step 7: Apply substitutions — .settings-panel, settings classes (lines 1690–1987)**

```css
/* .settings-panel: */
.settings-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-float);
}

/* .realtime-panel: */
.realtime-panel {
  ...
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  box-shadow: var(--shadow-float);
}

/* .settings-header h1: */  color: var(--text-primary);
/* .settings-header p: */   color: var(--text-secondary);
/* .realtime-header h1: */  color: var(--text-primary);
/* .realtime-header p: */   color: var(--text-secondary);

/* .settings-section: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);

/* .settings-row: */  color: var(--text-primary);
/* .settings-row svg, .settings-label svg: */  color: var(--accent-answer);
/* .settings-row strong, .settings-label span: */  color: var(--text-primary);
/* .settings-row span: */  color: var(--text-secondary);

/* .auth-provider-card: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);

/* .auth-provider-card[data-status="active"]: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);

/* .secondary-button: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .danger-button: */
  border: 1px solid var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);

/* .realtime-status: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .realtime-status[data-state="error"]: */
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);

/* .realtime-status[data-state="stopped"],.realtime-status[data-state="muted"]: */
  border-color: var(--border-strong);
  background: var(--border-hairline);
  color: var(--text-secondary);

/* .realtime-status[data-state="user_speaking"]: */
  border-color: var(--accent-agent-border);
  background: var(--accent-agent-bg);
  color: var(--accent-agent-text);

/* .realtime-status[data-state="thinking"],.realtime-status[data-state="mauz_speaking"]: */
  border-color: var(--accent-agent-border);
  background: var(--accent-agent-bg);
  color: var(--accent-agent-text);

/* .realtime-status span: */  color: var(--text-secondary);
/* .realtime-note: */          color: var(--text-muted);

/* .transcript-stream: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);

/* .transcript-placeholder span: */  background: var(--accent-answer-border);
/* .transcript-placeholder[data-state="muted"] span etc: */  background: var(--border-strong);

/* .transcript-cue: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-primary);

/* .transcript-cue[data-role="assistant"]: */
  border-color: var(--accent-agent-border);
  background: var(--accent-agent-bg);

/* .transcript-cue[data-role="user"]: */
  border-color: var(--accent-agent-border);
  background: var(--accent-agent-bg);

/* .transcript-cue span: */  color: var(--text-secondary);
```

- [ ] **Step 8: Apply substitutions — agent-approval, agent-stop-button, agent-mode-toggle (lines 2308–2433)**

```css
/* .agent-approval: */
.agent-approval {
  ...
  border: 1px solid var(--accent-yolo-border);
  background: var(--accent-yolo-bg);
  color: var(--accent-yolo-text);
}

/* .agent-approval-description: */  color: var(--accent-yolo-text);
/* .agent-approval-description svg: */  color: var(--accent-yolo);

/* .agent-approval-actions button: */
  border: 1px solid var(--accent-answer-border);
  background: var(--accent-answer-bg);
  color: var(--accent-answer-text);

/* .agent-approval-actions button:hover,.agent-approval-actions button:focus-visible: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg-strong);

/* .agent-approval-actions button.agent-approval-deny: */
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);

/* .agent-approval-actions button.agent-approval-deny:hover/focus-visible: */
  border-color: var(--danger-border);
  background: var(--danger-bg);

/* .agent-stop-button: */
  border: 1px solid var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);

/* .agent-stop-button:hover,.agent-stop-button:focus-visible: */
  border-color: var(--danger-border);
  background: var(--danger-bg);

/* .agent-mode-toggle button: */
  border: 1px solid var(--border-hairline);
  background: var(--surface-card);
  color: var(--text-primary);

/* .agent-mode-toggle button[aria-pressed="true"]: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg-strong);
  color: var(--accent-answer-text);

/* .agent-mode-toggle button:hover,.agent-mode-toggle button:focus-visible: */
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);
```

- [ ] **Step 9: Verify no raw hex colors remain (except intentional ones)**

```bash
grep -n "#[0-9a-fA-F]\{6\}" /Users/zidane/Mauz/.claude/worktrees/hermes-backend/apps/desktop/src/renderer/src/styles.css | grep -v "^[0-9]*:.*\(var\|\/\*\|SFMono\|Liberation\|monospace\)"
```

Expected: only intentional remnants like `#f5f6f2` (pre code text on dark bg) and the `@keyframes` numeric values should remain.

```bash
grep -n "rgb(22 122\|rgb(23 23\|rgb(18 24\|rgb(157 94\|rgb(155 44\|rgb(103 76\|rgb(46 98\|rgb(16 16" /Users/zidane/Mauz/.claude/worktrees/hermes-backend/apps/desktop/src/renderer/src/styles.css
```

Expected: zero matches.

---

### Task 3: Panel entrance animation

**Files:**

- Modify: `apps/desktop/src/renderer/src/styles.css` — add keyframe + apply to panel classes

**Interfaces:**

- Consumes: `--ease-spring`, `--dur-base` from Task 1

- [ ] **Step 1: Add `@keyframes panel-in` block**

Find the existing `@keyframes transcript-rise` block (around line 1968). Insert this block immediately before it:

```css
@keyframes panel-in {
  from {
    opacity: 0;
    transform: scale(0.86) translateY(-6px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

- [ ] **Step 2: Apply entrance animation to all floating panels**

For each of `.mauz-panel`, `.ask-panel`, `.lens-panel`, `.history-panel`, `.settings-panel`, `.realtime-panel`, add:

```css
transform-origin: top left;
animation: panel-in var(--dur-base) var(--ease-spring) both;
```

Do NOT add it to `.desktop-app`, `.desktop-main`, `.desktop-sidebar` (these are the persistent desktop chrome).

---

### Task 4: Commit 1 — tokens, migration, entrance animation

**Files:**

- Modify: `apps/desktop/src/renderer/src/styles.css`

**Interfaces:**

- Produces: a clean git commit with all CSS changes from Tasks 1–3

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/desktop test 2>&1 | tail -20
```

Expected: all tests pass (no renderer component tests exist, so this tests main-process code).

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/api test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Run clean build**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm -r build 2>&1 | tail -30
```

Expected: no errors. CSS is bundled by Vite/electron-vite so any invalid CSS property syntax would surface here.

- [ ] **Step 3: Commit**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && git add apps/desktop/src/renderer/src/styles.css && git commit -m "style: add glass token system and migrate all panel/button classes"
```

---

### Task 5: Bubble-cluster CSS classes

**Files:**

- Modify: `apps/desktop/src/renderer/src/styles.css` — append new bubble-cluster classes at the end

**Interfaces:**

- Consumes: all `--*` variables from Task 1
- Produces: `.bubble-cluster`, `.bubble-cluster-backdrop`, `.bubble-hub`, `.bubble`, `.bubble-label`, `.bubble-auth-dot`, `.bubble-auth-pill`, `.bubble-status-toast` — consumed by MauzMenu.tsx in Task 6

The window content area is `330×390`. Bubbles must not clip. Hub is centered at roughly `(165, 195)`. The 8 option bubbles arc in a circle of radius 110px, starting from roughly 10 o'clock and sweeping clockwise.

- [ ] **Step 1: Add `@keyframes bubble-in` and `@keyframes bubble-pulse` at end of styles.css**

```css
@keyframes bubble-in {
  from {
    opacity: 0;
    transform: scale(0) translateX(var(--bx, 0px)) translateY(var(--by, 0px));
  }

  to {
    opacity: 1;
    transform: scale(1) translateX(var(--bx, 0px)) translateY(var(--by, 0px));
  }
}

@keyframes bubble-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--bubble-glow, rgba(22, 122, 107, 0));
  }
  50% {
    box-shadow: 0 0 0 8px var(--bubble-glow, rgba(22, 122, 107, 0));
  }
}
```

- [ ] **Step 2: Add bubble-cluster wrapper and backdrop**

```css
/* ── Bubble Launcher ── */

.bubble-cluster-root {
  position: relative;
  width: 330px;
  height: 390px;
  overflow: hidden;
}

.bubble-cluster-backdrop {
  position: absolute;
  inset: 0;
  background: transparent;
  border: 0;
  cursor: default;
  padding: 0;
  margin: 0;
}

.bubble-cluster {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.bubble-cluster > * {
  pointer-events: auto;
}
```

- [ ] **Step 3: Add hub bubble styles**

```css
.bubble-hub {
  position: absolute;
  left: calc(50% - 32px);
  top: calc(50% - 32px);
  width: 64px;
  height: 64px;
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  border: 1.5px solid var(--border-strong);
  box-shadow: var(--shadow-panel);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    box-shadow var(--dur-fast) ease;
  z-index: 10;
}

.bubble-hub:hover {
  transform: scale(1.08);
  box-shadow:
    var(--shadow-panel),
    0 0 0 4px var(--accent-answer-border);
}

.bubble-hub:focus-visible {
  outline: none;
  box-shadow:
    var(--shadow-panel),
    0 0 0 3px var(--accent-answer-border);
}

.bubble-hub-logo {
  width: 48px;
  height: 16px;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
```

- [ ] **Step 4: Add auth dot on hub**

```css
.bubble-auth-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--surface-panel);
  background: var(--ok);
  pointer-events: none;
}

.bubble-auth-dot[data-status="disconnected"] {
  background: var(--accent-yolo);
}

.bubble-auth-dot[data-status="missing"] {
  background: var(--danger);
  animation: bubble-pulse 1.4s ease-in-out infinite;
  --bubble-glow: rgba(155, 44, 44, 0.35);
}
```

- [ ] **Step 5: Add option bubble shared styles**

The 8 option bubbles are absolutely positioned relative to `.bubble-cluster` center using `calc()`. Each bubble has a CSS custom property `--delay` for stagger and `--tx`/`--ty` for its arc offset from center.

```css
.bubble {
  position: absolute;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-pill);
  background: var(--surface-card);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  border: 1px solid var(--border-hairline);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    box-shadow var(--dur-fast) ease,
    border-color var(--dur-fast) ease;
  animation: bubble-in var(--dur-base) var(--ease-spring) both;
  animation-delay: var(--delay, 0ms);
  transform-origin: center;
  outline: none;
}

.bubble:hover {
  transform: scale(1.08);
  border-color: var(--bubble-glow-color, var(--accent-answer-border));
  box-shadow:
    var(--shadow-card),
    0 0 0 4px var(--bubble-glow-color, var(--accent-answer-border));
}

.bubble:focus-visible {
  box-shadow:
    var(--shadow-card),
    0 0 0 3px var(--bubble-glow-color, var(--accent-answer-border));
}

.bubble:disabled {
  cursor: wait;
  opacity: 0.6;
}

.bubble[data-pending="true"] {
  animation: bubble-pulse 1s ease-in-out infinite;
  --bubble-glow: var(--bubble-glow-color, rgba(22, 122, 107, 0.28));
}

/* accent tints per bubble variant */
.bubble[data-accent="answer"] {
  --bubble-glow-color: var(--accent-answer-border);
  border-color: var(--accent-answer-border);
  background: var(--accent-answer-bg);
}

.bubble[data-accent="agent"] {
  --bubble-glow-color: var(--accent-agent-border);
}

.bubble[data-accent="yolo"] {
  --bubble-glow-color: var(--accent-yolo-border);
}

.bubble svg {
  color: var(--accent-answer);
}

.bubble[data-accent="agent"] svg {
  color: var(--accent-agent);
}

.bubble[data-accent="yolo"] svg {
  color: var(--accent-yolo);
}

/* settings bubble — smaller, lower emphasis */
.bubble[data-size="sm"] {
  width: 40px;
  height: 40px;
}

.bubble[data-size="sm"] svg {
  color: var(--text-secondary);
}
```

- [ ] **Step 6: Add bubble label (hover tooltip)**

```css
.bubble-label {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  border: 1px solid var(--border-hairline);
  box-shadow: var(--shadow-card);
  color: var(--text-primary);
  font-size: 10px;
  font-weight: 700;
  line-height: 22px;
  letter-spacing: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-fast) ease;
}

.bubble:hover .bubble-label,
.bubble:focus-visible .bubble-label {
  opacity: 1;
}
```

- [ ] **Step 7: Add bubble arc position utilities (8 positions)**

Radius = 110px from center. Angles (clockwise from 10 o'clock = -150°):

- Bubble 0 (Ask): -150° → tx=-95px, ty=-55px
- Bubble 1 (Explain): -90° → tx=0px, ty=-110px
- Bubble 2 (Transform): -30° → tx=95px, ty=-55px
- Bubble 3 (Remember): 30° → tx=95px, ty=55px
- Bubble 4 (Compare): 60° → tx=80px, ty=95px
- Bubble 5 (Talk): 120° → tx=-80px, ty=95px
- Bubble 6 (History): 150° → tx=-95px, ty=55px
- Bubble 7 (Settings, sm): 180° → tx=-110px, ty=0px

These are set as inline styles in TSX via `style` props, not as CSS classes, so no additional classes needed here.

- [ ] **Step 8: Add auth pill and status toast**

```css
.bubble-auth-pill {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: var(--surface-card);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  border: 1px solid var(--danger-border);
  box-shadow: var(--shadow-card);
  color: var(--danger);
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  animation: panel-in var(--dur-fast) var(--ease-spring) both;
}

.bubble-auth-pill:hover {
  background: var(--danger-bg);
  border-color: var(--danger-border);
}

.bubble-auth-pill:focus-visible {
  outline: none;
  box-shadow:
    var(--shadow-card),
    0 0 0 2px var(--danger-border);
}

.bubble-status-toast {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 290px;
  height: 26px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  -webkit-backdrop-filter: var(--backdrop-filter);
  backdrop-filter: var(--backdrop-filter);
  border: 1px solid var(--border-hairline);
  box-shadow: var(--shadow-card);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 520;
  line-height: 26px;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: panel-in var(--dur-fast) var(--ease-spring) both;
  pointer-events: none;
}
```

---

### Task 6: MauzMenu.tsx bubble-cluster rewrite

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/MauzMenu.tsx`

**Interfaces:**

- Consumes: `.bubble-cluster-root`, `.bubble-cluster-backdrop`, `.bubble-cluster`, `.bubble-hub`, `.bubble-hub-logo`, `.bubble-auth-dot`, `.bubble`, `.bubble-label`, `.bubble-auth-pill`, `.bubble-status-toast` from Task 5
- Consumes: all existing state/handlers from the current MauzMenu.tsx — do not change them
- Produces: the new MauzMenu render — a bubble cluster instead of the card layout

**Preservation rule:** The following must remain byte-for-byte identical:

- `LENS_ACTIONS` array (lines 28–64)
- `useMauzStore()` destructuring
- `loadSettings` effect (lines 86–112)
- `handleSettings`, `handleHistory`, `handleOpenAiReconnect`, `handleOpenAiDisconnect`, `handleLensAction`, `handleTalk` functions
- `getOpenAiAuthState`, `getOpenAiAuthDescription`, `getOpenAiAuthActionLabel`, `getOpenAiReconnectMessage` pure functions
- All imports

**Changes:**

- Add three new imports: `MousePointer2` and `Sparkles` are already imported; add `Wand2`, `Pin`, `GitCompareArrows`, `Mic`, `History`, `Settings`, `KeyRound` — verify which are already imported and add only what's missing
- Replace the `return (...)` JSX in `MauzMenu` with the bubble cluster
- Replace the `OpenAiAuthMenu` component's `return (...)` with a minimal glass popover
- Keep `OpenAiAuthMenu` as a function; only the render changes

- [ ] **Step 1: Verify current imports cover all needed icons**

Current imports: `ChevronRight, Check, GitCompareArrows, History, KeyRound, Lock, Mic, MousePointer2, Pin, ScanSearch, Settings, Sparkles, Wand2, X`
All needed: `MousePointer2` (Ask), `Sparkles` (Explain), `Wand2` (Transform), `Pin` (Remember), `GitCompareArrows` (Compare), `Mic` (Talk), `History`, `Settings`, `KeyRound` (auth dot tooltip), `Lock`, `Check`, `X`
Result: all icons already imported. No import changes needed.

- [ ] **Step 2: Define arc positions as a constant above the component**

Add this constant just before `export function MauzMenu()`:

```typescript
// Arc positions relative to cluster center (radius ~110px)
const BUBBLE_POSITIONS: Record<string, { tx: number; ty: number }> = {
  ask: { tx: -95, ty: -55 },
  explain: { tx: 0, ty: -110 },
  transform: { tx: 95, ty: -55 },
  remember: { tx: 95, ty: 55 },
  compare: { tx: 80, ty: 95 },
  talk: { tx: -80, ty: 95 },
  history: { tx: -95, ty: 55 },
  settings: { tx: -110, ty: 0 }
};

const BUBBLE_STAGGER_MS = 30;
const BUBBLE_ORDER = [
  "ask",
  "explain",
  "transform",
  "remember",
  "compare",
  "talk",
  "history",
  "settings"
] as const;
```

- [ ] **Step 3: Replace the `MauzMenu` return JSX**

Replace only the `return (...)` block (lines 229–319). Keep all handlers above it intact.

```tsx
const authState = getOpenAiAuthState(settings);

return (
  <div className="bubble-cluster-root" aria-label="Mauz menu">
    <h1 className="sr-only">MauzAI</h1>

    {/* Invisible backdrop: clicking outside bubbles dismisses */}
    <button
      type="button"
      className="bubble-cluster-backdrop"
      aria-label="Close Mauz"
      onClick={() => void mauzClient.close()}
      tabIndex={-1}
    />

    <div className="bubble-cluster">
      {/* Hub bubble — click goes to Ask */}
      <button
        type="button"
        className="bubble-hub"
        aria-label="Open Mauz Ask"
        onClick={() => void handleLensAction("ask")}
        disabled={pendingAction !== null}
      >
        <BrandLogo className="bubble-hub-logo" label="MauzAI" />
        <span className="bubble-auth-dot" data-status={authState} aria-hidden="true" />
      </button>

      {/* Option bubbles */}
      {LENS_ACTIONS.map((item, i) => {
        const Icon = item.icon;
        const pos = BUBBLE_POSITIONS[item.action];
        return (
          <button
            key={item.action}
            type="button"
            className="bubble"
            data-accent="answer"
            data-pending={pendingAction === item.action ? "true" : undefined}
            aria-label={item.label}
            disabled={pendingAction !== null}
            onClick={() => void handleLensAction(item.action)}
            style={{
              left: `calc(50% - 26px + ${pos.tx}px)`,
              top: `calc(50% - 26px + ${pos.ty}px)`,
              ["--delay" as string]: `${i * BUBBLE_STAGGER_MS}ms`
            }}
          >
            <Icon aria-hidden="true" size={18} />
            <span className="bubble-label" aria-hidden="true">
              {pendingAction === item.action ? "…" : item.label}
            </span>
          </button>
        );
      })}

      {/* Talk bubble */}
      <button
        type="button"
        className="bubble"
        data-pending={pendingAction === "talk" ? "true" : undefined}
        aria-label="Talk to Mauz"
        disabled={pendingAction !== null}
        onClick={() => void handleTalk()}
        style={{
          left: `calc(50% - 26px + ${BUBBLE_POSITIONS.talk.tx}px)`,
          top: `calc(50% - 26px + ${BUBBLE_POSITIONS.talk.ty}px)`,
          ["--delay" as string]: `${5 * BUBBLE_STAGGER_MS}ms`
        }}
      >
        <Mic aria-hidden="true" size={18} />
        <span className="bubble-label" aria-hidden="true">
          {pendingAction === "talk" ? "…" : "Talk"}
        </span>
      </button>

      {/* History bubble */}
      <button
        type="button"
        className="bubble"
        aria-label="View chat history"
        disabled={pendingAction !== null}
        onClick={() => void handleHistory()}
        style={{
          left: `calc(50% - 26px + ${BUBBLE_POSITIONS.history.tx}px)`,
          top: `calc(50% - 26px + ${BUBBLE_POSITIONS.history.ty}px)`,
          ["--delay" as string]: `${6 * BUBBLE_STAGGER_MS}ms`
        }}
      >
        <History aria-hidden="true" size={18} />
        <span className="bubble-label" aria-hidden="true">
          History
        </span>
      </button>

      {/* Settings bubble — smaller, lower emphasis */}
      <button
        type="button"
        className="bubble"
        data-size="sm"
        aria-label="Open Mauz settings"
        disabled={pendingAction !== null}
        onClick={() => void handleSettings()}
        style={{
          left: `calc(50% - 20px + ${BUBBLE_POSITIONS.settings.tx}px)`,
          top: `calc(50% - 20px + ${BUBBLE_POSITIONS.settings.ty}px)`,
          ["--delay" as string]: `${7 * BUBBLE_STAGGER_MS}ms`
        }}
      >
        <Settings aria-hidden="true" size={15} />
        <span className="bubble-label" aria-hidden="true">
          Settings
        </span>
      </button>
    </div>

    {/* Auth reconnect pill — shown when not connected */}
    {authState !== "connected" ? (
      <button
        type="button"
        className="bubble-auth-pill"
        onClick={() => void handleOpenAiReconnect()}
        disabled={pendingAuthAction !== null}
        aria-label="Connect OpenAI"
      >
        <KeyRound aria-hidden="true" size={11} />
        {pendingAuthAction === "connect" ? "Connecting…" : "Connect OpenAI"}
      </button>
    ) : null}

    {/* Status toast — shown when status is non-null */}
    {status !== null ? (
      <div className="bubble-status-toast" role="status" aria-live="polite">
        {status}
      </div>
    ) : null}
  </div>
);
```

- [ ] **Step 4: Update `OpenAiAuthMenu` — keep it but simplify render**

The `OpenAiAuthMenu` component is no longer rendered by `MauzMenu` but must stay compilable since it's in the same file and imports still reference it indirectly via `pendingAuthAction`. Actually — check: it's an internal component only rendered within `MauzMenu`. Since we no longer render it in the new JSX, we should remove the call site but keep the helper functions. Actually, the auth logic is now inline via the auth pill. We can either:
a) Delete the `OpenAiAuthMenu` component entirely (safe — it's not exported) and move `getOpenAiAuthState` calls inline, OR
b) Keep it as a dormant function.

Best approach: remove `OpenAiAuthMenu` entirely. The `getOpenAiAuthState` function is still used inline in the new JSX (`const authState = getOpenAiAuthState(settings)` in the return). The `handleOpenAiReconnect` and `handleOpenAiDisconnect` handlers are preserved at the component level. The `pendingAuthAction` state is also preserved. The `Lock`, `Check`, `X`, `ChevronRight` icons become unused — remove them from the import line.

After the edit, verify unused imports. The new JSX uses: `KeyRound`, `Mic`, `MousePointer2` (via LENS_ACTIONS icon), `Sparkles`, `Wand2`, `Pin`, `GitCompareArrows`, `History`, `Settings`. Remove: `ChevronRight`, `Check`, `Lock`, `X`, `ScanSearch` (LENS_ACTIONS still uses `ScanSearch` as icon for "ask" — keep it). Actually: LENS_ACTIONS still references `ScanSearch` — keep it. `ChevronRight` was used in menu-command rows → now gone. `Check`, `Lock` were used in OpenAiAuthMenu → now gone. `X` was the close button → now gone (backdrop handles close). Remove those four.

```tsx
import {
  GitCompareArrows,
  History,
  KeyRound,
  Mic,
  MousePointer2,
  Pin,
  ScanSearch,
  Settings,
  Sparkles,
  Wand2
} from "lucide-react";
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/desktop exec tsc --noEmit 2>&1 | tail -30
```

Expected: 0 errors. If `["--delay" as string]` syntax causes a TS error, use `style={{ "--delay": "..." } as React.CSSProperties}` instead.

- [ ] **Step 6: Run tests and build**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/desktop test 2>&1 | tail -20
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/api test 2>&1 | tail -20
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm -r build 2>&1 | tail -30
```

Expected: tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && git add apps/desktop/src/renderer/src/styles.css apps/desktop/src/renderer/src/components/MauzMenu.tsx && git commit -m "feat: replace menu card with bubble cluster launcher"
```

---

### Task 7: Report + final verification

**Files:**

- Create: `/Users/zidane/Mauz/.claude/worktrees/hermes-backend/.superpowers/sdd/ui-refresh-a-report.md`

**Interfaces:**

- Consumes: results of all previous tasks

- [ ] **Step 1: Create `.superpowers/sdd/` directory if needed**

```bash
mkdir -p /Users/zidane/Mauz/.claude/worktrees/hermes-backend/.superpowers/sdd
```

- [ ] **Step 2: Write the report**

Create `/Users/zidane/Mauz/.claude/worktrees/hermes-backend/.superpowers/sdd/ui-refresh-a-report.md` with:

- What changed (CSS token block summary, class families migrated, MauzMenu structure)
- Class families migrated (list all: desktop-\*, mauz-panel, ask-panel, lens-panel, history-panel, settings-panel, realtime-panel, lens-task-panel, agent-approval, agent-mode-toggle, agent-stop-button, submit-button, secondary-button, danger-button, menu-auth-button, etc.)
- Any TSX beyond MauzMenu.tsx touched (none expected)
- Build/test one-liner result
- Commit SHAs

- [ ] **Step 3: Final test run confirmation**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && pnpm --filter @mauzai/desktop test && pnpm --filter @mauzai/api test && pnpm -r build && echo "ALL CLEAR"
```

Expected: `ALL CLEAR` at the end.

- [ ] **Step 4: Commit the report**

```bash
cd /Users/zidane/Mauz/.claude/worktrees/hermes-backend && git add .superpowers/sdd/ui-refresh-a-report.md && git commit -m "docs: add ui-refresh pass 1 implementation report"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement                                          | Task      |
| --------------------------------------------------------- | --------- |
| `color-scheme: light dark`                                | Task 1    |
| Glass surfaces with backdrop-filter                       | Tasks 1+2 |
| Light/dark surface tokens                                 | Task 1    |
| Hairline borders                                          | Task 1    |
| Text primary/secondary/tertiary                           | Task 1    |
| `--accent-answer` teal channel                            | Task 1    |
| `--accent-agent` violet channel                           | Task 1    |
| `--accent-yolo` amber channel                             | Task 1    |
| `--ok` green / `--danger` red                             | Task 1    |
| Radii scale                                               | Task 1    |
| Shadow scale including `--shadow-panel`                   | Task 1    |
| `--ease-spring`                                           | Task 1    |
| Duration vars                                             | Task 1    |
| `prefers-reduced-motion` disables animations              | Task 1    |
| Migrate `.mauz-panel`                                     | Task 2    |
| Migrate `.ask-panel`                                      | Task 2    |
| Migrate `.lens-panel`                                     | Task 2    |
| Migrate `.settings-panel`                                 | Task 2    |
| Migrate `.history-panel`                                  | Task 2    |
| Migrate `.agent-approval`                                 | Task 2    |
| Migrate `.agent-mode-toggle`                              | Task 2    |
| Migrate `.agent-stop-button`                              | Task 2    |
| `panel-in` entrance animation                             | Task 3    |
| Hub bubble 64px                                           | Task 5+6  |
| Option bubbles arc                                        | Task 5+6  |
| Staggered pop-in with CSS delay                           | Task 5+6  |
| Hover scale 1.08 + glow ring                              | Task 5    |
| Pending state pulse                                       | Task 5    |
| Auth state dot on hub                                     | Task 6    |
| `OpenAiAuthMenu` logic preserved (reconnect handler kept) | Task 6    |
| Disconnect handler preserved                              | Task 6    |
| Full-window backdrop dismiss                              | Task 6    |
| Status toast at bottom                                    | Task 6    |
| `aria-label` on all bubbles                               | Task 6    |
| `sr-only` h1 stays                                        | Task 6    |
| No main-process changes                                   | All tasks |
| Tests green                                               | Task 4+6  |
| `pnpm -r build` clean                                     | Task 4+6  |
| Report at specified path                                  | Task 7    |

**Known edge cases to watch:**

1. `bubble-in` keyframe uses `translate` CSS properties in the `from` clause with CSS vars. Make sure the `transform` in `.bubble:hover` (scale) doesn't conflict — hover applies `transform: scale(1.08)` which replaces the animated translateX/Y. Since the animation ends with `translateX(0) translateY(0)` (no tx/ty by default — tx/ty are for the old approach). Actually, I used position: absolute + left/top inline styles for positioning rather than transforms. The animation just does scale + fade. Hover just does scale. These are consistent and don't conflict.
2. The `--delay` CSS custom property on `.bubble` style prop: TypeScript's `React.CSSProperties` does not include arbitrary `--*` props. Use `style={{ "--delay": `${n}ms` } as React.CSSProperties}` to satisfy the compiler.
3. Settings bubble uses `data-size="sm"` with `width: 40px` — its absolute position left/top calculation uses `calc(50% - 20px + tx)` (half of 40) instead of `calc(50% - 26px + tx)` (half of 52). Note this in Task 6 Step 3 inline comments.
