# PMP Data Record — Architecture & Security Audit

_Date: 2026-06-22 · Scope: full repository · Read-only audit (no code changed)_

---

## Executive Summary

PMP Data Record is an Electron desktop app for a media-production company that
records work orders, clients/providers, pricing, payments, reports and invoices
against a local SQLite database. The same services are exposed two ways: via
Electron IPC (the desktop window) and via an embedded Express HTTP server for
LAN browser access. Auth is bcrypt + role/permission based; the LAN server adds
express-session cookies and login rate-limiting.

The architecture is sound for its intended scale (a small office on a trusted
LAN). The dual-surface design (IPC + HTTP sharing one service layer) is the
right call and is mostly consistent. Electron itself is configured safely
(`contextIsolation: true`, `nodeIntegration: false`, app menu stripped, no
remote content loaded).

The main risks are **not** memory-safety or injection (SQL is fully
parameterized) — they are **operational and RBAC-consistency** issues:

- **No backup/recovery strategy** for a system of record holding financial data.
- **RBAC drift**: 8 of 13 permission keys shown in the admin UI matrix are not
  actually enforced — per-user overrides for them silently do nothing.
- **LAN transport is plaintext HTTP** with `secure:false` cookies; credentials
  and session cookies cross the wire unencrypted.
- **No CSP** on renderer pages combined with heavy `innerHTML` use → XSS surface,
  which matters more in LAN-browser mode.
- **Heavy technical debt** in `database.js` (200+ lines of self-healing
  migration recovery) and substantial **code duplication** between the IPC and
  HTTP layers.

None are exploitable remotely from the internet (LAN-only, no port forwarding by
default), so nothing is "drop everything" severity, but the backup gap and RBAC
drift should be addressed before this is relied on for billing.

---

## Architecture Diagram

```
                          ┌──────────────────────────────┐
                          │     Electron main process     │
                          │          (main.js)            │
                          │  - resolves data paths        │
                          │  - db.init()                  │
                          │  - ensureDefaultAdmin()       │
                          │  - starts LAN server          │
                          │  - registers IPC handlers     │
                          └───────┬───────────────┬───────┘
                                  │               │
              global session.currentUser     starts
              (single desktop user)             │
                                  │               ▼
   ┌──────────────────────────────┴───┐   ┌───────────────────────────────┐
   │   IPC handlers (src/main/ipc)     │   │  Express server (server.js)   │
   │   auth / core / admin             │   │  /api/* routes                │
   │   middleware: requireAuth /       │   │  express-session (MemoryStore)│
   │     requireRole / requirePerm     │   │  requireAuth/Role/Permission  │
   └───────────────┬───────────────────┘   │  rate-limit on /auth/login    │
                   │                        └───────────────┬───────────────┘
                   │   both call the SAME service layer     │
                   ▼                                         ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Services (src/services/*)                               │
        │  auth, users, clients, providers, orders, pricing,       │
        │  payments, reports, invoices, locations, catalog,        │
        │  permissions                                             │
        └───────────────────────────┬─────────────────────────────┘
                                     ▼
                 ┌──────────────────────────────────────┐
                 │  database.js  (better-sqlite3, WAL)   │
                 │  pmp.db in PMP-Data/ next to the exe  │
                 │  (or %APPDATA% / dev ./userdata)      │
                 └──────────────────────────────────────┘

  Renderer (src/renderer): same HTML/JS served two ways
   - Electron: preload.js → window.pmp over ipcRenderer.invoke
   - Browser:  http-api.js → window.pmp over fetch() + cookies
   - perm-matrix.js is the shared single source of truth for RBAC defaults
```

**Data location priority** (`main.js`): dev → `./userdata`; portable →
`<exe dir>/PMP-Data`; installed → `%APPDATA%`.

---

## Project Structure Map

```
main.js                 Electron entry; paths, lifecycle, LAN bootstrap, relaunch shim
preload.js              contextBridge → window.pmp (IPC surface)
package.json            electron-builder config (nsis + portable targets)

src/
  db/
    database.js         init + 200-line self-healing migration/recovery engine
    schema.sql          base schema (tables, indexes, v_orders_full view, seeds)
    migrate_v2..v6.sql  incremental migrations (tracked in migrations_applied)
    migrate-from-excel  Excel import (24KB)
  main/ipc/
    index.js            wires ctx + registers handler groups
    middleware.js       requireAuth / requireRole / requirePermission (IPC)
    authHandlers.js     login/logout/me/changePassword/nav
    coreHandlers.js     clients/providers/orders/pricing/payments/catalog/locations
    adminHandlers.js    users/invoices/reports/migration/LAN/company settings
  server/
    server.js           Express app: all /api routes (mirror IPC) + static + HTML routing
  services/             business logic (12 modules) — shared by IPC and HTTP
  renderer/
    *.html, js/*, css/  UI; perm-matrix.js shared; http-api.js browser fallback

scripts/                recover-providers.js, reset-admin-electron.js
test-lan.js             ad-hoc LAN smoke test
Book1.xlsx              ⚠ committed to git (see Security)
```

---

## Database Review

**Engine:** better-sqlite3, WAL journal, 5s busy timeout. Appropriate for a
single-writer LAN app.

**Schema:** Clean, normalized, sensible types and CHECK constraints
(`role`, `category`). Foreign keys declared with correct `ON DELETE`
behaviour (RESTRICT on client→orders, SET NULL on provider→orders, CASCADE on
pricing/payments). `v_orders_full` view pre-joins clients/providers/payments and
computes profit/paid/due — good, and it was already optimized from correlated
subqueries to a derived-table LEFT JOIN.

**Indexes:** Reasonable coverage —
`ix_orders_date/client/provider/status`, `ix_payments_order`,
`ix_audit_ts/user/entity`. Adequate for expected row counts.

**Concerns:**
1. **FK enforcement is OFF during the entire `init()` run** and only turned ON at
   the end. Migrations run with integrity checks disabled. Acceptable as a
   migration tactic, but it means a botched migration can leave dangling refs
   that won't surface until later.
2. **Pricing tables are defined twice** — in `schema.sql` and again as
   `CREATE TABLE IF NOT EXISTS` inside `database.js`. Two sources of truth for
   the same DDL; they can drift.
3. **Schema duplication of the view**: `v_orders_full` is created in `schema.sql`
   and re-dropped/recreated in `database.js`. Intentional (migrate_v3 drops it)
   but fragile.
4. **`migrations_applied` + ad-hoc `ALTER TABLE … ADD COLUMN` guards** coexist.
   Some schema changes go through numbered migrations, others through inline
   `pragma table_info` checks in `database.js`. No single migration story.
5. **No `updated_at`/`updated_by` index**, fine at this scale.
6. Orders default `LIMIT 500` (cap 5000) — safe, but the UI has no pagination,
   so large datasets silently truncate.

---

## Security Review

### Electron hardening — GOOD
- `contextIsolation: true`, `nodeIntegration: false`, custom preload — correct.
- Application menu removed; DevTools only in dev.
- Loads only local files; no remote URL loading; no `webview`.
- `sandbox: false` is set with a comment claiming the preload loads
  better-sqlite3 — **but `preload.js` does not require any native module**. The
  sandbox could likely be re-enabled (services run in main, not preload). Worth
  revisiting as hardening.

### Authentication & sessions
- bcrypt (cost 10) for hashing; hashes stripped before returning user objects.
- Login rate-limited (10/min/IP) on the HTTP surface; IPC has no rate limit
  (irrelevant — local).
- express-session: `httpOnly`, `sameSite: 'lax'`, 12h rolling, `MemoryStore`
  with cleanup. **`secure: false`** because LAN is plaintext HTTP.
- Session secret generated with `crypto.randomBytes(48)` and **stored plaintext
  in `app_settings`** — documented trade-off, acceptable for LAN/desktop.
- **Default credentials `admin/admin`** seeded, with `must_change_pwd = 1`. The
  flag is set but **not enforced server-side** — nothing blocks API calls while
  `must_change_pwd` is true; it's only a UI hint.
- Sessions cache the user's role+permissions at login; admin permission changes
  don't take effect until re-login.

### Role-Based Access Control — DRIFT (see High Priority)
- `perm-matrix.js` is a clean single source of truth, derived by both renderer
  and `permissions.js`.
- **Only 5 of 13 permission keys are actually enforced** via
  `requirePermission`: `manageClients`, `deleteClients`, `manageProviders`,
  `managePricing`, `manageCatalog`. The other 8 (`manageUsers`, `editOrders`,
  `deleteOrders`, `viewFinancial`, `managePayments`, `importData`,
  `manageSettings`, `exportReports`) are enforced — if at all — by hardcoded
  **role** checks instead. Per-user overrides the admin sets in the UI matrix
  for those keys are silently ignored.
- IPC and HTTP enforcement are consistent with each other for the keys that ARE
  enforced (good — same policy both surfaces).

### Transport / LAN
- Server binds `0.0.0.0` on port 3737; **plaintext HTTP**. Credentials and
  session cookies are sniffable on the LAN.
- `/api/sys/info` is intentionally unauthenticated (LAN discovery) — leaks
  version + LAN IPs + auth state only. Reviewed: no sensitive data. Acceptable.
- **No CSRF tokens.** Cookie-auth + state-changing POST/PUT/DELETE rely solely
  on `sameSite: 'lax'` for CSRF protection (which does cover cross-site POST).
  Adequate but thin; a single token middleware would close it.
- **No security headers / helmet** (no CSP, X-Frame-Options, etc.).

### Injection / XSS
- **SQL: safe.** All queries parameterized; dynamic fragments are built only
  from internal allowlists (`_extractFields` keys, fixed WHERE strings), never
  from raw user input. No string-interpolated user values into SQL.
- **DOCX/XLSX generation: safe** — XML values run through `escXml()`.
- **XSS surface: present.** 58 `innerHTML` assignments across renderer JS and
  **no CSP**. Order notes, client names, etc. are user-controlled and rendered.
  In Electron the renderer is semi-trusted; in **LAN-browser mode over HTTP**
  this is a more realistic stored-XSS vector.

### File-system access
- `preload` exposes `shell.openPath(arbitraryPath)` to the renderer and
  `invoices.fillDocx(templatePath,…)` reads an arbitrary path. Electron-only
  (browser http-api has no such surface) and gated behind a save/open dialog in
  practice, but `shell.openPath` takes an unrestricted path — combined with the
  XSS surface above it becomes a way to launch host files. Low-to-medium.

### Secrets in the repo
- `userdata/`, `*.db*`, `.env`, `settings.local.json` are correctly gitignored —
  **the DB (with bcrypt hashes + session secret) is NOT committed.** Good.
- **`Book1.xlsx` IS committed** and pushed to the (private) GitHub repo. If it
  contains real client/financial data, that's an unintended data exposure. Verify
  and remove from history if so.

---

## Performance Review

For the intended scale (a handful of concurrent LAN users, low thousands of
orders) performance is fine. Notes:

- **SQLite single-writer**: concurrent writes serialize on the WAL lock. Fine for
  an office; would bottleneck under many simultaneous writers (not the use case).
- **`SELECT *` from `v_orders_full`** on every list/recent/get. The view fans out
  three joins + a grouped subquery; cheap at current row counts, but `SELECT *`
  pulls every column including ones the UI ignores.
- **No UI pagination** — list defaults to 500 rows, hard cap 5000. Large exports
  build the whole workbook in memory (`exceljs`) before streaming.
- **MemoryStore sessions** are lost on app restart (everyone re-logs in) and grow
  unbounded between the 24h sweeps — negligible at this scale.
- **Financial masking is per-row in JS** (`_maskFinancial`) rather than a
  role-specific view — O(n) over results, trivial here.
- Invoice/report generation is synchronous-ish on the main process; a very large
  report could briefly block. Acceptable for now.

No real bottlenecks at target scale. The architectural ceiling is SQLite +
single-process; moving beyond ~a dozen heavy concurrent writers would require a
client/server DB — but YAGNI for this product.

---

## Refactoring Opportunities

1. **Collapse IPC ↔ HTTP duplication.** `requireAuth/requireRole/
   requirePermission` exist in both `middleware.js` and `server.js`; the
   `getSetting/setSetting` helper is reimplemented ~5 times (main.js, server.js
   ×2, adminHandlers.js ×3); company-settings get/save is duplicated verbatim
   between `server.js` and `adminHandlers.js`; the audit-log query and QR-code
   logic are each duplicated. Extract a `settings.js` service and a shared
   policy module.
2. **Tame `database.js`.** The 200-line self-healing block (zombie-table
   detection, corrupt-orders rebuild, provider rename recovery, inline
   ADD COLUMN guards) is accumulated scar tissue from past migration failures.
   Once production DBs are known-good, fold these into proper numbered migrations
   and delete the recovery spaghetti.
3. **One DDL source.** Remove the pricing-table and view definitions from
   `database.js`; keep them only in `schema.sql`/migrations.
4. **Wire RBAC fully** (see High Priority) — replace role checks for
   order/payment/user/settings/report handlers with `requirePermission` so the
   admin matrix means what it says.
5. **A `settings` service** to replace the repeated key/value access pattern.

---

## Critical Issues

| # | Issue | Where | Why it matters |
|---|-------|-------|----------------|
| C1 | **No backup/recovery strategy** | `database.js`, deployment | A single `pmp.db` next to the portable exe holds all financial records. No automated snapshot, export, or off-box copy. Drive failure, ransomware, or a botched migration = total data loss for a system of record used for billing. |

> Note: nothing here is remotely exploitable from the internet (LAN-only by
> default), so "Critical" is about business impact, not RCE.

---

## High Priority Issues

| # | Issue | Where | Recommendation |
|---|-------|-------|----------------|
| H1 | **RBAC drift — 8/13 permission keys not enforced.** Admin can toggle `deleteOrders`, `managePayments`, `viewFinancial`, `manageUsers`, `manageSettings`, `importData`, `editOrders`, `exportReports` per-user, but handlers check role instead, so overrides silently do nothing. | `coreHandlers.js`, `adminHandlers.js`, `server.js` vs `perm-matrix.js` | Enforce those keys via `requirePermission`, or remove them from the UI matrix so the UI doesn't promise control it doesn't deliver. |
| H2 | **Plaintext HTTP on the LAN** with `secure:false` cookies. Credentials + session cookie are sniffable. | `server.js` session config | Offer HTTPS (self-signed cert + `secure:true`), or document that LAN must be trusted/segmented. At minimum set `secure:true` when a cert is present. |
| H3 | **`must_change_pwd` not enforced.** Default `admin/admin` (and reset accounts) can use the full API without ever changing the password. | `auth.js`, IPC/HTTP auth | Block all non-`change-password` actions while `must_change_pwd = 1`. |
| H4 | **`Book1.xlsx` committed to the repo.** Possible real data pushed to GitHub. | repo root | Confirm contents; if real, `git rm`, scrub history, rotate anything sensitive. |

---

## Medium Priority Issues

| # | Issue | Where | Recommendation |
|---|-------|-------|----------------|
| M1 | **No CSP + heavy `innerHTML`** → stored-XSS surface, worse in LAN-browser mode. | `renderer/*.html`, renderer JS (58 sinks) | Add a strict CSP meta/header; prefer `textContent`/templating for user data. |
| M2 | **No CSRF tokens**; relies solely on `sameSite:lax`. | `server.js` | Add a CSRF token middleware for state-changing routes. |
| M3 | **No security headers / helmet.** | `server.js` | Add `helmet()` (CSP, frameguard, noSniff). |
| M4 | **`sandbox:false` likely unnecessary** — preload loads no native module. | `main.js` | Try `sandbox:true`; keeps defense-in-depth if it works. |
| M5 | **DDL duplicated** between `schema.sql` and `database.js` (pricing tables, view). | `database.js` | Single source of truth; remove inline DDL. |
| M6 | **Session permission staleness** — role/permission edits don't apply until re-login. | `auth.js`/session | Re-resolve permissions per request, or invalidate sessions on user change. |

---

## Low Priority Issues

| # | Issue | Where | Recommendation |
|---|-------|-------|----------------|
| L1 | **Session secret plaintext in DB.** | `server.js` | Documented trade-off; move to an OS-permissioned file if security needs grow. |
| L2 | **`shell.openPath` takes an unrestricted path.** | `preload.js` | Validate/whitelist paths the renderer may open. |
| L3 | **MemoryStore loses sessions on restart**, grows between sweeps. | `server.js` | Fine at scale; switch to a persistent store only if needed. |
| L4 | **No UI pagination**; lists cap at 500/5000 silently. | renderer + `orders.list` | Add paging if datasets grow. |
| L5 | **`SELECT *` from the view everywhere.** | services | Select only needed columns for hot paths. |
| L6 | **`test-lan.js` / ad-hoc scripts** not part of a test suite. | repo root, `scripts/` | Fold into a minimal test runner or remove. |
| L7 | **FK enforcement OFF for whole `init()`.** | `database.js` | Narrow the OFF window to just the migrations that need it. |
| L8 | **Heavy code duplication** (settings helpers, middleware, QR, audit query). | IPC vs HTTP | Extract shared modules (also a refactor item). |

---

## What is genuinely good (don't "fix")

- Single shared service layer behind two transports — clean, consistent.
- Parameterized SQL throughout; XML output escaped.
- Electron hardened correctly (isolation, no node integration, no remote content).
- Permission matrix as a single shared source of truth (the idea is right — it's
  just under-enforced).
- Sensible schema, FKs, indexes, and a pre-joined reporting view.
- DB and secrets correctly kept out of git.
