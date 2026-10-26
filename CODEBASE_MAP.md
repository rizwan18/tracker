# CODEBASE_MAP.md

Australian personal finance, investment and tax-year tracker (npm workspaces monorepo: React frontend + Express/Prisma backend, deployed to Vercel).

> **How this map was made.** The Shares & ETFs area (investments, holdings, price refresh, P&L) was read in detail. Other areas (properties, bills, Company Finance, CSV/backup) are listed from the file layout and README only, so check the code before relying on details there.

## 1. Layout

```
api/index.ts        Vercel serverless entry: wraps backend createApp()
backend/            Express + TypeScript REST API, Prisma ORM, Vitest tests
  prisma/           schema.prisma, seed.ts
  src/app.ts        Express app (routes mounted under /api)
  src/routes/       one file per resource (investments, capitalGains, marketData, dividends, ...)
  src/services/     business logic (holdings, shareSales, marketPriceRefresh, calculations, business/*, dataTransfer/*)
  src/lib/          pure helpers (decimal, capitalGains, marketData, marketHours, priceRefreshPolicy, shareSale, validation, financialYear, ...)
  src/tests/        Vitest suites
frontend/           React 19 + Vite + Tailwind v4 (oxlint, Vitest)
  src/pages/        one page per screen
  src/components/   shared UI (ui.tsx primitives, HoldingsTable, PnlSummaryCards, SecurityPriceCheckPanel, ...)
  src/lib/          pure helpers (format, holdings, pnl, money, ...)
  src/api/          client.ts (fetch wrapper, ApiError), types.ts
  src/tests/        Vitest suites (pnl, components)
scripts/db-sync.js  DB sync used by the Vercel build
vercel.json         build + rewrites (/api/* -> /api, everything else -> index.html)
```

Commands (repo root): `npm run dev`, `npm run build`, `npm test` (backend then frontend), `npm run test:frontend`. Frontend lint: `cd frontend && npx oxlint`.

## 2. Shares & ETFs: data flow

```
Prisma: Investment, InvestmentTransaction (BUY/SELL, + frozen *Cents on recorded sales, optional brokerAccountId), BrokerAccount, InvestmentValuation, Dividend
   │
   ▼
backend/src/services/holdings.ts
   replayLedger()          THE average-cost calculation (cost base, units, realised sales)
   computeHoldingSummary() quantity, costBase, currentValue, unrealisedGainLoss,
                           realisedGain, realisedLoss, realisedCostBase, closed
   │
   ▼
GET /api/investments  (routes/investments.ts)  → Investment[] each with `summary`
POST /api/investments/refresh-market-prices    → services/marketPriceRefresh.ts
   (server-throttled: 1/min per holding while market open, 1/24h while closed; always 204)
   │
   ▼
frontend pages/InvestmentsPage.tsx
   ├─ lib/pnl.ts  summarisePnl()  → components/PnlSummaryCards.tsx   (Realised / Unrealised P&L)
   ├─ components/SecurityPriceCheckPanel.tsx                           (blue "Check Security Price" panel)
   ├─ components/HoldingsTable.tsx  (uses lib/pnl.ts resolveMarketPosition; units come from the ledger)
   ├─ components/TransactionsTable.tsx  (one list of buys + sells; rows from `transactionRows`)
   └─ components/SellSharesDialog.tsx → services/shareSales.ts
```

**Accounting method:** average cost across everything held at the sale date; brokerage is added to a buy's cost and deducted from a sale's proceeds. Recorded sales store frozen figures that are never recalculated.

**Currencies:** ASX holdings are A$; Wall St holdings are US$. There is no FX conversion anywhere, so totals must not mix them (the P&L cards keep them separate).

## 3. Feature → file map (Shares & ETFs)

| Feature | Frontend | Backend |
|---|---|---|
| Shares & ETFs screen | `pages/InvestmentsPage.tsx` | `routes/investments.ts` |
| Realised / Unrealised P&L cards | `components/PnlSummaryCards.tsx`, `lib/pnl.ts` | `services/holdings.ts` (`computeHoldingSummary`) |
| Holdings table (open + closed, Available units, Sell button) | `components/HoldingsTable.tsx` | `routes/investments.ts` |
| Unified buy/sell transactions table (filters, sort, mobile cards) | `components/TransactionsTable.tsx`, `lib/transactions.ts` | `services/holdings.ts` (`transactionRowsOf`, same replay as holdings) |
| Broker accounts (dropdown, add/edit/remove) | `components/BrokerAccountSelect.tsx`, `components/BrokerAccountsManager.tsx`, `lib/brokers.ts`, `lib/useBrokerAccounts.ts` | `routes/brokerAccounts.ts`, `services/brokerAccounts.ts`, `BrokerAccount` model, `InvestmentTransaction.brokerAccountId` |
| Sell shares | `components/SellSharesDialog.tsx`, `lib/sale.ts` | `services/shareSales.ts`, `lib/shareSale.ts` |
| Sales by financial year (formerly "View Trades"), route `/investments/realised` | `pages/RealisedTransactionsPage.tsx` | `routes/capitalGains.ts`, `lib/capitalGains.ts` |
| Check Security Price panel | `components/SecurityPriceCheckPanel.tsx` | `routes/investments.ts` (refresh) |
| Security price lookup page, `/investments/price-lookup` | `pages/SecurityPriceLookupPage.tsx` | `routes/marketData.ts`, `lib/marketData.ts` |
| Automatic price refresh policy | n/a | `services/marketPriceRefresh.ts`, `lib/priceRefreshPolicy.ts`, `lib/marketHours.ts` |
| Crypto / managed funds / term deposits | `pages/CryptoManagedFundsPage.tsx` (still has its own View Trades button) | `routes/investments.ts` |
| Add / edit holding, valuations | `components/InvestmentForm.tsx`, `HoldingValuationForm.tsx`, `InvestmentTransactionForm.tsx`, `pages/InvestmentDetailPage.tsx` | `routes/investments.ts` |
| Dividends | `components/DividendForm.tsx` | `routes/dividends.ts` |

## 4. Other areas (by file layout only)

Properties, bills, holidays, reminders, Money (income/expenses), Reports, Import/Export & backup, Contacts and the Company Finance ledger (`services/business/*`, `pages/business/*`) each have their own routes/pages. See README "Product overview" and "Architecture".

## 5. Design conventions

- Tokens in `frontend/src/index.css`: eucalyptus (primary/positive), brick (negative), ochre (warning), sky (info), plus fixed `--brand-blue*` that is never re-themed (used by the price-check panel).
- Primitives in `components/ui.tsx` (Card, Button, SectionHeading, HelpText, Alert, StatTile ...). No icon library; the nav uses emoji and the new panel uses inline SVG.
- Unlayered `:focus-visible` rule in `index.css` beats Tailwind utilities, so focus colour changes need a CSS rule (see `.on-brand-blue`).

## 6. Tests

- Backend `backend/src/tests` (Vitest): ledger replay, share sales, investments summary, capital gains, market data, price refresh policy, etc. `expenseReminders.test.ts` needs a generated Prisma client.
- Frontend `frontend/src/tests` (Vitest, node, no DOM): `pnl.test.ts` (calculation), `components.test.tsx` (server-rendered card/panel states).

## 7. Known limitations

- Holdings are tracked per security, not per broker account: average cost pools every account, and a broker account is a label on each trade. Backup/restore (`/api/data`) does not include broker accounts yet.

- Backend suites that import Prisma need `prisma generate` (needs network access to Prisma's binary host).
- "Total portfolio value" on the Shares screen sums every investment type and both currencies (unchanged, flagged).
- Manually entered capital-gain disposals (Reports) appear on the sales-by-financial-year page but are not part of the Realised P&L card, which covers recorded buy/sell history only.
