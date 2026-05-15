import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import {
  MOCK_HISTORICAL_LINE_ITEMS,
  HistoricalLineItem,
  CodingDimensions,
} from "../../mock-data";
import type {
  AutomationRule,
  CodingSuggestion,
  Confidence,
  SuggestionSource,
} from "../../automation-rules";

interface RequestLineItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
}

interface SnowflakeBill {
  VENDOR_NAME: string;
  PURCHASED_AT: string;
  AMOUNT: string;
  GL_VALUE: string | null;
  DEPARTMENT_VALUE: string | null;
  CLASS_VALUE: string | null;
  LOCATION_VALUE: string | null;
}

interface HistoricalDisplayItem {
  description: string;
  amount: number;
  billedAt: string;
  coding: CodingDimensions;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "item",
  "line",
  "of",
  "or",
  "the",
  "this",
  "to",
  "use",
  "when",
  "with",
]);

function getAnthropicClient() {
  if (!process.env.LLM_GATEWAY_API_KEY) {
    throw new Error("LLM_GATEWAY_API_KEY is not configured");
  }

  return new Anthropic({
    baseURL: process.env.LLM_GATEWAY_URL || "https://llm.staging.brexapps.io/gateway/anthropic",
    apiKey: process.env.LLM_GATEWAY_API_KEY,
  });
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function vendorMatches(ruleVendorName: string, vendorName: string): boolean {
  const ruleVendor = normalize(ruleVendorName);
  const vendor = normalize(vendorName);
  return vendor === ruleVendor || vendor.includes(ruleVendor) || ruleVendor.includes(vendor);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s,-]/g, " ")
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function matchScore(rule: AutomationRule, lineItem: RequestLineItem): number {
  const description = normalize(lineItem.description);

  if (rule.type === "vendor_default") {
    return 1;
  }

  const matchText = normalize(rule.matchText || "");
  if (rule.type === "description_match" && matchText) {
    return description.includes(matchText) ? 5 : 0;
  }

  const searchText = `${rule.matchText || ""} ${rule.condition || ""}`;
  const keywords = tokenize(searchText);
  return keywords.filter((keyword) => description.includes(keyword)).length;
}

function rankedRules(rules: AutomationRule[], vendorName: string): AutomationRule[] {
  const priority: Record<AutomationRule["type"], number> = {
    ai_semantic: 0,
    description_match: 1,
    vendor_default: 2,
  };

  return rules
    .filter((rule) => rule.enabled && vendorMatches(rule.vendorName, vendorName))
    .sort((a, b) => priority[a.type] - priority[b.type]);
}

function suggestionFromRule(
  rule: AutomationRule,
  lineItem: RequestLineItem,
  confidence: Confidence,
  evidence: string
): CodingSuggestion {
  const source: SuggestionSource = rule.type === "ai_semantic" ? "AI rule" : "Vendor rule";
  return {
    lineItemId: lineItem.id,
    ...rule.coding,
    confidence,
    source,
    matchedRuleId: rule.id,
    matchedRuleName: rule.name,
    evidence,
    appliedAutomatically: false,
    reasoning:
      rule.type === "ai_semantic"
        ? `Matched the saved natural-language rule "${rule.name}" for this vendor.`
        : `Matched the saved vendor rule "${rule.name}" for this vendor.`,
  };
}

function applyAutomationRules(
  vendorName: string,
  lineItems: RequestLineItem[],
  rules: AutomationRule[]
): Map<string, CodingSuggestion> {
  const suggestions = new Map<string, CodingSuggestion>();
  const candidateRules = rankedRules(rules, vendorName);

  for (const lineItem of lineItems) {
    for (const rule of candidateRules) {
      const score = matchScore(rule, lineItem);
      if (score <= 0) continue;

      if (rule.type === "vendor_default") {
        suggestions.set(
          lineItem.id,
          suggestionFromRule(
            rule,
            lineItem,
            "high",
            `Vendor matched ${rule.vendorName}; rule fills the default coding for review.`
          )
        );
        break;
      }

      if (rule.type === "description_match") {
        suggestions.set(
          lineItem.id,
          suggestionFromRule(
            rule,
            lineItem,
            "high",
            `Line description matched "${rule.matchText}".`
          )
        );
        break;
      }

      suggestions.set(
        lineItem.id,
        suggestionFromRule(
          rule,
          lineItem,
          score >= 2 ? "high" : "medium",
          rule.condition
            ? `Matched natural-language condition: ${rule.condition}`
            : `Matched keywords from "${rule.matchText}".`
        )
      );
      break;
    }
  }

  return suggestions;
}

function codingKey(coding: CodingDimensions): string {
  return [
    coding.glAccountCode,
    coding.glAccountName,
    coding.department || "",
    coding.class || "",
    coding.location || "",
  ].join("|");
}

function findConsistentCoding(history: HistoricalDisplayItem[]): {
  coding: CodingDimensions;
  count: number;
  ratio: number;
} | null {
  if (history.length < 2) return null;

  const grouped = new Map<string, { coding: CodingDimensions; count: number }>();
  for (const item of history) {
    const key = codingKey(item.coding);
    const group = grouped.get(key) || { coding: item.coding, count: 0 };
    group.count++;
    grouped.set(key, group);
  }

  const top = Array.from(grouped.values()).sort((a, b) => b.count - a.count)[0];
  const ratio = top.count / history.length;
  if (top.count >= 2 && ratio >= 0.85) {
    return { coding: top.coding, count: top.count, ratio };
  }

  return null;
}

function applyConsistentHistory(
  lineItems: RequestLineItem[],
  existingSuggestions: Map<string, CodingSuggestion>,
  history: HistoricalDisplayItem[]
) {
  const consistentCoding = findConsistentCoding(history);
  if (!consistentCoding) return;

  const percent = Math.round(consistentCoding.ratio * 100);
  for (const lineItem of lineItems) {
    if (existingSuggestions.has(lineItem.id)) continue;

    existingSuggestions.set(lineItem.id, {
      lineItemId: lineItem.id,
      ...consistentCoding.coding,
      confidence: consistentCoding.ratio >= 0.95 ? "high" : "medium",
      source: "Same as last bill",
      matchedRuleId: null,
      matchedRuleName: null,
      appliedAutomatically: false,
      evidence: `${percent}% of recent line items from this vendor used this same coding.`,
      reasoning:
        "The vendor history is consistent, so this copies the dominant prior coding for review.",
    });
  }
}

function findRelevantHistory(vendorName: string): HistoricalLineItem[] {
  const normalizedVendor = normalize(vendorName);

  const exactMatches = MOCK_HISTORICAL_LINE_ITEMS.filter(
    (item) => normalize(item.vendorName) === normalizedVendor
  );

  if (exactMatches.length > 0) return exactMatches;

  const vendorWords = normalizedVendor.split(/\s+/).filter((w) => w.length > 3);
  return MOCK_HISTORICAL_LINE_ITEMS.filter((item) => {
    const itemVendor = normalize(item.vendorName);
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
  for (const [key, data] of Array.from(grouped.entries())) {
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
  for (const [, group] of Array.from(grouped.entries())) {
    const rep = group[0];
    lines.push(
      `[${group.length}x] "${rep.description}" -> GL ${rep.coding.glAccountCode} (${rep.coding.glAccountName}), Dept: ${rep.coding.department || "N/A"}, Class: ${rep.coding.class || "N/A"}, Location: ${rep.coding.location || "N/A"}`
    );
  }
  return lines.join("\n");
}

function snowflakeBillsToHistory(bills: SnowflakeBill[]): HistoricalDisplayItem[] {
  return bills.map((b) => ({
    description: `Bill from ${b.VENDOR_NAME}`,
    amount: parseFloat(b.AMOUNT) || 0,
    billedAt: b.PURCHASED_AT,
    coding: {
      glAccountCode: b.GL_VALUE || "-",
      glAccountName: `GL ${b.GL_VALUE || "-"}`,
      department: b.DEPARTMENT_VALUE,
      class: b.CLASS_VALUE,
      location: b.LOCATION_VALUE,
    },
  }));
}

function mockItemsToHistory(items: HistoricalLineItem[]): HistoricalDisplayItem[] {
  return items.map((item) => ({
    description: item.description,
    amount: item.amount,
    billedAt: item.billedAt,
    coding: item.coding,
  }));
}

function normalizeLlmSuggestion(raw: Partial<CodingSuggestion>, lineItemId: string): CodingSuggestion {
  return {
    lineItemId,
    glAccountCode: raw.glAccountCode || "-",
    glAccountName: raw.glAccountName || `GL ${raw.glAccountCode || "-"}`,
    department: raw.department || null,
    class: raw.class || null,
    location: raw.location || null,
    confidence: raw.confidence || "low",
    reasoning: raw.reasoning || "Suggested from historical vendor coding patterns.",
    source: raw.source || "Historical pattern",
    matchedRuleId: raw.matchedRuleId || null,
    matchedRuleName: raw.matchedRuleName || null,
    evidence: raw.evidence || raw.reasoning || "Compared the new line item against prior vendor coding.",
    appliedAutomatically: Boolean(raw.appliedAutomatically),
  };
}

function textScore(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  let score = 0;

  for (const token of Array.from(aTokens)) {
    if (bTokens.has(token)) score++;
  }

  if (normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a))) {
    score += 3;
  }

  return score;
}

function suggestFromLocalHistory(
  lineItems: RequestLineItem[],
  history: HistoricalDisplayItem[]
): CodingSuggestion[] {
  return lineItems.map((lineItem) => {
    const bestMatch = history
      .map((item) => ({ item, score: textScore(lineItem.description, item.description) }))
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch && bestMatch.score > 0) {
      return {
        lineItemId: lineItem.id,
        ...bestMatch.item.coding,
        confidence: bestMatch.score >= 3 ? "high" : "medium",
        source: "Historical pattern",
        matchedRuleId: null,
        matchedRuleName: null,
        appliedAutomatically: false,
        evidence: `Local match to prior line "${bestMatch.item.description}".`,
        reasoning:
          "Matched this line to the closest prior bill line because the LLM Gateway key is not configured.",
      };
    }

    return {
      lineItemId: lineItem.id,
      glAccountCode: "-",
      glAccountName: "Needs review",
      department: null,
      class: null,
      location: null,
      confidence: "low",
      source: "Historical pattern",
      matchedRuleId: null,
      matchedRuleName: null,
      appliedAutomatically: false,
      evidence:
        "No saved rule or close historical match was found. Add the coding once, then save it as a rule.",
      reasoning:
        "The app did not have enough local context to code this line without the LLM Gateway.",
    };
  });
}

async function suggestFromHistoricalPatterns(
  vendorName: string,
  lineItems: RequestLineItem[],
  historyContext: string
): Promise<CodingSuggestion[]> {
  if (lineItems.length === 0) return [];

  const lineItemsContext = lineItems
    .map(
      (li) =>
        `- ID: ${li.id} | Description: "${li.description}" | Amount: $${li.amount.toLocaleString()} ${li.currency}`
    )
    .join("\n");

  const message = await getAnthropicClient().messages.create({
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
    throw new Error("Unexpected response format");
  }

  const cleanedText = content.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  const parsed = JSON.parse(cleanedText) as { suggestions?: Partial<CodingSuggestion>[] };
  return (parsed.suggestions || []).map((suggestion) =>
    normalizeLlmSuggestion(suggestion, suggestion.lineItemId || "")
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      vendorName,
      customerAccountId,
      automationRules = [],
    }: {
      vendorName?: string;
      customerAccountId?: string;
      automationRules?: AutomationRule[];
    } = body;
    const lineItems = (body.lineItems || []) as RequestLineItem[];

    if (!vendorName || lineItems.length === 0) {
      return NextResponse.json({ error: "vendorName and lineItems are required" }, { status: 400 });
    }

    let historyContext: string;
    let historicalSource: "snowflake" | "mock";
    let responseHistoricalItems: HistoricalDisplayItem[] = [];

    if (customerAccountId) {
      const sfResult = querySnowflakeHistory(vendorName, customerAccountId);
      if (sfResult && sfResult.length > 0) {
        historyContext = formatSnowflakeHistoryForPrompt(sfResult);
        historicalSource = "snowflake";
        responseHistoricalItems = snowflakeBillsToHistory(sfResult);
      } else {
        const historicalItems = findRelevantHistory(vendorName);
        historyContext = formatMockHistoryForPrompt(historicalItems);
        historicalSource = "mock";
        responseHistoricalItems = mockItemsToHistory(historicalItems);
      }
    } else {
      const historicalItems = findRelevantHistory(vendorName);
      historyContext = formatMockHistoryForPrompt(historicalItems);
      historicalSource = "mock";
      responseHistoricalItems = mockItemsToHistory(historicalItems);
    }

    const suggestionsByLineItem = applyAutomationRules(vendorName, lineItems, automationRules);
    applyConsistentHistory(lineItems, suggestionsByLineItem, responseHistoricalItems);

    const unresolvedLineItems = lineItems.filter((lineItem) => !suggestionsByLineItem.has(lineItem.id));
    const llmSuggestions = process.env.LLM_GATEWAY_API_KEY
      ? await suggestFromHistoricalPatterns(vendorName, unresolvedLineItems, historyContext)
      : suggestFromLocalHistory(unresolvedLineItems, responseHistoricalItems);

    for (const suggestion of llmSuggestions) {
      if (suggestion.lineItemId) {
        suggestionsByLineItem.set(suggestion.lineItemId, suggestion);
      }
    }

    return NextResponse.json({
      vendorName,
      suggestions: lineItems
        .map((lineItem) => suggestionsByLineItem.get(lineItem.id))
        .filter(Boolean),
      historicalItems: responseHistoricalItems,
      historicalCount: responseHistoricalItems.length,
      dataSource: historicalSource,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
