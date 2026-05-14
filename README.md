# Accounting Agent POC

A proof-of-concept AI agent that suggests GL coding for Bill Pay invoices based on how past bills from the same vendor were coded.

## What it does

1. **Upload an invoice** (PDF or image) — Claude extracts vendor name and line items via vision
2. **Look up historical patterns** — pulls past coded bills for that vendor (mock data, or live Snowflake)
3. **Suggest coding** — Claude reasons about how each new line item should be coded (GL account, department, class, location) with confidence levels and explanations

Built as a Next.js app that calls the **Brex LLM Gateway** (the internal proxy to Anthropic).

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your LLM Gateway key

Create `.env.local` in the project root:

```
LLM_GATEWAY_URL=https://llm.production.brexapps.io/gateway/anthropic
LLM_GATEWAY_API_KEY=llm_gateway_token_your_secret_here
```

Get a key from the LLM Gateway Retool UI (`go/llm-gateway` → Manage API Keys → Create a new API Key). Copy the secret token (`llm_gateway_token_...`) shown at creation time.

### 3. (Optional) Snowflake for live historical data

To use real historical bill coding from Snowflake instead of mock data:

```bash
# Authenticate via SSO (browser will pop open)
snow sql -c brex -q "SELECT 1"
```

The app calls `snow` via subprocess in the API route. As long as your SSO session is active, it'll work.

### 4. Run it

```bash
npm run dev
```

Open [http://localhost:3456](http://localhost:3456).

## How to use the demo

1. **Upload an invoice** — try `sample-invoice-cdw.pdf` (provided) or any invoice PDF/image
2. **Optionally enter a Customer Account ID** for live Snowflake data (e.g. `cuacc_cl1bul55b000401qmifxrd70e` has CDW DIRECT history)
3. **Click "Suggest Coding"** — Claude returns suggestions per line item, alongside the historical patterns it used

If no customer account ID is provided, it uses hardcoded sample data covering AWS, WeWork, Salesforce, Baker McKenzie, Datadog, and Gusto.

## Architecture

```
src/app/
├── page.tsx                          # Front-end UI (upload + form + results)
├── mock-data.ts                      # Hardcoded historical bills (~25 line items, 6 vendors)
├── layout.tsx
└── api/
    ├── extract-invoice/route.ts      # POST: file → vendor + line items (Claude vision)
    ├── suggest-coding/route.ts       # POST: vendor + line items → coding suggestions
    └── history/route.ts              # GET: customer + vendor → Snowflake bill history
```

### Data flow

1. **Front-end** sends invoice file to `/api/extract-invoice`
2. **Extract route** wraps the file as a base64 image/document block, calls Claude via the LLM Gateway, parses structured JSON
3. **Front-end** pre-fills form, user reviews and clicks Suggest
4. **Suggest route** queries history (Snowflake if customer ID provided, else mock), formats patterns, calls Claude, returns suggestions

### Snowflake schema used

- `EXPENSES_V2.EXPENSES_V2.EXPENSES` — bills (filter `EXPENSE_TYPE = 'BILLPAY'`)
- `EXPENSES_V2.EXPENSES_V2.VENDORS` — vendor names
- `EXPENSES_V2.EXPENSES_V2.EXTENSIBLE_FIELDS_EXTENDED_FIELD_VALUES` — coding values, keyed by `gl_account_*`, `department_*`, `class_*`, `location_*`

## Sample invoices

- `sample-invoice-aws.pdf` — AWS bill with EC2/S3/Lambda/Support items (works with mock data)
- `sample-invoice-cdw.pdf` — CDW Canada bill with hardware/software/services items (designed for the `cuacc_cl1bul55b000401qmifxrd70e` customer account)

## Limitations / next steps

- Coding values from Snowflake are numeric IDs (e.g. `96`, `201`) referencing each customer's chart of accounts. The human-readable names live in extensible fields config that isn't in Snowflake. Resolving those names would make suggestions more readable.
- No feedback loop — suggestions aren't recorded, so the system doesn't learn from accept/reject signals.
- Vendor matching is exact + word-prefix only. Embedding-based similarity could catch fuzzy variations (e.g. "Amazon Web Svcs" → "Amazon Web Services").
- Snowflake auth uses the user's SSO session via `snow` CLI — fine for a local PoC, not viable for a deployed service.
