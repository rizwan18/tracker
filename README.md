# Revenue Expense Tracker

A simple Australian personal finance, investment and tax-year organiser for retail investors, property investors, retirees and pensioners. It is **not** accounting software and does **not** give tax or financial advice — it helps you record, organise, remind, understand and report on your own finances, in plain English, on the Australian financial year (1 July – 30 June).

## Product overview

- **Dashboard** — kept as light as possible, with pictures and rings instead of paragraphs: a greeting and two buttons (*Add income or expense*, *Your data*); **Your year so far** as one ring (green = left over, red = spent, with 💰 money in / 🛒 money out); **Where your money is** as a ring with an icon key (🏠 home, 🏘️ investment property, 📈 shares, 💼 other); a **Property snapshot** with one headline bar (what you own of the total) and a photo-and-bar for each property (its main picture, or a house symbol; solid = you own, striped = you owe, green = investment, blue = PPR); and three-item *Coming up* / *Latest activity* lists. Only the first alert is shown. The financial year is shown small and muted on the right (label, a thin progress line, days to go and the true end date). Everything else is one click away in Reports and the other pages. Backup/restore lives on its own **Your data** page.
- **Portfolios** — the setup page asks what you want to set up: **1. Personal Finance, 2. Company Finance, 3. Trust Finance, 4. Other Type** (pick one or more). Each portfolio keeps completely separate records. **Only if you have more than one**, a selection page appears before the dashboard (after signing in, and in each new browser tab) so you choose which to open; with a single portfolio it goes straight to the dashboard. Add or rename portfolios any time in Settings; the sidebar shows the open portfolio and a *Switch portfolio* link. The browser sends its choice as `X-Portfolio-Id`, which the server accepts only for portfolios you belong to. A principal place of residence is only available in Personal Finance portfolios (and the one-PPR-per-person rule spans all your portfolios).
- **Small-business accounting (Company Finance portfolios)** — a double-entry bookkeeping module for Australian small businesses. Record **sales** (invoices) and **expenses** (bills) with **GST** worked out for you (includes / plus / none), mark them paid, and the app posts balanced ledger entries automatically. Add owner contributions, drawings, loans, depreciation and opening balances as **journal** entries, and keep a **chart of accounts** (a standard Australian one is provided; add your own). Reports for any financial year or date range: **income statement (P&L)**, **balance sheet**, **trial balance**, **GST/BAS summary** (G1, G3, 1A, G10, G11, 1B; cash or accrual basis), **owed to you / you owe** (aged by days overdue), **cash & bank**, **monthly**, and **general ledger** — each downloadable as CSV or printable to PDF. Money is stored as whole cents, so totals are exact and the balance sheet always balances. ABN is validated. Business details and GST settings are in Settings. Not tax advice; only Company Finance portfolios show this module. *Not yet included:* the CSV data backup does not yet cover the business ledger (use each report's CSV download), and payments are all-or-nothing (no part-payments).
- **Properties** — track one or more investment properties: rent, expenses, net rental income, estimated equity and rental yield.
  - **Investment property or principal place of residence (PPR)** — you're asked which when adding a property, and it's colour coded everywhere (Investment = green, PPR = blue, always with a text label): Properties page, dashboard property snapshot and the property page. **A person can only have one PPR** — the form disables the PPR option if you already have one and the server refuses a second (change the old one to an investment property if you move). Rental income, expenses, reports and the investment portfolio cover investment properties only; a PPR shows its running costs, value, loan and equity instead of a rental schedule. Properties saved before this feature are treated as investment properties.
  - **Tabs** — each property page has **Summary** (headline figures, property details and **pictures**), **Income/Expense** (the rental schedule and every entry), **Property manager** (investment properties only) and **Bills & reminders** (bills for the property plus upcoming payments).
  - **Property manager** — name, agency, email, **office website**, office phone, **mobile number**, **ABN** (checked), office address and notes for the managing agent, with one-tap *Email*, *Call office*, *Call mobile*, *Website* and *Office on map* links. The same manager on several properties? **Copy details from another property** with a dropdown, or tick **Also use these details for other properties** and save to give each one a copy (each property keeps its own copy, so you can re-apply after a change). Starts from the property's older "rental agent" field if no manager has been saved yet. Websites are limited to http/https.
  - **Pictures & icon** — add up to 12 pictures per property (choose files or drop them on the card). They are shrunk in the browser first (full size ≤1600px plus a 360px thumbnail), checked on the server from the file's own bytes (JPEG/PNG/WebP only), and only ever served back through the signed-in API. The picture marked **Main** becomes the property's **icon** beside its name and on the Properties list; any picture can be made the main one. Manager details and picture links are included in the CSV backup.
  - **Rental income & expenses schedule** — on each property's page, per financial year: ownership percentage, date the property was available for rent, weeks rented, then a list of income and expense lines (rental income, council rates, capital allowances, insurance, interest on loans, land tax, agent fees, capital works, water charges, …) with total income, total expenses and **net rent**. The list is configurable per property — add any income or expense type, or remove ones that don't apply, at any time. Lines are backed by ordinary transactions, so the schedule always agrees with the dashboard and reports; the full list of entries sits underneath and each line has a **+ Add** shortcut. Amounts worked out elsewhere (capital allowances / capital works from a depreciation schedule) are flagged "manually calculated".
  - **Bills & reminders** for the property (council rates, water, insurance…) with due-date reminders.
- **Investments** — shares, ETFs, managed funds, term deposits and more, with buy/sell history, cost base, unrealised/realised gain-loss, and dividend/franking-credit tracking. Each investment also has an **Income & expenses** section for interest, distributions, fees and other costs.
- **Capital gains** — disposals from your buy/sell history are calculated automatically; disposals for anything not tracked that way (a private sale, a collectible, a holding from before you started using this app) can be recorded manually and are persisted alongside the automatic ones, feeding into the same dashboard figures and reports.
- **Your data: download and import (CSV)** — the dashboard's *Your data* card downloads **everything** (details, accounts, categories, income & expenses, properties and rental schedules, investments, buys/sells, dividends, capital gains, bills, reminders and document links) as one CSV file with named sections (`[transactions]`, `[properties]`, …). Importing the same file later brings it all back: you get a summary first, only **missing** items are added and nothing existing is changed, so importing twice is safe. Categories and accounts are matched by name (no duplicated defaults), ids that belong to someone else's data are replaced with stable new ones, the person importing becomes the owner of imported properties, and a second PPR is imported as an investment property. Rows with problems are skipped and listed; the file can be edited in Excel/Sheets (names can be used instead of ids, dates like 19/09/2026 are understood). Passwords are never exported and email/password are never changed by an import. Limits: about 4 MB per file / 25,000 rows; document *files* stay in storage and only their links are in the CSV.
- **Bills & Reminders** — recurring bills with automatic due-date rollover and reminders (snooze, complete, dismiss). Any expense you record with a **future date** also gets a reminder automatically (shown under Reminders and on the property's *Bills & reminders* tab); editing the date or deleting the entry keeps the reminder in step.
- **Reports** — financial year, tax information summary, property and investment reports, with CSV export for your accountant.
- **Easy View** — a larger-text, simplified mode for anyone who prefers less on the screen.

This app deliberately avoids automatically deciding what is tax-deductible. It only ever suggests a **potential tax category** and always tells you to review it with a registered tax professional.

## Architecture

```
revenue-expense-tracker/
├── api/         Vercel serverless entry point (wraps the Express app)
├── backend/     Node.js + TypeScript + Express REST API, Prisma ORM
├── frontend/    React + TypeScript + Vite + Tailwind CSS
├── package.json npm workspaces root — one install, one `npm run dev`
└── vercel.json  single-project Vercel config
```

**Backend** (`backend/`)
- `src/lib/financialYear.ts` — the Australian financial-year engine (1 Jul–30 Jun), timezone-aware, leap-year-safe, fully unit tested. Every other calculation in the app depends on this being correct.
- `src/lib/billRecurrence.ts` — pure date-advancement logic for recurring bills, also unit tested.
- `src/services/calculations.ts` — the single source of truth for every total shown anywhere in the app (dashboard, reports, tax summary). Nothing else computes totals independently, so numbers can't drift between screens.
- `src/routes/*` — one file per resource (auth, transactions, properties, investments, dividends, capital gains, bills, reminders, dashboard, reports, search, documents).
- `prisma/schema.prisma` — the full relational data model.

**Frontend** (`frontend/`)
- `src/context/` — Auth and Financial Year React contexts (the financial-year selector is global and affects every screen).
- `src/components/ui.tsx` — small design-system primitives (Card, Button, StatTile, EmptyState, HelpText tooltips for jargon).
- `src/pages/` — one page per navigation item.

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router |
| Backend | Node.js, TypeScript, Express |
| Database | PostgreSQL in production (Neon); SQLite optional for local dev — see "Database setup & migrations" |
| ORM | Prisma |
| Auth | JWT bearer tokens, bcrypt password hashing, password-reset token architecture |
| Validation | Zod |
| Testing | Vitest (unit tests) |

### Why the schema avoids native enums

`schema.prisma` defaults to PostgreSQL (matching production), but deliberately avoids Postgres-only or SQLite-only quirks like native enums and arrays, so the same schema also works unmodified against SQLite for quick local development (see "Database setup & migrations" below for both options). "Enum-like" fields (transaction direction, bill frequency, investment type, etc.) are validated in the application layer instead (`src/lib/constants.ts` + `src/lib/validation.ts`), which also makes them easy to extend without a migration.

## Installation

Requires Node.js 20+. The repo is a single npm-workspaces project, so there is **one** install for both the frontend and the backend:

```
git clone https://github.com/rizwan18/tracker.git
cd tracker
npm install        # installs everything and runs `prisma generate`
```

**Quick start**

```
cp backend/.env.example backend/.env    # then fill in DATABASE_URL, DIRECT_URL, JWT_SECRET
npm run prisma:push                     # create the tables
npm run prisma:seed                     # optional demo data
npm run dev                             # API + frontend together
```

## Environment variables

Only the backend needs an env file; the frontend needs none (it calls relative `/api/*` URLs):

```
cp backend/.env.example backend/.env
```

See `backend/.env.example` for the full list (`DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `PORT`). **Generate a real `JWT_SECRET` for anything beyond local development** — e.g. `openssl rand -base64 48`.

## Database setup & migrations

The schema defaults to PostgreSQL (matching production — see "Deploying to Vercel" below). For local development you have two options:

**Option A — local Postgres or a free Neon dev branch (recommended, matches production exactly):** put the connection strings in `backend/.env` (`DATABASE_URL` and `DIRECT_URL` can be the same string if you're not using a pooler), then create the tables:

```
npm run prisma:push        # quickest: creates all tables from the schema
# or, to create a versioned migration instead:
npm run prisma:migrate -- --name init
```

**Option B — SQLite (zero external services):** temporarily edit `backend/prisma/schema.prisma`:

```
datasource db {
  provider = "sqlite"   // was "postgresql"
  url      = env("DATABASE_URL")
}
```

and set `DATABASE_URL="file:./dev.db"` in `backend/.env` (no `DIRECT_URL` needed; delete the `directUrl` line too). Then run `npm run prisma:push`. Don't commit this schema change — switch back to `postgresql` before deploying.

## Seed data

Realistic **fictional** Australian demo data (two properties, shares, ETFs, dividends, franking credits, household bills, upcoming reminders):

```bash
npm run prisma:seed
```

Demo login: `demo@example.com` / `DemoPassword123!`

## Running the development servers

One command starts both the API and the frontend:

```
npm run dev
# API       http://localhost:4000
# Frontend  http://localhost:5173  (open this one; it proxies /api to the API)
```

Individual servers: `npm run dev:backend` and `npm run dev:frontend`.

Document uploads always go to Vercel Blob (even in local dev) — set `BLOB_READ_WRITE_TOKEN` in `backend/.env` if you want to test that flow locally.

## Testing

```bash
npm test
```

Current coverage focuses on the areas correctness matters most, all as dependency-free pure-function unit tests: the Australian financial-year engine (30 June/1 July boundary at the second, leap years, timezone handling, FY id parsing/formatting — 18 tests), bill recurrence date advancement (5 tests), and manual capital gains disposal math — cost base, proceeds, gain/loss, ownership-percentage splitting for joint ownership, and holding-period calculation (5 tests). 28 tests total. See `backend/src/tests/`.
**Recommended next testing steps** (not yet included, to keep this build focused): integration tests against a real database (Vitest + a test Postgres/SQLite instance), React Testing Library component tests, and Playwright end-to-end tests covering the full "create account → add property → generate report" flow from section 33 of the product brief.

## Deploying to Vercel

The frontend and API deploy together as **one Vercel project** from the repository root: Vercel serves `frontend/dist` as static files and runs the Express app as a single serverless function (`api/[...path].ts`). Because both live on the same domain there is no CORS setup and no `VITE_API_BASE_URL` to configure.

### 1. Set up a production database (Neon Postgres)

Vercel's serverless functions can't use SQLite (no persistent local disk), so production uses PostgreSQL. [Neon](https://neon.tech) is Vercel's recommended serverless-friendly Postgres provider (there's also a direct Neon integration in the Vercel dashboard's Storage tab, which sets these env vars for you automatically).

1. Create a Neon project and database.
2. Copy the **pooled** connection string (via PgBouncer) → this is `DATABASE_URL`.
3. Copy the **unpooled/direct** connection string → this is `DIRECT_URL` (used only for creating tables / migrations).

### 2. Create the tables

**Automatic:** every *production* build on Vercel runs `prisma db push` (via `npm run db:sync`) as long as `DIRECT_URL` is set, so the tables are created/updated on deploy. Prisma refuses destructive changes without `--accept-data-loss`, so a risky schema change fails the build instead of dropping data.

**Manual alternative**, from your own machine:

```
cd backend
DATABASE_URL="<your Neon pooled URL>" DIRECT_URL="<your Neon direct URL>" npx prisma db push
```

`db push` creates every table from `prisma/schema.prisma`. Once you want versioned migrations, run `npm run prisma:migrate -- --name init` against a dev database, commit the generated `backend/prisma/migrations/` folder, and from then on use `npx prisma migrate deploy` for production.

### 3. Deploy the project

Create **one** Vercel project from this repo:

- **Root Directory**: leave as the repository root
- **Framework Preset**: Other (the settings in the root `vercel.json` — install command, build command, output directory, SPA rewrite — are picked up automatically)
- **Environment variables**: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `NODE_ENV=production`
- **Storage**: in the project's **Storage** tab create a **Blob** store and connect it; Vercel injects `BLOB_READ_WRITE_TOKEN` automatically.

`npm install` at the root runs `prisma generate` (via the root `postinstall`), so the Postgres-targeted Prisma Client is always built fresh for the deployment.

### What changed from local dev

|                 | Local dev                                           | Vercel production                                           |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Database        | Local Postgres / Neon dev branch (or SQLite)        | PostgreSQL (Neon)                                           |
| File uploads    | Vercel Blob (`BLOB_READ_WRITE_TOKEN`)               | Vercel Blob                                                 |
| Backend process | Long-running `tsx` process (`src/server.ts`)        | Single serverless function per request (`api/[...path].ts`) |
| Frontend → API  | Vite dev-server proxy (relative `/api/*`)           | Same domain, relative `/api/*`                              |

Cold starts are worth knowing about: the first request after idle will be slower (new Postgres connection + Prisma engine init). The Prisma Client singleton in `backend/src/lib/prisma.ts` is reused across warm invocations of the same function instance, which helps.

## Production build (self-hosted alternative)

The whole app runs as **one process on one port**: the Express server also serves the built frontend.

```
npm run build   # builds frontend/dist and compiles backend/dist
npm start       # http://localhost:4000 — API at /api/*, frontend at /
```

Set `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` and `NODE_ENV=production` in the environment (or `backend/.env`) first, and create the tables once with `npm run prisma:deploy` (or `npm run prisma:push` — see "Database setup").

## Deployment considerations

- **Database**: production uses PostgreSQL by default now (see "Deploying to Vercel" above); SQLite is for local development/demo only, and requires temporarily editing `prisma/schema.prisma`'s `provider`.
- **File storage**: production uploads go to Vercel Blob (`src/routes/documents.ts`). If you deploy the backend somewhere other than Vercel, swap that file to S3/Azure Blob/GCS instead — the pattern (upload buffer → store URL → stream back through an authenticated route) carries over directly.
- **Email**: password reset currently returns the raw token directly in the API response in non-production environments so the flow is testable end-to-end without email configured. Wire up a real provider (Postmark, SES, etc.) in `src/routes/auth.ts` before going to production, and remove the `devOnlyToken` field.
- **Reminders**: bill "overdue" status is refreshed lazily whenever bills are listed. For timely push/email reminders, add a scheduled job — Vercel Cron Jobs are a natural fit here — that scans `Reminder` rows due today and sends a notification.
- Put the API behind HTTPS (Vercel does this automatically); set `NODE_ENV=production`.

## Security considerations

- Passwords hashed with bcrypt (12 salt rounds); password-reset tokens are stored only as bcrypt hashes, are single-use, and expire after 1 hour.
- Every data route re-derives `householdId` from the authenticated user's database record (never trusts a client-supplied id), and every Prisma query is scoped by `householdId` — one household can never read another's data.
- Zod validates all input; a friendly-error middleware ensures raw database/internal errors are never shown to users.
- Uploaded documents are served only via an authenticated, ownership-checked download route — never a raw static file path.

## A note on this sandbox's limitations

This project was built and type-checked in a network-restricted sandbox that cannot reach `binaries.prisma.sh` (Prisma's engine CDN). Two consequences:

1. Live database migrations and the running server could not be verified end-to-end in that environment.
2. Because `prisma generate` never completes successfully, `@prisma/client` falls back to a minimal stub where `PrismaClient` is typed as `any`. This means `tsc` passing on Prisma-touching route files confirms the code is syntactically valid TypeScript, but does **not** confirm real Prisma type safety (e.g. a typo'd field name on a `prisma.investment.findMany({...})` call would not be caught here). The parts of the codebase that don't touch Prisma — the financial-year engine, bill recurrence, and capital gains math — have no such caveat: they're pure functions with dependency-free unit tests that genuinely pass.

Both resolve automatically on any machine with normal internet access (`npx prisma generate` there produces a fully-typed client); there is nothing unusual about this project's Prisma setup. Worth running `npx tsc --noEmit` again yourself after your first real `prisma generate`, just to catch anything this sandbox couldn't.

## Important disclaimer

This application is a record-keeping and planning tool. It is not tax or financial advice. Figures such as "potential tax category", "estimated equity", "rental yield" and CGT discount eligibility are informational only. Always review your records with a registered tax professional or licensed financial adviser before lodging a tax return or making investment decisions.
