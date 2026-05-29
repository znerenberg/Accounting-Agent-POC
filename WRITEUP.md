# Accounting Agent PoC — Project Summary

## What this is

An AI-powered proof of concept that automates GL coding for Bill Pay invoices. It takes a new bill, looks at how past bills from the same vendor were coded, and suggests appropriate GL accounts, departments, classes, and locations for each line item.

**Repo:** https://github.com/mmoran-netizen/Accounting-Agent-POC
**Local path:** `~/src/bill-coding-demo`
**Runs at:** http://localhost:3456

## What it does, end to end

1. **Upload an invoice** (PDF or image). Claude reads the document via vision and extracts the vendor name and each line item with description and amount.
2. **Pre-fill the form.** The extracted data populates editable fields so you can review or correct it.
3. **Look up historical context.** Either from hardcoded sample data (6 vendors with realistic coding) or live from Snowflake's `EXPENSES_V2` tables for a specific customer account.
4. **Suggest coding.** Claude reasons about how each line item should be coded based on the historical patterns and returns suggestions with confidence levels (high/medium/low) and one-sentence explanations.
5. **Display results** alongside the historical patterns the AI based its reasoning on.

## What we built (in order)

1. **Started in the Brex monorepo** — a `bill-coding` NestJS module under `ai/llm/src/modules/` matching the existing AI service patterns. Got it as far as routing logic + tests, then realized testing it would require Bazel + the full service.
2. **Pivoted to a standalone Next.js app** — single self-contained project that can be tested with one command. Lives in `~/src/bill-coding-demo` (not in the monorepo).
3. **Built the suggest-coding endpoint** — takes a vendor + line items, finds matches in mock data, calls Claude with the historical patterns as context, returns structured suggestions.
4. **Wired up the LLM Gateway** — replaced direct Anthropic API calls with the Brex internal proxy at `https://llm.production.brexapps.io/gateway/anthropic`. The Anthropic SDK supports a custom `baseURL`, so this was a one-line config change.
5. **Built the front-end UI** — vendor input, line item editor, results panel showing suggestions + confidence + reasoning + the historical bills used.
6. **Added invoice upload + extraction** — drag-and-drop a PDF/image, Claude vision extracts the line items, form pre-fills.
7. **Generated sample invoices** — `sample-invoice-aws.pdf` (works with mock data) and `sample-invoice-cdw.pdf` saved to your Desktop (works with the live Snowflake CDW Canada customer).
8. **Wired up live Snowflake** — added a Customer Account ID field. When provided, the app shells out to `snow sql -c brex` to query that customer's actual coded bill history. Falls back to mock data otherwise. Shows a "Live Snowflake" badge in the UI when using real data.
9. **Pushed to GitHub** — public repo at the link above. `.env.local` is gitignored so the API key stays local.

## Architecture

```
src/app/
├── page.tsx                          # Front-end UI
├── mock-data.ts                      # Hardcoded sample bills (~25 line items, 6 vendors)
├── layout.tsx
└── api/
    ├── extract-invoice/route.ts      # Claude vision: file → vendor + line items
    ├── suggest-coding/route.ts       # Claude: vendor + line items → coding suggestions
    └── history/route.ts              # Snowflake: customer + vendor → bill history
```

**Stack:** Next.js 14, TypeScript, `@anthropic-ai/sdk` (pointed at the LLM Gateway), `snow` CLI subprocess for Snowflake, `pdfkit` for sample invoice generation.

**Snowflake tables used:**
- `EXPENSES_V2.EXPENSES_V2.EXPENSES` — bills, filter `EXPENSE_TYPE = 'BILLPAY'`
- `EXPENSES_V2.EXPENSES_V2.VENDORS` — vendor names
- `EXPENSES_V2.EXPENSES_V2.EXTENSIBLE_FIELDS_EXTENDED_FIELD_VALUES` — coding values keyed by `gl_account_*`, `department_*`, `class_*`, `location_*`

## Setup from scratch

If you ever clone fresh from GitHub on a new machine:

```bash
# 1. Clone the repo
git clone https://github.com/mmoran-netizen/Accounting-Agent-POC.git
cd Accounting-Agent-POC

# 2. Install dependencies (one-time)
npm install

# 3. Create your config file with your LLM Gateway key
cat > .env.local <<'EOF'
LLM_GATEWAY_URL=https://llm.production.brexapps.io/gateway/anthropic
LLM_GATEWAY_API_KEY=llm_gateway_token_YOUR_SECRET_HERE
EOF
```

Then edit `.env.local` and replace `YOUR_SECRET_HERE` with a real token from `go/llm-gateway` → Manage API Keys → Create a new API Key (copy the secret on the creation screen — you can't see it again later).

## Daily startup

If the dev server is already running and you just want to use it:
- Open http://localhost:3456 in your browser

If it's not running:
```bash
cd ~/src/bill-coding-demo
npm run dev
```

Then open http://localhost:3456.

If port 3456 is stuck in use:
```bash
kill $(lsof -t -i:3456); npm run dev
```

## Optional: enable live Snowflake data

To use real customer bill history instead of mock data:

```bash
# Authenticate Snowflake via SSO (browser will pop open)
snow sql -c brex -q "SELECT 1"
```

As long as your SSO session stays active, the app can call Snowflake. If your Snowflake CLI connection is not named `brex`, set `SNOWFLAKE_CONNECTION=<connection-name>` in `.env.local`. Then when using the UI, paste a Customer Account ID like `cuacc_cl1bul55b000401qmifxrd70e` (CDW Canada has 1,933 bills for that customer).

## How to demo it

1. Open http://localhost:3456
2. Drag `sample-invoice-cdw.pdf` (on your Desktop) into the upload area
3. Wait a few seconds while Claude extracts the line items
4. (Optional) Paste `cuacc_cl1bul55b000401qmifxrd70e` in the Customer Account ID field for live Snowflake
5. Click "Suggest Coding"
6. See the AI-suggested GL/department/class/location for each line item, plus the historical patterns it used

## Known limitations / next steps

- **Coding values are numeric IDs** when from Snowflake (e.g., `96`, `201`). Each customer's chart of accounts maps these IDs to readable names, but that mapping isn't in Snowflake — it's in the extensible fields service config. Resolving names would make suggestions more readable.
- **No feedback loop.** Suggestions aren't recorded, so the system can't learn from accept/reject signals over time.
- **Vendor matching is exact + word-prefix only.** Embedding-based similarity would catch fuzzier variations.
- **Snowflake auth uses your local SSO session.** Fine for a local PoC, not viable for a deployed service — that would need a service account or PAT with appropriate scoping.
- **No persistence.** Each request is independent; uploaded invoices and suggestions aren't saved anywhere.

## Costs & considerations

- Each invoice extraction = 1 Claude vision call (Sonnet 4.5)
- Each coding suggestion = 1 Claude text call
- Both go through the LLM Gateway, which means they're billed/tracked through your gateway API key
- Snowflake queries use the `COMPUTE_XSMALL_WH` warehouse (your default)
