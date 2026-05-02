# Friday Cockpit — Screen Spec

**Status:** Draft v1 (prototype)
**Owner:** `multi-client-ux`
**Route:** `/cockpit`
**Source of truth for the prototype:** `src/app/cockpit/page.tsx` + `src/ui/components/`

---

## 1. Persona context

It is Friday morning, 7:45 AM. Mara is a senior payroll specialist at a 130-client service bureau in Tulsa. She has eight tabs already open: the bureau's ticketing system, two ADP RUN sessions for clients onboarding off ADP, Gusto Pro for the bureau's smallest clients, an Outlook tab, a banking portal, a Slack DM with a client controller, and a Workday window for one big-employer client. By 5 PM she needs to have submitted 32 client payrolls, request approval on 6 of them, and triaged the dozen exceptions she expects to surface. Friday is **deadline density**. Every wasted second compounds.

The Friday cockpit is the first tab she opens. It must answer four questions in under two seconds, glanceably, before she touches the keyboard:

1. **What's burning?** Which clients are within hours of their submit deadline.
2. **What's stuck?** Which clients are blocked or have critical exceptions.
3. **What's awaiting me vs. awaiting the client?** Approval-state visibility.
4. **What's done?** Which clients are already submitted and out of her queue.

If the cockpit cannot answer those four in the first paint, it has failed.

## 2. Information architecture

Attention priority, top to bottom on the page:

| Tier | Element | Why it's at this tier |
|---|---|---|
| 0 | Top bar: aggregate status pills (X blocked / Y exception / Z clean / N submitted) | Whole-bureau pulse without scanning the list. |
| 1 | Filter bar with saved-view selector | The first thing Mara does is select "Due today" or her custom view. |
| 2 | The list itself, with status chip + deadline as the leftmost data columns | These are the columns she scans. Everything else is supporting. |
| 3 | Per-row detail (period, employee count, last action, last actor) | Progressive disclosure — visible but secondary. |
| 4 | Quick action affordances (Triage, open-in-new-tab) | Hover/focus reveal. Mouse path; the keyboard path is faster. |
| 5 | Side panel (approval / block / snooze) | Opens contextually; never blocks the list. |

**What is intentionally NOT on this screen:**

- Calculation totals (gross, net, employer burden). Those live on the per-client detail. Putting them here pulls focus and misses the persona — Mara isn't auditing numbers, she's triaging flow.
- Employee-level data of any kind. That's a non-starter: this screen is server-rendered against session state and we do not persist employee records (see ADR 0001).
- The exception list itself. Exceptions get a count + severity badge here and a dedicated triage view.

## 3. Layout sketch

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Paygon Cockpit · Friday May 8 · [PROTOTYPE]              [3 blocked][8 exc][12 clean][7 submitted][?]│
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [Saved view ▼] [🔎 client name…  /]  [chip][chip][chip][chip][chip]  □ Exc only     22/30 runs  [⤢]│
├──────┬───────────┬──────────────────────────┬─────────────┬──────────────────────┬──────┬────────────────────┬─────┤
│  ☐   │ STATUS    │ CLIENT                    │ PAY PERIOD  │ DEADLINE             │ EXC  │ LAST ACTION        │     │
├──────┼───────────┼──────────────────────────┼─────────────┼──────────────────────┼──────┼────────────────────┤─────┤
│  ☐   │ ●BLOCKED  │ Bluewater Logistics  Bi-wk│ Apr 24–May 7│ ⚠ 4h          Fri 3PM│  1   │ flagged blocked    │ [↗] │
│  ☐   │ ●EXCEPTION│ Acme Construction    Wk   │ May 1–May 7 │ 2h 30m        Fri 1PM│  8   │ imported hours     │ [↗] │
│  ☐   │ ●EXCEPTION│ Cedar Hollow Vet     Bi-wk│ Apr 24–May 7│ 5h 15m        Fri 4PM│ 11   │ snoozed exc PAY-22 │ [↗] │
│  ☐   │ ●CLEAN    │ Delta Print & Sign   Wk   │ May 1–May 7 │ 8h            Fri 7PM│   0  │ reviewed run       │ [↗] │
│  …   │           │                           │             │                      │      │                    │     │
│  ☐   │ ●SUBMITTED│ Harvest Moon Bakery  Wk   │ May 1–May 7 │ 18h          Sat 10A │   0  │ submitted to ACH   │ [↗] │
│  …   │           │                           │             │                      │      │                    │     │
└──────┴───────────┴──────────────────────────┴─────────────┴──────────────────────┴──────┴────────────────────┴─────┘
                                                                                                          ┌─────────────┐
                                                                                                          │ Side Panel  │
                                                                                                          │ Request     │
                                                                                                          │ approval —  │
                                                                                                          │ Acme Constr.│
                                                                                                          │             │
                                                                                                          │ ...form...  │
                                                                                                          │             │
                                                                                                          │ [Cancel][OK]│
                                                                                                          └─────────────┘
```

The side panel slides in from the right and **does not block** the list — Mara can keep navigating with `j`/`k` while it's open. Pressing `Escape` closes it.

## 4. Per-row anatomy

Each row of the list represents **one (client × pay period × pay run)**.

| Cell | Content | Notes |
|---|---|---|
| 1. Selection checkbox | Toggleable for bulk actions | Bulk action behavior: covered by Hard Rule #4 — preview + confirm before executing. |
| 2. Status chip | One of: clean, has-exception, blocked, submitted, draft | **Non-hideable column.** This is the compliance-anxious-persona answer to "is this thing OK?" |
| 3. Client + secondary | `Client name` (display only), then `Wk · 142 ee` muted secondary | Pay frequency is abbreviated to keep the row scannable. |
| 4. Pay period | `May 1 – May 7` | Locale-formatted, no year (Friday context implies current year). |
| 5. Deadline | Color-banded countdown + absolute (`Fri 3PM`) | Color band: green >24h, amber 6–24h, red <6h, red+bold "MISSED Xh" if past. |
| 6. Exceptions | Mono-numeric badge, color = top severity | `99+` if >99. Tooltip breaks down `2 critical · 5 major · 1 minor`. |
| 7. Last action | `imported hours from Deputy` + `M. Patel · 30m ago` | Two-line cell. Last actor reassures Mara nobody else is editing the same run. |
| 8. Quick actions | `Triage` button + open-in-new-tab icon | Reveal on hover/focus only — chrome-free at rest. |

**The whole client-name cell is wrapped in `<a href="/cockpit/clients/{handle}">`** so right-click → "Open in new tab" works natively. URLs are stable and shareable.

## 5. Sort + filter behavior

### Sortable columns
- Status (alphabetical, stable secondary by deadline)
- Client name
- Deadline (the default, ascending — closest first)
- Exceptions (severity-weighted: `critical * 1000 + major * 10 + minor`)
- Last action time

Sort indicators are visible. Click a header to toggle. Multi-column sort is **explicitly out of scope** for the prototype — a single sort is sufficient and reduces cognitive load.

### Filters
- Status (multi-select chips, click-to-toggle)
- Client name (substring, focusable via `/`)
- Has-exceptions-only (checkbox)
- Deadline-within-N-hours (saved-view-only; not exposed as a top-level filter to avoid clutter)

### Saved views
Every processor accumulates personal saved views. Examples:
- "All in flight" (default)
- "Due today" (deadline within 24h)
- "Blocked + critical" (status: blocked or has-exception, sorted by exception severity desc)
- "Clean and ready" (status: clean — Mara batches her approval requests from this view)

Saved views are scoped per processor. They are **stored on the bureau's tenant record**, not Paygon's database, because the view definition references client metadata (legal names) that already live in the tenant store. (No PII regression — see ADR 0001.)

`[` and `]` cycle through saved views without leaving the keyboard.

## 6. Status chip taxonomy

| Variant | Color | When it appears |
|---|---|---|
| `clean` | Green (#ECFDF5 / #065F46) | Run has been imported, calculated, and reviewed; no open exceptions. |
| `has-exception` | Amber (#FFFBEB / #92400E) | One or more open exceptions. Severity drives the badge color, not the chip. |
| `blocked` | Red (#FEF2F2 / #991B1B) | Manually flagged; or a connector reported a hard error (bank rejection, missing required field). |
| `submitted` | Blue (#EFF6FF / #1E40AF) | Submitted to ACH / IRS / state. Terminal state for a run; falls off the cockpit at end-of-day. |
| `draft` | Grey (#F3F4F6 / #374151) | Auto-created at pay-period start; nobody has touched it yet. |

A small left-edge dot reinforces the color for processors who are mildly red-green colorblind. Light + dark mode palettes are defined in `src/ui/tokens/index.ts`.

## 7. Keyboard map

The full map lives in `src/ui/keyboard-map.ts`. Friday-cockpit-relevant entries:

| Keys | Scope | Action |
|---|---|---|
| `?` | global | Toggle keyboard shortcut overlay. |
| `g` then `f` | global | Go to Friday cockpit. |
| `g` then `c` | global | Go to clients index. |
| `g` then `e` | global | Go to exceptions queue. |
| `j` / `ArrowDown` | list | Move focus down one row. |
| `k` / `ArrowUp` | list | Move focus up one row. |
| `gg` | list | Jump to top. |
| `G` | list | Jump to bottom. |
| `o` / `Enter` | list | Open focused row's client detail. |
| `O` | list | Open focused row in new tab. |
| `e` | list | Enter exception triage on focused row. |
| `s` | list | Open Snooze panel for focused row. |
| `b` | list | Open Mark-blocked panel for focused row. |
| `a` | list | Open Request-approval panel for focused row. |
| `x` | list | Toggle row selection (for bulk). |
| `/` | list | Focus the filter input. |
| `f` then `s` | list | Save current view. |
| `f` then `d` | list | Discard view changes. |
| `[` / `]` | list | Previous / next saved view. |
| `d` | global | Toggle compact density. |
| `Escape` | global | Close any open side panel or overlay. |

Two-key sequences use a 1.2-second timeout (`SEQUENCE_TIMEOUT_MS`).

## 8. Empty state

Two variants:

**No payrolls exist at all** (the bureau just signed up, or every client is between pay periods):
> **No payrolls in flight**
> Either no clients have a pay period currently open, or you haven't connected any client systems yet. Runs appear here automatically once a connector pulls a pay period.
> [Manage clients] [Configure a connector]

**Filters hide everything:**
> **No runs match your filters**
> Clear filters above, or pick a different saved view.

Never just "no data." Empty states are wayfinding.

## 9. Loading state

Skeleton rows. Eight of them, at the configured density, with a subtle pulse. **No spinner.** Spinners imply "we're thinking" — skeletons imply "we're populating," which is psychologically faster and matches the persona's expectation of streamed connector pulls.

The page itself never shows a full-page loader; only the table body shows skeletons while the filter bar and aggregate status pills remain interactive.

## 10. Error state

Errors are **per-row**, not whole-screen. If a connector fails to pull a client's pay period:

```
┌──────┬───────────┬──────────────────────────┬─────────────┬──────────────────────┬──────┬────────────────────┐
│  ☐   │ ●BLOCKED  │ Acme Construction    Wk   │ May 1–May 7 │ 2h 30m       Fri 1PM │  —   │ ⚠ Deputy connector │
│      │           │                           │             │                      │      │   timed out · retry│
└──────┴───────────┴──────────────────────────┴─────────────┴──────────────────────┴──────┴────────────────────┘
```

The "last action" cell becomes the error surface, with an inline "retry" button. The status chip flips to `blocked`. **No toast** — the rule from the role spec: never a toast for an actionable error.

If the *whole list* fails to load (Paygon API outage), that's the rare case where a top-of-page banner is appropriate, with a retry button and a `[connection diagnostics]` link.

## 11. Side panels — what triggers them

| Trigger | Panel content | Shortcut |
|---|---|---|
| Approve client run | Approver picker, message, due time | `a` |
| Mark run blocked | Reason picker, free-text note, optional Slack notification | `b` |
| Snooze top exception | Snooze duration, optional note | `s` |
| Bulk action preview | List of selected runs + the action that will apply, with per-row diff | (after selecting and triggering) |

**What is NOT a side panel:**
- Opening a client's run → full-page navigation, because the user is committing to deep-context work.
- Exception triage → full-page navigation (own URL, own breadcrumbs, own keyboard map).
- Voiding a submitted run → confirm modal (irreversible destructive — Hard Rule exception).

## 12. Edge cases

- **≥1000 rows.** A bureau with 500+ clients running multiple periods could see 1000+ rows. Latency budget: <100ms render. We use TanStack Table's headless model and will plug in `@tanstack/react-virtual` (already a peer of TanStack Table) when row count exceeds ~200. Prototype does not yet virtualize; mark for production wiring.
- **Client with no integration configured.** Row appears with `draft` chip and a "Configure connector" inline link in the last-action cell. No exceptions yet because there's no data to import.
- **Exception count >99.** Badge renders `99+`. Tooltip still gives the exact breakdown.
- **Client name is very long.** Truncate with ellipsis at the cell width; full name in `title` attribute for tooltip.
- **Two processors editing the same run simultaneously.** The "last action" cell tells Mara when someone else touched the row. Stronger cross-processor locking is a future round; flagged for `audit-trail-engineer` coordination.
- **Pay period spans a month boundary.** Period label uses month abbreviations on both ends (`Apr 24 – May 7`).
- **Timezone differences.** Deadlines are processor-local. Real wiring will pull processor TZ from session; prototype uses browser TZ.
- **Client with no employees this period.** Row appears, employee count displays `0 ee`, status follows the run's actual state (often `draft`).

## 13. Latency budget

- Initial paint: <100ms with 1,000 rows. Server pre-renders the first 50; the rest hydrate.
- Filter / sort: 60fps interaction. All filtering is client-side over an in-memory array — re-fetching from backend on every keystroke is unacceptable.
- Side panel open: <50ms.

If any of these slip, the cockpit has lost the persona.

## 14. Reference observations

- **Gusto Pro** does cross-client visibility well: the homepage shows "X clients running this week, Y need review." We borrow the aggregate-pill summary at the top. We do not borrow Gusto's marketing-y empty state, which is a wall of text.
- **Rippling Client Command Center** has strong column density and saved views. Our column set is tighter — Rippling shows ~10 columns by default, which costs scannability. We bias toward 6–7.
- **ADP Accountant Connect** demonstrates anti-patterns: opening a client requires a full-page reload; bulk operations don't preview; sort is reset between sessions; saved views don't exist in the same form. We invert all four.

## 15. Out of scope (for this spec)

- Real backend wiring (mocked fixtures only).
- Authentication / RBAC.
- The exception triage screen — its own spec, next round.
- The per-client run detail screen — its own spec, next round.
- Bulk action dialog content (preview UI exists in concept; the actual diff renderer is future work).
- Mobile / narrow viewports — the persona is dual-monitor desktop. A future "on-call mobile" view is not in MVP.
- Storybook stories — set up when the component library outgrows the prototype phase.

## 16. Open questions for coordinators

- **`zero-pii-architect`:** Confirm that "last actor" display name (a Paygon processor, not a client employee) is fine in the cockpit's session state. It is, but I want it documented.
- **`audit-trail-engineer`:** What's the canonical action verb taxonomy? `lastActionVerb` should pull from a fixed enum, not free-form.
- **`integration-builder`:** What's the streaming-import progress UX? When Mara hits a row mid-import, how do we render the partial state? Prototype currently shows the import as already-completed.
- **`payroll-domain-expert`:** Severity-weighting formula for exceptions — is `critical * 1000 + major * 10 + minor` reasonable? Open to a different sort key once exception severity is fully specified.
