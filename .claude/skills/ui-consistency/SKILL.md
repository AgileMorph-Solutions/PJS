---
name: ui-consistency
description: The project's UI consistency rules - type scale, headings, text, colour, spacing and reusable components. Use BEFORE writing or changing any frontend UI - a page, component, form, table, card, modal, button, heading, label or copy - and whenever the user asks for styling, font-size, design or consistency work, or a UI audit.
---

# UI consistency

Every screen should look like one person built it. The theme tokens are in
`frontend/src/styles/global.css`; this skill says how to use them. Colours and tokens are defined
there and only there.

## Workflow

Follow this for every UI change:

1. **Look for a component first.** Check the list under "Reusable components".
2. **Use the ladder** in "When to create a component" if nothing fits.
3. **Take sizes, weights and colours from the tables below.** Never pick a value by eye.
4. **Tidy what you touch.** Move the lines you are changing onto these rules. Don't sweep unrelated
   files unless the user asks for a migration.
5. **Run the audit** at the end and fix anything your change added.

If a design really needs something these rules don't cover, ask the user. If they agree, add it here
so it becomes the rule.

## Type scale

These are the only text sizes allowed. Each one has a role, so choose by role.

| Role | Classes | Tag |
|---|---|---|
| Page title | `text-2xl font-bold tracking-tight text-warmstone-900` | `h1`, once per page |
| Section title (groups cards) | `text-[17px] font-bold text-warmstone-900` | `h2` |
| Card or modal title | `text-[15px] font-bold text-warmstone-900` | `h2`/`h3` |
| Sub-block title (inside a card) | `text-[13px] font-bold text-warmstone-900` | `h3`/`h4` |
| Eyebrow / group label | `text-[11px] font-bold uppercase tracking-wider text-warmstone-500` | `p` or heading |
| Body, table cell, input, button | `text-[13px] text-warmstone-800` | - |
| Page lede | `text-sm leading-relaxed text-warmstone-500` | `p` |
| Secondary text, form label, hint | `text-[12px]`, see "Forms" for labels | - |
| Caption, pill, meta | `text-[11px]` | - |
| Stat value | `text-xl font-bold tracking-tight tabular-nums` | - |
| KPI value | `text-[28px] font-bold tracking-tight tabular-nums` | - |

- **Retired sizes:** 10px, 10.5px, 11.5px, 12.5px, 13.5px and 14px, plus `text-xs`, `text-base` and
  `text-lg` as text. Round each to the nearest role above: 10-11.5px → 11, 12.5px → 12,
  13.5-14px → 13 (or 15 if it is a card title).
- **Nothing is smaller than 11px.**
- **Weights:** `font-bold` for titles, eyebrows and primary buttons. `font-semibold` for labels and
  secondary buttons. `font-medium` for emphasised values. Regular for everything else.

### Fonts

- `h1`-`h4` get Plus Jakarta Sans automatically. Everything else inherits Inter from `body`.
- A title that isn't a heading tag (such as a `span` in a `summary`) needs `font-sans`, or it renders
  in Inter and looks different from every other title.
- The tag follows the document outline and the size follows the role, so a modal's `h2` still uses
  the card title size.
- Numbers that line up in a column use `tabular-nums`, never a mono font.

### Icons

Material Symbols Outlined only: `<span className="material-symbols-outlined text-[18px]">name</span>`.

| Size | Use |
|---|---|
| `text-[16px]` | Inline with text, inside pills and table cells |
| `text-[18px]` | Buttons, card headers |
| `text-[20px]` | Nav items, close buttons, tile icons |
| `text-[28px]` | Empty states |

## Colour

Use only the semantic families in `global.css`. Never use Tailwind's default palette (`red-500`,
`gray-200`) or a hex value in a component.

| Family | Meaning |
|---|---|
| `brand` | Primary action, the active or current step, links |
| `warmstone` | Surfaces, borders, text, "automatic/system" states |
| `ambernut` | Pending, needs a decision |
| `success` | Passed, done |
| `danger` | Rejected, critical. Never use `brand` for this |

- **Text:** `warmstone-900` for titles, `800` for body, `700` for labels, `500` for muted text, `400`
  for placeholders only.
- **Status** is shown with `Pill`, using its tone mapping. Don't hand-roll coloured badges.
- **Charts:** load the `dataviz` skill first. Chart colours have their own validated tokens.

## Surfaces and spacing

| Element | Classes |
|---|---|
| Card | `bg-white border border-warmstone-200 rounded-2xl shadow-xs` |
| Card header / body | `px-5 pt-4 pb-3` / `px-5 pb-5` |
| Card divider or footer | `border-warmstone-100` |
| Tile (stat, KPI) | `bg-warmstone-50 border border-warmstone-200 rounded-xl p-4` |
| Empty or dashed area | `border border-dashed border-warmstone-300 rounded-2xl bg-warmstone-50/60` |

- **Radius:** `rounded-2xl` for cards and modals, `rounded-xl` for tiles, buttons and inputs,
  `rounded-lg` for icon buttons and icon squares, `rounded-full` for pills and avatars.
- **Shadow:** `shadow-xs` on cards, `shadow-sm` on primary buttons, `shadow-xl` on modals. Use the
  theme's tokens, not custom shadows.
- **Spacing:** stay on Tailwind's scale, with no arbitrary `p-[7px]` values. Use `style={{}}` only for
  values computed at runtime, such as a progress width.

## Buttons

Every button is one of these. Don't vary padding, size or weight per page.

| Variant | Classes |
|---|---|
| Base (all) | `inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] transition-all disabled:opacity-50 disabled:pointer-events-none` |
| Primary | `bg-brand-700 hover:bg-brand-800 text-white font-bold shadow-sm` |
| Secondary | `border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 font-semibold` |
| Danger | `bg-danger-700 hover:bg-danger-800 text-white font-bold shadow-sm` |
| Icon only | `p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors`, with an `aria-label` |

Use one primary button per view or form. Put the primary action last in a button row.

## Forms

| Element | Classes |
|---|---|
| Input, select, textarea | `w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700` |
| Label | `block text-[12px] font-semibold text-warmstone-700 mb-1.5` |
| Hint | `text-[12px] text-warmstone-500 mt-1` |
| Error | `text-[12px] text-danger-700 mt-1` |

Dates always use `ui/DateInput`, never `<input type="date">`. Stage fields go through `StageForm` and
`FieldInput`. Keep their "workbook"/"new" badges, which are intentional product behaviour.

## Text and copy

- **Case:** sentence case for titles, labels and buttons ("Batch details", not "Batch Details").
  Uppercase comes only from the eyebrow classes, never typed into the string.
- **Buttons** start with a verb and name the thing: "Record a new BTM", not "Submit" or "OK".
- **Domain words** keep the client's spelling: Lot, Bin, BKT, GRN, RCN, KOR. Use the labels from
  `stages.ts`, `juteBags.ts` and the contract's `*_LABELS` maps rather than retyping them.
- **Empty values** show `-` (see `InfoRow`). Empty lists use `EmptyState`.
- **Separators:** use ` · ` between short facts ("Round 1 · quality check").
- **Dates** go through `formatDate` / `formatDateTime`. Never use `toLocaleDateString()` or `.slice(0, 10)`.
- **Numbers:** kg and tonnes use one shared formatter (`formatKg` / `formatTonnes`), not a new
  `toLocaleString` call.
- **Real data only.** Never invent sample values or placeholder numbers to fill a design. A stat
  renders only when its field exists.

## Reusable components

Use these before writing markup. All are in `frontend/src/components/ui/` unless noted.

| Need | Use |
|---|---|
| Page heading with actions | `PageHeader` |
| Any table | `DataTable`, with `FilterBar`, `ColumnFilterMenu`, `Pagination`, `useTableSearch`, `usePagination` |
| Label/value card | `InfoCard` + `InfoRow` |
| Collapsible section | `CollapsibleCard` |
| Dialog | `Modal`; `RecordDetailModal` for a record's raw fields |
| Metric tile | `KpiTile` (linkable count), `StatBlock` (icon + value + sub) |
| Status badge | `Pill`; wrap it for domain status, as `ReceiptStatusPill` does |
| Date entry and filtering | `DateInput`, `DateRangeInputs`, `useDateRangeFilter` |
| Route tabs | `Tabs` |
| Nothing to show | `EmptyState` |
| Icon-only button (remove, edit) | `IconButton` |
| Steps / stages to pick from | `StepNav` (vertical or horizontal) |
| A production table's columns | `components/production/columns.tsx` (`dateCol`, `kgCol`, `numCol`, `pctCol`, `textCol`, `statusCol`): the filter comes with the column |
| Progress and people | `ProgressBar`, `Avatar` |
| Stage-driven forms | `components/StageForm`, `components/FieldInput` |

### When to create a component

Work down this ladder and stop at the first step that fits:

1. **Use** an existing component as it is.
2. **Add a prop** to an existing one. Don't fork or copy it.
3. **Promote** a page-level component to a shared folder when a second place needs it.
4. **Create** one when the same markup or class string would appear a second time.

Where it goes:

- `components/ui/`: generic, with no domain knowledge. If it knows what a Lot is, it doesn't belong here.
- `components/` or a feature folder (`production/`, `receipt/`): wraps `ui/` pieces with domain logic.

How to build it:

- The component owns its classes. Callers pass data and a `tone`, `size` or `variant` prop, not
  `className` overrides or `!important` utilities like `py-1.5!`.
- Limit variants to named options with a typed union, and take their classes from this skill.
- Keep it presentational: data and callbacks in, no fetching or business logic. See `frontend/CLAUDE.md`.

### Known duplication: fix when you touch it

These have no shared primitive yet, so copies have drifted apart:

- **Buttons and inputs.** `btnPrimary`, `inputCls` and similar are redefined across many files outside
  Production (Production now uses `ui/Button` and `ui/Input` throughout). Don't add another copy. `ui/Button` and `ui/Input` (`Input`,
  `Select`, `Field`) now exist: use them for the lines you touch.
- **Card shell.** The card classes are pasted inline in older files. Use `ui/Card` the next time you write one.
- **Headings.** Section and card titles are hand-written and vary in size. `ui/CardTitle` exists; create
  `ui/SectionTitle` when you need it.

Delete this section's entries as each one is resolved.

## Audit

Run from the repo root (Git Bash). Each search should return nothing in lines you added or changed.

```bash
cd frontend/src
# Retired or off-scale text sizes
grep -rnE 'text-(xs|base|lg|3xl|\[(10|10\.5|11\.5|12\.5|13\.5|14)px\])' --include=*.tsx .
# Off-scale icons
grep -rnE 'material-symbols-outlined[^"]*text-\[(13|14|15|17|19|22|44)px\]' --include=*.tsx .
# Default Tailwind palette
grep -rnE '\b(bg|text|border)-(red|green|blue|gray|slate|orange|amber|yellow|zinc|neutral|stone|teal|emerald)-[0-9]+' --include=*.tsx .
# Hex colours outside global.css (charts are handled through the dataviz skill)
grep -rnE '#[0-9a-fA-F]{6}\b' --include=*.tsx . | grep -v components/dashboard
# Locally redefined button or input classes
grep -rnE 'const (btn[A-Z]|primaryB|secondaryB|ghostB|inputCl)' --include=*.tsx .
# Date bypasses (fine when ISO is only used for filtering, or inside DateInput itself)
grep -rnE 'type="date"|toLocaleDateString|\.slice\(0, 10\)' --include=*.tsx .
```

Move off-scale icons to the nearest size in the icon table.
