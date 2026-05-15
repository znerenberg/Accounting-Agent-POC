import type { CodingDimensions } from "./mock-data";

export const LOCAL_STORAGE_RULES_KEY = "ap-coding-automation-rules-v2";

export type Confidence = "high" | "medium" | "low";

export type SuggestionSource =
  | "Vendor rule"
  | "Same as last bill"
  | "AI rule"
  | "Historical pattern";

export type AutomationRuleType =
  | "vendor_default"
  | "description_match"
  | "ai_semantic";

export interface AutomationRule {
  id: string;
  name: string;
  type: AutomationRuleType;
  vendorName: string;
  enabled: boolean;
  matchText?: string;
  condition?: string;
  coding: CodingDimensions;
  createdBy: "seed" | "user";
}

export interface CodingSuggestion extends CodingDimensions {
  lineItemId: string;
  confidence: Confidence;
  reasoning: string;
  source: SuggestionSource;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  evidence: string;
  appliedAutomatically: boolean;
}

export const SAMPLE_VENDORS = [
  "Anthropic",
  "Amazon Web Services",
  "Baker McKenzie LLP",
  "Datadog",
  "Gusto",
  "Salesforce",
  "WeWork",
];

export const SEEDED_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: "seed-anthropic-api",
    name: "Anthropic API usage -> COGS",
    type: "ai_semantic",
    vendorName: "Anthropic",
    enabled: true,
    matchText: "api, usage, token, tokens, model, calls, platform, inference",
    condition:
      "Use this when the Anthropic line item is for API calls, token usage, model usage, or platform consumption.",
    coding: {
      glAccountCode: "5100",
      glAccountName: "Cost of Goods Sold - AI Usage",
      department: "Engineering",
      class: "Cost of Revenue",
      location: "US - San Francisco",
    },
    createdBy: "seed",
  },
  {
    id: "seed-anthropic-subscription",
    name: "Claude subscriptions -> Software",
    type: "ai_semantic",
    vendorName: "Anthropic",
    enabled: true,
    matchText: "claude, subscription, team, seats, user, license, plan",
    condition:
      "Use this when the Anthropic line item is for Claude subscriptions, seats, user licenses, or a recurring team plan.",
    coding: {
      glAccountCode: "6210",
      glAccountName: "Software Subscriptions",
      department: "Engineering",
      class: "General & Administrative",
      location: "US - San Francisco",
    },
    createdBy: "seed",
  },
  {
    id: "seed-datadog-default",
    name: "Datadog default coding",
    type: "vendor_default",
    vendorName: "Datadog",
    enabled: true,
    coding: {
      glAccountCode: "6210",
      glAccountName: "Software Subscriptions",
      department: "Engineering",
      class: "Platform",
      location: "US - San Francisco",
    },
    createdBy: "seed",
  },
  {
    id: "seed-salesforce-marketing",
    name: "Salesforce Marketing Cloud",
    type: "description_match",
    vendorName: "Salesforce",
    enabled: true,
    matchText: "marketing cloud",
    coding: {
      glAccountCode: "6210",
      glAccountName: "Software Subscriptions",
      department: "Marketing",
      class: "Growth",
      location: "US - San Francisco",
    },
    createdBy: "seed",
  },
];
