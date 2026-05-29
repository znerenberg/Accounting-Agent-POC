import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  MOCK_HISTORICAL_LINE_ITEMS,
  HistoricalLineItem,
  CodingDimensions,
} from "../../mock-data";
import {
  querySnowflakeHistory,
  type SnowflakeBill,
} from "../../snowflake-history";
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

interface HistoricalDisplayItem {
  description: string;
  amount: number;
  billedAt: string;
  coding: CodingDimensions;
}

type ConsistentCoding = {
  coding: CodingDimensions;
  count: number;
  ratio: number;
  presentDimensions: string[];
};

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
    defaultHeaders: { "x-skip-generative-ai-check": "true" },
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
            `Vendor matched ${rule.vendorName}; line description matched "${rule.matchText}".`
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
            ? `Vendor matched ${rule.vendorName}; line item looked like: ${rule.condition}`
            : `Vendor matched ${rule.vendorName}; line item matched keywords from "${rule.matchText}".`
        )
      );
      break;
    }
  }

  return suggestions;
}

function codingHasGlValue(coding: CodingDimensions): boolean {
  return Boolean(coding.glAccountCode && coding.glAccountCode !== "-");
}

function hasValue(value: string | null | undefined): value is string {
  return Boolean(value && value !== "-");
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

function topValue(
  values: Array<string | null | undefined>,
  options: { minimumCoverage?: number } = {}
) {
  const presentValues = values.filter(hasValue);
  if (presentValues.length < 2) return null;

  const counts = new Map<string, number>();
  for (const value of presentValues) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const [value, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const ratio = count / presentValues.length;
  const coverage = presentValues.length / values.length;

  if (count < 2 || ratio < 0.85 || coverage < (options.minimumCoverage || 0)) {
    return null;
  }

  return { value, count, ratio, coverage };
}

function findConsistentCoding(history: HistoricalDisplayItem[]): ConsistentCoding | null {
  const codedHistory = history.filter((item) => codingHasGlValue(item.coding));
  if (codedHistory.length < 2) return null;

  const gl = topValue(codedHistory.map((item) => item.coding.glAccountCode));
  if (!gl) return null;

  const matchingGlHistory = codedHistory.filter((item) => item.coding.glAccountCode === gl.value);
  const department = topValue(
    matchingGlHistory.map((item) => item.coding.department),
    { minimumCoverage: 0.5 }
  );
  const classValue = topValue(
    matchingGlHistory.map((item) => item.coding.class),
    { minimumCoverage: 0.5 }
  );
  const location = topValue(
    matchingGlHistory.map((item) => item.coding.location),
    { minimumCoverage: 0.5 }
  );
  const presentDimensions = ["GL"];
  if (department) presentDimensions.push("Dept");
  if (classValue) presentDimensions.push("Class");
  if (location) presentDimensions.push("Location");

  return {
    coding: {
      glAccountCode: gl.value,
      glAccountName: `GL ${gl.value}`,
      department: department?.value || null,
      class: classValue?.value || null,
      location: location?.value || null,
    },
    count: gl.count,
    ratio: gl.ratio,
    presentDimensions,
  };
}

function codingSummary(coding: CodingDimensions) {
  const parts = [`GL ${coding.glAccountCode}`];
  if (coding.department) parts.push(`Dept ${coding.department}`);
  if (coding.class) parts.push(`Class ${coding.class}`);
  if (coding.location) parts.push(`Location ${coding.location}`);
  return parts.join(", ");
}

function baselineLabel(consistentCoding: ConsistentCoding) {
  if (consistentCoding.presentDimensions.length === 1) {
    return "GL";
  }

  return consistentCoding.presentDimensions.join("/");
}

function applyConsistentHistory(
  lineItems: RequestLineItem[],
  existingSuggestions: Map<string, CodingSuggestion>,
  consistentCoding: ConsistentCoding | null
) {
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
      evidence: `${percent}% of recent coded bills from this vendor used this ${baselineLabel(consistentCoding)} coding: ${codingSummary(consistentCoding.coding)}.`,
      reasoning:
        "The vendor history is consistent, so this copies the dominant prior coding dimensions for review.",
    });
  }
}

function noteRuleHistoryDifference(
  suggestions: Map<string, CodingSuggestion>,
  consistentCoding: ConsistentCoding | null
) {
  if (!consistentCoding) return;

  const historicalKey = codingKey(consistentCoding.coding);
  for (const [lineItemId, suggestion] of Array.from(suggestions.entries())) {
    if (!suggestion.matchedRuleId || codingKey(suggestion) === historicalKey) continue;

    const percent = Math.round(consistentCoding.ratio * 100);
    suggestions.set(lineItemId, {
      ...suggestion,
      evidence: `${suggestion.evidence} Note: ${percent}% of prior coded bills from this vendor used ${codingSummary(consistentCoding.coding)}, so this saved rule differs from recent history.`,
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

function formatSnowflakeHistoryForPrompt(bills: SnowflakeBill[]): string {
  if (bills.length === 0) return "No historical data available for this vendor.";

  const grouped = new Map<string, { count: number; amounts: number[]; bill: SnowflakeBill }>();
  for (const bill of bills) {
    const description = bill.DESCRIPTION || `Bill from ${bill.VENDOR_NAME}`;
    const key = `${description}|GL:${bill.GL_VALUE || "none"}|Dept:${bill.DEPARTMENT_VALUE || "none"}|Class:${bill.CLASS_VALUE || "none"}|Loc:${bill.LOCATION_VALUE || "none"}`;
    const entry = grouped.get(key) || { count: 0, amounts: [], bill };
    entry.count++;
    entry.amounts.push(parseFloat(bill.AMOUNT) || 0);
    grouped.set(key, entry);
  }

  const lines: string[] = [];
  for (const [, data] of Array.from(grouped.entries())) {
    const avgAmount = data.amounts.reduce((a, b) => a + b, 0) / data.amounts.length;
    const bill = data.bill;
    lines.push(
      `[${data.count}x, avg $${avgAmount.toFixed(0)}] "${bill.DESCRIPTION || `Bill from ${bill.VENDOR_NAME}`}" -> GL ${bill.GL_VALUE || "none"}, Dept: ${bill.DEPARTMENT_VALUE || "N/A"}, Class: ${bill.CLASS_VALUE || "N/A"}, Location: ${bill.LOCATION_VALUE || "N/A"}`
    );
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
    description: b.DESCRIPTION || `Bill from ${b.VENDOR_NAME}`,
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

function normalizeLlmSuggestion(
  raw: Partial<CodingSuggestion>,
  lineItemId: string,
  defaultSource: SuggestionSource = "Historical pattern",
  defaultEvidence = "Compared the new line item against prior vendor coding."
): CodingSuggestion {
  return {
    lineItemId,
    glAccountCode: raw.glAccountCode || "-",
    glAccountName: raw.glAccountName || `GL ${raw.glAccountCode || "-"}`,
    department: raw.department || null,
    class: raw.class || null,
    location: raw.location || null,
    confidence: raw.confidence || "low",
    reasoning: raw.reasoning || "Suggested from historical vendor coding patterns.",
    source: raw.source || defaultSource,
    matchedRuleId: raw.matchedRuleId || null,
    matchedRuleName: raw.matchedRuleName || null,
    evidence: raw.evidence || raw.reasoning || defaultEvidence,
    appliedAutomatically: Boolean(raw.appliedAutomatically),
  };
}

function noCustomerHistorySuggestions(
  lineItems: RequestLineItem[],
  vendorName: string
): CodingSuggestion[] {
  return lineItems.map((lineItem) => ({
    lineItemId: lineItem.id,
    glAccountCode: "-",
    glAccountName: "Needs review",
    department: null,
    class: null,
    location: null,
    confidence: "low",
    source: "Accounting guidance",
    matchedRuleId: null,
    matchedRuleName: null,
    appliedAutomatically: false,
    evidence: `No customer-specific ${vendorName} history was found. Add coding for this line, then save it as a rule if it should apply next time.`,
    reasoning:
      "No customer-specific vendor history or LLM Gateway guidance was available for this line.",
  }));
}

function anthropicAccountingGuidance(lineItem: RequestLineItem): CodingSuggestion | null {
  const description = normalize(lineItem.description);
  const apiUsage =
    description.includes("api") ||
    description.includes("token") ||
    description.includes("model usage") ||
    description.includes("inference");
  const subscription =
    description.includes("subscription") ||
    description.includes("seat") ||
    description.includes("license") ||
    description.includes("team");

  if (apiUsage) {
    const reasoning =
      "API usage for production workflows typically supports direct customer-facing product delivery and is commonly treated as Cost of Revenue, though this recommendation is not based on this customer's prior vendor history.";

    return {
      lineItemId: lineItem.id,
      glAccountCode: "5000",
      glAccountName: "Cost of Revenue - Third Party Services",
      department: null,
      class: null,
      location: null,
      confidence: "medium",
      source: "Accounting guidance",
      matchedRuleId: null,
      matchedRuleName: null,
      appliedAutomatically: false,
      evidence: reasoning,
      reasoning,
    };
  }

  if (subscription) {
    const reasoning =
      "Team subscription seats are employee-focused tools typically classified as operating expense software subscriptions rather than cost of revenue, though this recommendation is not based on this customer's prior vendor history.";

    return {
      lineItemId: lineItem.id,
      glAccountCode: "6200",
      glAccountName: "Software Subscriptions",
      department: null,
      class: null,
      location: null,
      confidence: "medium",
      source: "Accounting guidance",
      matchedRuleId: null,
      matchedRuleName: null,
      appliedAutomatically: false,
      evidence: reasoning,
      reasoning,
    };
  }

  return null;
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

function amountScore(lineAmount: number, historicalAmount: number): number {
  if (!lineAmount || !historicalAmount) return 0;

  const delta = Math.abs(lineAmount - historicalAmount);
  const denominator = Math.max(Math.abs(lineAmount), Math.abs(historicalAmount), 1);
  return Math.max(0, 1 - delta / denominator);
}

function applyLineHistoryMatches(
  lineItems: RequestLineItem[],
  existingSuggestions: Map<string, CodingSuggestion>,
  history: HistoricalDisplayItem[]
) {
  const codedHistory = history.filter((item) => codingHasGlValue(item.coding));

  for (const lineItem of lineItems) {
    if (existingSuggestions.has(lineItem.id)) continue;

    const bestMatch = codedHistory
      .map((item) => ({
        item,
        score:
          textScore(lineItem.description, item.description) +
          amountScore(lineItem.amount, item.amount),
      }))
      .filter(({ score }) => score >= 2)
      .sort((a, b) => b.score - a.score)[0];

    if (!bestMatch) continue;

    existingSuggestions.set(lineItem.id, {
      lineItemId: lineItem.id,
      ...bestMatch.item.coding,
      confidence: bestMatch.score >= 4 ? "high" : "medium",
      source: "Same as last bill",
      matchedRuleId: null,
      matchedRuleName: null,
      appliedAutomatically: false,
      evidence: `Matched prior ${bestMatch.item.billedAt.slice(0, 10)} line "${bestMatch.item.description}" coded as ${codingSummary(bestMatch.item.coding)}.`,
      reasoning:
        "Matched this invoice line to a previously coded line item from the same customer and vendor.",
    });
  }
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

async function suggestFromAccountingGuidance(
  vendorName: string,
  lineItems: RequestLineItem[]
): Promise<CodingSuggestion[]> {
  if (lineItems.length === 0) return [];

  if (normalize(vendorName).includes("anthropic")) {
    const deterministicSuggestions = lineItems.map(anthropicAccountingGuidance);
    if (deterministicSuggestions.every(Boolean)) {
      return deterministicSuggestions as CodingSuggestion[];
    }
  }

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
        content: `You are an accounting automation assistant at a fintech company.

There is no customer-specific bill history for this vendor. Do not claim the customer has coded this vendor before. Provide reviewable accounting guidance based on the line-item description, general accounting treatment, and common SaaS/vendor usage patterns.

VENDOR: ${vendorName}

NEW LINE ITEMS TO CODE:
${lineItemsContext}

Guidance:
- Use at most "medium" confidence because there is no customer-specific history.
- For API usage that directly supports product/customer workflows, Cost of Revenue may be appropriate.
- For employee seats or internal subscriptions, Software Subscriptions or G&A/Engineering software treatment may be appropriate.
- Use null for department, class, or location if they cannot be inferred from the line item itself.
- The reasoning must explicitly say this is not based on this customer's prior vendor history.

Respond ONLY with valid JSON in this exact format:
{
  "suggestions": [
    {
      "lineItemId": "the line item ID from above",
      "glAccountCode": "suggested GL code, or '-' if it needs review",
      "glAccountName": "suggested GL name, or 'Needs review'",
      "department": "department value or null",
      "class": "class value or null",
      "location": "location value or null",
      "confidence": "medium|low",
      "reasoning": "one sentence explaining the accounting guidance and noting no customer-specific history exists"
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
  return (parsed.suggestions || []).map((suggestion) => ({
    ...normalizeLlmSuggestion(
      suggestion,
      suggestion.lineItemId || "",
      "Accounting guidance",
      "No customer-specific vendor history was found; this is accounting guidance for review."
    ),
    confidence: suggestion.confidence === "high" ? "medium" : suggestion.confidence || "low",
    source: "Accounting guidance",
    evidence:
      suggestion.evidence ||
      suggestion.reasoning ||
      "No customer-specific vendor history was found; this is accounting guidance for review.",
  }));
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
    let historicalSource: "snowflake" | "mock" | "none";
    let responseHistoricalItems: HistoricalDisplayItem[] = [];

    if (customerAccountId) {
      const sfResult = querySnowflakeHistory(vendorName, customerAccountId, 120);
      if (sfResult && sfResult.length > 0) {
        historyContext = formatSnowflakeHistoryForPrompt(sfResult);
        historicalSource = "snowflake";
        responseHistoricalItems = snowflakeBillsToHistory(sfResult);
      } else {
        historyContext = `No customer-specific history was found for ${vendorName}.`;
        historicalSource = "none";
        responseHistoricalItems = [];
      }
    } else {
      const historicalItems = findRelevantHistory(vendorName);
      historyContext = formatMockHistoryForPrompt(historicalItems);
      historicalSource = "mock";
      responseHistoricalItems = mockItemsToHistory(historicalItems);
    }

    const userRules = automationRules.filter((rule) => rule.createdBy === "user");
    const seedRules = automationRules.filter((rule) => rule.createdBy !== "user");
    const consistentCoding = findConsistentCoding(responseHistoricalItems);
    const suggestionsByLineItem = applyAutomationRules(vendorName, lineItems, userRules);

    if (historicalSource === "snowflake") {
      noteRuleHistoryDifference(suggestionsByLineItem, consistentCoding);
      applyLineHistoryMatches(lineItems, suggestionsByLineItem, responseHistoricalItems);
      applyConsistentHistory(lineItems, suggestionsByLineItem, consistentCoding);
    } else if (historicalSource === "mock") {
      const seedSuggestions = applyAutomationRules(vendorName, lineItems, seedRules);
      for (const [lineItemId, suggestion] of Array.from(seedSuggestions.entries())) {
        if (!suggestionsByLineItem.has(lineItemId)) {
          suggestionsByLineItem.set(lineItemId, suggestion);
        }
      }

      applyConsistentHistory(lineItems, suggestionsByLineItem, consistentCoding);
    }

    const unresolvedLineItems = lineItems.filter((lineItem) => !suggestionsByLineItem.has(lineItem.id));
    const llmSuggestions = process.env.LLM_GATEWAY_API_KEY
      ? historicalSource === "none"
        ? await suggestFromAccountingGuidance(vendorName, unresolvedLineItems)
        : await suggestFromHistoricalPatterns(vendorName, unresolvedLineItems, historyContext)
      : historicalSource === "none"
        ? noCustomerHistorySuggestions(unresolvedLineItems, vendorName)
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
