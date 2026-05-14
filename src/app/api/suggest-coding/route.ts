import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { MOCK_HISTORICAL_LINE_ITEMS, HistoricalLineItem } from "../../mock-data";

const anthropic = new Anthropic({
  baseURL: process.env.LLM_GATEWAY_URL || "https://llm.staging.brexapps.io/gateway/anthropic",
  apiKey: process.env.LLM_GATEWAY_API_KEY || "",
});

interface SnowflakeBill {
  VENDOR_NAME: string;
  PURCHASED_AT: string;
  AMOUNT: string;
  GL_VALUE: string | null;
  DEPARTMENT_VALUE: string | null;
  CLASS_VALUE: string | null;
  LOCATION_VALUE: string | null;
}

function findRelevantHistory(vendorName: string): HistoricalLineItem[] {
  const normalizedVendor = vendorName.toLowerCase().trim();

  const exactMatches = MOCK_HISTORICAL_LINE_ITEMS.filter(
    (item) => item.vendorName.toLowerCase().trim() === normalizedVendor
  );

  if (exactMatches.length > 0) return exactMatches;

  const vendorWords = normalizedVendor.split(/\s+/).filter((w) => w.length > 3);
  return MOCK_HISTORICAL_LINE_ITEMS.filter((item) => {
    const itemVendor = item.vendorName.toLowerCase();
    return vendorWords.some((word) => itemVendor.includes(word));
  });
}

function querySnowflakeHistory(vendorName: string, customerAccountId: string): SnowflakeBill[] | null {
  try {
    const escapedVendor = vendorName.replace(/'/g, "''");
    const escapedCustomer = customerAccountId.replace(/'/g, "''");

    const query = `SELECT v.NAME as VENDOR_NAME, e.PURCHASED_AT, GET_PATH(e.BILLING_AMOUNT, 'quantity') as AMOUNT, MAX(CASE WHEN efv.KEY LIKE 'gl_account_%' THEN efv.VALUE END) as GL_VALUE, MAX(CASE WHEN efv.KEY LIKE 'department_%' THEN efv.VALUE END) as DEPARTMENT_VALUE, MAX(CASE WHEN efv.KEY LIKE 'class_%' THEN efv.VALUE END) as CLASS_VALUE, MAX(CASE WHEN efv.KEY LIKE 'location_%' THEN efv.VALUE END) as LOCATION_VALUE FROM EXPENSES_V2.EXPENSES_V2.EXPENSES e JOIN EXPENSES_V2.EXPENSES_V2.VENDORS v ON v.ID = e.VENDORS_VENDOR_ID LEFT JOIN EXPENSES_V2.EXPENSES_V2.EXTENSIBLE_FIELDS_EXTENDED_FIELD_VALUES efv ON efv.SOURCE_OBJECT_ID = e.ID AND efv.SOURCE_OBJECT_TYPE = 'EXPENSE' AND (efv.KEY LIKE 'gl_account_%' OR efv.KEY LIKE 'department_%' OR efv.KEY LIKE 'class_%' OR efv.KEY LIKE 'location_%') WHERE e.EXPENSE_TYPE = 'BILLPAY' AND e.CUSTOMER_ACCOUNT_ID = '${escapedCustomer}' AND LOWER(v.NAME) LIKE LOWER('%${escapedVendor}%') GROUP BY v.NAME, e.PURCHASED_AT, e.BILLING_AMOUNT, e.ID ORDER BY e.PURCHASED_AT DESC LIMIT 30`;

    const result = execSync(
      `snow sql -c brex -q "${query}" --format json`,
      { encoding: "utf-8", timeout: 60000 }
    );

    return JSON.parse(result);
  } catch {
    return null;
  }
}

function formatSnowflakeHistoryForPrompt(bills: SnowflakeBill[]): string {
  if (bills.length === 0) return "No historical data available for this vendor.";

  const grouped = new Map<string, { count: number; amounts: number[] }>();
  for (const bill of bills) {
    const key = `GL:${bill.GL_VALUE || "none"}|Dept:${bill.DEPARTMENT_VALUE || "none"}|Class:${bill.CLASS_VALUE || "none"}|Loc:${bill.LOCATION_VALUE || "none"}`;
    const entry = grouped.get(key) || { count: 0, amounts: [] };
    entry.count++;
    entry.amounts.push(parseFloat(bill.AMOUNT) || 0);
    grouped.set(key, entry);
  }

  const lines: string[] = [];
  for (const [key, data] of grouped) {
    const avgAmount = data.amounts.reduce((a, b) => a + b, 0) / data.amounts.length;
    lines.push(`[${data.count}x, avg $${avgAmount.toFixed(0)}] Coded as: ${key}`);
  }
  return lines.join("\n");
}

function formatMockHistoryForPrompt(items: HistoricalLineItem[]): string {
  if (items.length === 0) return "No historical data available for this vendor.";

  const grouped = new Map<string, HistoricalLineItem[]>();
  for (const item of items) {
    const key = `${item.coding.glAccountCode}|${item.description}`;
    const group = grouped.get(key) || [];
    group.push(item);
    grouped.set(key, group);
  }

  const lines: string[] = [];
  for (const [, group] of grouped) {
    const rep = group[0];
    lines.push(
      `[${group.length}x] "${rep.description}" → GL ${rep.coding.glAccountCode} (${rep.coding.glAccountName}), Dept: ${rep.coding.department || "N/A"}, Class: ${rep.coding.class || "N/A"}, Location: ${rep.coding.location || "N/A"}`
    );
  }
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vendorName, lineItems, customerAccountId } = body;

    if (!vendorName || !lineItems || lineItems.length === 0) {
      return NextResponse.json({ error: "vendorName and lineItems are required" }, { status: 400 });
    }

    // Try Snowflake first if customer_account_id provided, fall back to mock data
    let historyContext: string;
    let historicalSource: "snowflake" | "mock";
    let historicalItems: HistoricalLineItem[] = [];
    let snowflakeBills: SnowflakeBill[] = [];

    if (customerAccountId) {
      const sfResult = querySnowflakeHistory(vendorName, customerAccountId);
      if (sfResult && sfResult.length > 0) {
        snowflakeBills = sfResult;
        historyContext = formatSnowflakeHistoryForPrompt(sfResult);
        historicalSource = "snowflake";
      } else {
        historicalItems = findRelevantHistory(vendorName);
        historyContext = formatMockHistoryForPrompt(historicalItems);
        historicalSource = "mock";
      }
    } else {
      historicalItems = findRelevantHistory(vendorName);
      historyContext = formatMockHistoryForPrompt(historicalItems);
      historicalSource = "mock";
    }

    const lineItemsContext = lineItems
      .map(
        (li: { id: string; description: string; amount: number; currency: string }) =>
          `- ID: ${li.id} | Description: "${li.description}" | Amount: $${li.amount.toLocaleString()} ${li.currency}`
      )
      .join("\n");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are an accounting automation assistant at a fintech company. Based on how this vendor's past bills were coded, suggest GL coding for new line items.

VENDOR: ${vendorName}

HISTORICAL CODING PATTERNS (how past bills from this vendor were coded):
${historyContext}

NEW LINE ITEMS TO CODE:
${lineItemsContext}

For each new line item, suggest the most appropriate coding based on the historical patterns.
- If a line item closely matches a historical pattern, use "high" confidence.
- If it partially matches or you're inferring from similar items, use "medium" confidence.
- If there's no clear match but you can guess from the vendor's general pattern, use "low" confidence.

Respond ONLY with valid JSON in this exact format:
{
  "suggestions": [
    {
      "lineItemId": "the line item ID from above",
      "glAccountCode": "the GL value/code from the patterns",
      "glAccountName": "descriptive name if known, otherwise 'GL [value]'",
      "department": "department value or null",
      "class": "class value or null",
      "location": "location value or null",
      "confidence": "high|medium|low",
      "reasoning": "one sentence explaining why this coding was chosen based on the historical patterns"
    }
  ]
}`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected response format" }, { status: 500 });
    }

    const cleanedText = content.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleanedText);

    // Build response based on data source
    const responseHistoricalItems = historicalSource === "snowflake"
      ? snowflakeBills.map((b) => ({
          description: `Bill from ${b.VENDOR_NAME}`,
          amount: parseFloat(b.AMOUNT) || 0,
          billedAt: b.PURCHASED_AT,
          coding: {
            glAccountCode: b.GL_VALUE || "—",
            glAccountName: `GL ${b.GL_VALUE || "—"}`,
            department: b.DEPARTMENT_VALUE,
            class: b.CLASS_VALUE,
            location: b.LOCATION_VALUE,
          },
        }))
      : historicalItems.map((item) => ({
          description: item.description,
          amount: item.amount,
          billedAt: item.billedAt,
          coding: item.coding,
        }));

    return NextResponse.json({
      vendorName,
      suggestions: parsed.suggestions,
      historicalItems: responseHistoricalItems,
      historicalCount: responseHistoricalItems.length,
      dataSource: historicalSource,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
