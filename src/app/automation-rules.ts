import type { CodingDimensions } from "./mock-data";

export const LOCAL_STORAGE_RULES_KEY = "ap-coding-automation-rules-v3";

export type Confidence = "high" | "medium" | "low";

export type SuggestionSource =
  | "Vendor rule"
  | "Same as last bill"
  | "AI rule"
  | "Accounting guidance"
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
