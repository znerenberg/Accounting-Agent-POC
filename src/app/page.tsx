"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CodingDimensions } from "./mock-data";
import {
  LOCAL_STORAGE_RULES_KEY,
  SAMPLE_VENDORS,
  SEEDED_AUTOMATION_RULES,
  type AutomationRule,
  type AutomationRuleType,
  type CodingSuggestion,
} from "./automation-rules";

interface LineItemInput {
  id: string;
  description: string;
  amount: string;
}

interface HistoricalItem {
  description: string;
  amount: number;
  billedAt: string;
  coding: CodingDimensions;
}

interface ApiResponse {
  vendorName: string;
  suggestions: CodingSuggestion[];
  historicalItems: HistoricalItem[];
  historicalCount: number;
  dataSource?: "snowflake" | "mock";
}

interface RuleDraft {
  lineItemId: string;
  type: AutomationRuleType;
  vendorName: string;
  name: string;
  matchText: string;
  condition: string;
  coding: CodingDimensions;
}

const blankLineItem = (index: number): LineItemInput => ({
  id: `li_${index}`,
  description: "",
  amount: "",
});

const sourceStyles: Record<CodingSuggestion["source"], { bg: string; color: string }> = {
  "Vendor rule": { bg: "#eef2ff", color: "#3730a3" },
  "AI rule": { bg: "#ecfdf5", color: "#047857" },
  "Same as last bill": { bg: "#fef3c7", color: "#92400e" },
  "Historical pattern": { bg: "#f3f4f6", color: "#374151" },
};

function confidenceColor(confidence: string) {
  if (confidence === "high") return "#15803d";
  if (confidence === "medium") return "#a16207";
  return "#b91c1c";
}

function confidenceBg(confidence: string) {
  if (confidence === "high") return "#dcfce7";
  if (confidence === "medium") return "#fef9c3";
  return "#fee2e2";
}

function ruleConditionSummary(rule: AutomationRule) {
  const vendorCondition = `IF vendor is ${rule.vendorName}`;

  if (rule.type === "vendor_default") {
    return vendorCondition;
  }

  if (rule.type === "description_match") {
    return `${vendorCondition} AND line item contains "${rule.matchText || ""}"`;
  }

  return `${vendorCondition} AND line item is like "${rule.matchText || rule.condition || ""}"`;
}

function lineItemDescription(lineItems: LineItemInput[], lineItemId: string) {
  return lineItems.find((li) => li.id === lineItemId)?.description || lineItemId;
}

function shortMatchText(description: string) {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !["with", "from", "this", "that"].includes(word));

  return words.slice(0, 3).join(" ") || description;
}

function codingKey(coding: CodingDimensions) {
  return [
    coding.glAccountCode,
    coding.glAccountName,
    coding.department || "",
    coding.class || "",
    coding.location || "",
  ].join("|");
}

function hasMixedHistoricalCoding(history: HistoricalItem[]) {
  return new Set(history.map((item) => codingKey(item.coding))).size > 1;
}

export default function Home() {
  const [vendorName, setVendorName] = useState("");
  const [customerAccountId, setCustomerAccountId] = useState("");
  const [lineItems, setLineItems] = useState<LineItemInput[]>([blankLineItem(1)]);
  const [savedRules, setSavedRules] = useState<AutomationRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const rawRules = window.localStorage.getItem(LOCAL_STORAGE_RULES_KEY);
      if (rawRules) {
        setSavedRules(JSON.parse(rawRules) as AutomationRule[]);
      }
    } catch {
      setSavedRules([]);
    } finally {
      setRulesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!rulesLoaded) return;
    window.localStorage.setItem(LOCAL_STORAGE_RULES_KEY, JSON.stringify(savedRules));
  }, [savedRules, rulesLoaded]);

  const automationRules = useMemo(
    () => [...SEEDED_AUTOMATION_RULES, ...savedRules],
    [savedRules]
  );

  const activeRules = automationRules.filter((rule) => rule.enabled);

  const addLineItem = () => {
    setLineItems([...lineItems, blankLineItem(lineItems.length + 1)]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItemInput, value: string) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const loadDemo = (demo: "anthropic" | "datadog" | "salesforce") => {
    setResult(null);
    setError(null);
    setUploadedFileName(null);

    if (demo === "anthropic") {
      setVendorName("Anthropic");
      setLineItems([
        { id: "li_1", description: "API calls - Claude model token usage", amount: "18200" },
        { id: "li_2", description: "Claude Team subscription - 12 seats", amount: "360" },
      ]);
      return;
    }

    if (demo === "datadog") {
      setVendorName("Datadog");
      setLineItems([
        { id: "li_1", description: "Infrastructure monitoring - Pro plan", amount: "8900" },
      ]);
      return;
    }

    setVendorName("Salesforce");
    setLineItems([
      { id: "li_1", description: "Marketing Cloud - email campaigns", amount: "3200" },
      { id: "li_2", description: "Sales Cloud Enterprise - 50 seats", amount: "7500" },
    ]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);
    setUploadedFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("invoice", file);

      const response = await fetch("/api/extract-invoice", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to extract invoice");
      }

      const data = await response.json();

      if (data.vendorName) {
        setVendorName(data.vendorName);
      }

      if (data.lineItems && data.lineItems.length > 0) {
        setLineItems(
          data.lineItems.map((li: { description: string; amount: number }, i: number) => ({
            id: `li_${i + 1}`,
            description: li.description,
            amount: li.amount.toString(),
          }))
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to process invoice");
      setUploadedFileName(null);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setRuleDraft(null);

    try {
      const response = await fetch("/api/suggest-coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName,
          customerAccountId: customerAccountId || undefined,
          automationRules: activeRules,
          lineItems: lineItems
            .filter((li) => li.description.trim())
            .map((li) => ({
              id: li.id,
              description: li.description,
              amount: parseFloat(li.amount) || 0,
              currency: "usd",
            })),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Request failed");
      }

      const data = await response.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const updateSuggestion = (
    lineItemId: string,
    field: keyof CodingDimensions,
    value: string
  ) => {
    setResult((current) => {
      if (!current) return current;

      return {
        ...current,
        suggestions: current.suggestions.map((suggestion) => {
          if (suggestion.lineItemId !== lineItemId) return suggestion;

          return {
            ...suggestion,
            [field]:
              field === "glAccountCode" || field === "glAccountName"
                ? value
                : value || null,
          };
        }),
      };
    });
  };

  const defaultRuleType = (suggestion: CodingSuggestion): AutomationRuleType => {
    const matchedRule = automationRules.find((rule) => rule.id === suggestion.matchedRuleId);
    if (matchedRule) return matchedRule.type;

    if (suggestion.source === "AI rule") return "ai_semantic";
    if (suggestion.source === "Same as last bill" || suggestion.source === "Vendor rule") {
      return "vendor_default";
    }

    if (suggestion.source === "Historical pattern" && hasMixedHistoricalCoding(result?.historicalItems || [])) {
      return "ai_semantic";
    }

    return "description_match";
  };

  const startRuleDraft = (suggestion: CodingSuggestion) => {
    const description = lineItemDescription(lineItems, suggestion.lineItemId);
    const matchedRule = automationRules.find((rule) => rule.id === suggestion.matchedRuleId);
    const type = defaultRuleType(suggestion);

    setRuleDraft({
      lineItemId: suggestion.lineItemId,
      type,
      vendorName: matchedRule?.vendorName || vendorName.trim(),
      name: matchedRule?.name || (type === "vendor_default"
          ? `${vendorName} default coding`
          : `${vendorName} - ${shortMatchText(description)}`),
      matchText:
        type === "vendor_default" ? "" : matchedRule?.matchText || shortMatchText(description),
      condition:
        type === "ai_semantic"
          ? matchedRule?.condition || `Use this when a ${vendorName} line item means ${description}.`
          : "",
      coding: {
        glAccountCode: suggestion.glAccountCode,
        glAccountName: suggestion.glAccountName,
        department: suggestion.department,
        class: suggestion.class,
        location: suggestion.location,
      },
    });
  };

  const updateRuleDraftCoding = (field: keyof CodingDimensions, value: string) => {
    setRuleDraft((draft) => {
      if (!draft) return draft;
      return {
        ...draft,
        coding: {
          ...draft.coding,
          [field]:
            field === "glAccountCode" || field === "glAccountName"
              ? value
              : value || null,
        },
      };
    });
  };

  const saveRuleDraft = () => {
    if (!ruleDraft || !ruleDraft.vendorName.trim()) return;
    if (ruleDraft.type !== "vendor_default" && !ruleDraft.matchText.trim()) return;

    const newRule: AutomationRule = {
      id: `user-${Date.now()}`,
      name: ruleDraft.name.trim() || `${ruleDraft.vendorName} coding rule`,
      type: ruleDraft.type,
      vendorName: ruleDraft.vendorName.trim(),
      enabled: true,
      matchText:
        ruleDraft.type === "vendor_default" ? undefined : ruleDraft.matchText.trim(),
      condition:
        ruleDraft.type === "ai_semantic" ? ruleDraft.condition.trim() : undefined,
      coding: ruleDraft.coding,
      createdBy: "user",
    };

    setSavedRules((rules) => [...rules, newRule]);
    setRuleDraft(null);
  };

  const toggleSavedRule = (ruleId: string) => {
    setSavedRules((rules) =>
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
      )
    );
  };

  const removeSavedRule = (ruleId: string) => {
    setSavedRules((rules) => rules.filter((rule) => rule.id !== ruleId));
  };

  return (
    <main className="app-shell">
      <div className="header">
        <div>
          <h1>Bill Coding Assistant</h1>
          <p>Reviewable AP coding automation from vendor history and saved rules</p>
        </div>
        <div className="demo-actions">
          <span>Load demo:</span>
          <button onClick={() => loadDemo("anthropic")}>Anthropic API vs seats</button>
          <button onClick={() => loadDemo("datadog")}>Datadog vendor default</button>
          <button onClick={() => loadDemo("salesforce")}>Salesforce mixed lines</button>
        </div>
      </div>

      <div className={result ? "workspace has-results" : "workspace"}>
        <section className="left-column">
          <div className="panel">
            <div className="panel-header">
              <h2>Upload Invoice</h2>
              {uploadedFileName && <span className="status-pill success">Extracted</span>}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />

            <div
              className={uploading ? "drop-zone disabled" : "drop-zone"}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add("dragging");
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove("dragging");
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("dragging");
                const file = e.dataTransfer.files[0];
                if (file && fileInputRef.current) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  fileInputRef.current.files = dt.files;
                  fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }}
            >
              {uploading ? (
                <div>
                  <strong>Extracting line items</strong>
                  <span>This may take a few seconds</span>
                </div>
              ) : uploadedFileName ? (
                <div>
                  <strong>{uploadedFileName}</strong>
                  <span>Click or drop to replace</span>
                </div>
              ) : (
                <div>
                  <strong>Drop invoice here</strong>
                  <span>PDF, PNG, JPG, or WebP</span>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Bill Details</h2>
              <span className="muted-label">{activeRules.length} active rules</span>
            </div>

            <label>Vendor</label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="Amazon Web Services"
              list="vendor-suggestions"
            />
            <datalist id="vendor-suggestions">
              {SAMPLE_VENDORS.map((vendor) => (
                <option key={vendor} value={vendor} />
              ))}
            </datalist>

            <label>Customer Account ID</label>
            <input
              type="text"
              value={customerAccountId}
              onChange={(e) => setCustomerAccountId(e.target.value)}
              placeholder="Optional for live Snowflake history"
            />

            <div className="line-header">
              <label>Line Items</label>
              <button className="secondary-button compact" onClick={addLineItem}>
                Add line
              </button>
            </div>
            {lineItems.map((lineItem, index) => (
              <div key={lineItem.id} className="line-row">
                <input
                  type="text"
                  value={lineItem.description}
                  onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  placeholder="Description"
                />
                <input
                  type="text"
                  value={lineItem.amount}
                  onChange={(e) => updateLineItem(index, "amount", e.target.value)}
                  placeholder="Amount"
                />
                {lineItems.length > 1 && (
                  <button
                    className="icon-button"
                    onClick={() => removeLineItem(index)}
                    aria-label="Remove line item"
                  >
                    x
                  </button>
                )}
              </div>
            ))}

            <button
              className="primary-button"
              onClick={handleSubmit}
              disabled={loading || !vendorName.trim() || !lineItems.some((li) => li.description.trim())}
            >
              {loading ? "Analyzing" : "Suggest Coding"}
            </button>

            {error && <div className="error-box">{error}</div>}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Automation Rules</h2>
              {savedRules.length > 0 && (
                <button className="secondary-button compact" onClick={() => setSavedRules([])}>
                  Clear saved
                </button>
              )}
            </div>

            <div className="rule-list">
              {automationRules.map((rule) => (
                <div key={rule.id} className={rule.enabled ? "rule-row" : "rule-row disabled"}>
                  <div>
                    <div className="rule-title">{rule.name}</div>
                    <div className="rule-meta">
                      {ruleConditionSummary(rule)} · GL {rule.coding.glAccountCode}
                    </div>
                  </div>
                  <div className="rule-actions">
                    <span className={rule.createdBy === "seed" ? "status-pill" : "status-pill saved"}>
                      {rule.createdBy === "seed" ? "Seed" : "Saved"}
                    </span>
                    {rule.createdBy === "user" && (
                      <>
                        <button className="secondary-button compact" onClick={() => toggleSavedRule(rule.id)}>
                          {rule.enabled ? "Pause" : "Enable"}
                        </button>
                        <button className="icon-button" onClick={() => removeSavedRule(rule.id)} aria-label="Remove rule">
                          x
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {result && (
          <section className="right-column">
            <div className="panel">
              <div className="panel-header">
                <h2>Suggested Coding</h2>
                <span className="muted-label">Review mode</span>
              </div>

              {result.suggestions.map((suggestion) => {
                const sourceStyle = sourceStyles[suggestion.source] || sourceStyles["Historical pattern"];
                const isDraftOpen = ruleDraft?.lineItemId === suggestion.lineItemId;

                return (
                  <article key={suggestion.lineItemId} className="suggestion-card">
                    <div className="suggestion-topline">
                      <strong>{lineItemDescription(lineItems, suggestion.lineItemId)}</strong>
                      <div className="chip-row">
                        <span className="source-chip" style={{ background: sourceStyle.bg, color: sourceStyle.color }}>
                          {suggestion.source}
                        </span>
                        <span
                          className="source-chip"
                          style={{ background: confidenceBg(suggestion.confidence), color: confidenceColor(suggestion.confidence) }}
                        >
                          {suggestion.confidence}
                        </span>
                      </div>
                    </div>

                    <div className="coding-grid">
                      <label>
                        GL code
                        <input
                          value={suggestion.glAccountCode}
                          onChange={(e) => updateSuggestion(suggestion.lineItemId, "glAccountCode", e.target.value)}
                        />
                      </label>
                      <label>
                        GL name
                        <input
                          value={suggestion.glAccountName}
                          onChange={(e) => updateSuggestion(suggestion.lineItemId, "glAccountName", e.target.value)}
                        />
                      </label>
                      <label>
                        Department
                        <input
                          value={suggestion.department || ""}
                          onChange={(e) => updateSuggestion(suggestion.lineItemId, "department", e.target.value)}
                        />
                      </label>
                      <label>
                        Class
                        <input
                          value={suggestion.class || ""}
                          onChange={(e) => updateSuggestion(suggestion.lineItemId, "class", e.target.value)}
                        />
                      </label>
                      <label>
                        Location
                        <input
                          value={suggestion.location || ""}
                          onChange={(e) => updateSuggestion(suggestion.lineItemId, "location", e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="evidence-box">
                      <strong>{suggestion.matchedRuleName || "Evidence"}</strong>
                      <span>{suggestion.evidence || suggestion.reasoning}</span>
                    </div>

                    <div className="suggestion-actions">
                      <button className="secondary-button" onClick={() => startRuleDraft(suggestion)}>
                        Create rule from suggestion
                      </button>
                    </div>

                    {isDraftOpen && (
                      <div className="rule-draft">
                        <div className="rule-draft-header">
                          <strong>Suggested rule draft</strong>
                          <span>Review the conditions, then save to turn this into an automation.</span>
                        </div>

                        <div className="builder-section-title">IF</div>
                        <div className="draft-row">
                          <label>
                            Vendor is
                            <input
                              value={ruleDraft.vendorName}
                              list="vendor-suggestions"
                              onChange={(e) =>
                                setRuleDraft((draft) =>
                                  draft ? { ...draft, vendorName: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                          <label>
                            Rule name
                            <input
                              value={ruleDraft.name}
                              onChange={(e) =>
                                setRuleDraft((draft) =>
                                  draft ? { ...draft, name: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                        </div>

                        <div className="draft-row">
                          <label>
                            AND line item
                            <select
                              value={ruleDraft.type}
                              onChange={(e) =>
                                setRuleDraft((draft) =>
                                  draft ? { ...draft, type: e.target.value as AutomationRuleType } : draft
                                )
                              }
                            >
                              <option value="vendor_default">Any line item for this vendor</option>
                              <option value="description_match">Contains text</option>
                              <option value="ai_semantic">Is like...</option>
                            </select>
                          </label>
                          {ruleDraft.type === "vendor_default" && (
                            <div className="condition-note">
                              Applies to every line on bills from this vendor.
                            </div>
                          )}
                        </div>

                        {ruleDraft.type !== "vendor_default" && (
                          <label>
                            {ruleDraft.type === "ai_semantic" ? "Line item like" : "Line item contains"}
                            <input
                              value={ruleDraft.matchText}
                              onChange={(e) =>
                                setRuleDraft((draft) =>
                                  draft ? { ...draft, matchText: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                        )}

                        {ruleDraft.type === "ai_semantic" && (
                          <label>
                            Meaning to match
                            <textarea
                              value={ruleDraft.condition}
                              onChange={(e) =>
                                setRuleDraft((draft) =>
                                  draft ? { ...draft, condition: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                        )}

                        <div className="builder-section-title">THEN code as</div>
                        <div className="coding-grid compact-grid">
                          <label>
                            GL code
                            <input
                              value={ruleDraft.coding.glAccountCode}
                              onChange={(e) => updateRuleDraftCoding("glAccountCode", e.target.value)}
                            />
                          </label>
                          <label>
                            GL name
                            <input
                              value={ruleDraft.coding.glAccountName}
                              onChange={(e) => updateRuleDraftCoding("glAccountName", e.target.value)}
                            />
                          </label>
                          <label>
                            Department
                            <input
                              value={ruleDraft.coding.department || ""}
                              onChange={(e) => updateRuleDraftCoding("department", e.target.value)}
                            />
                          </label>
                          <label>
                            Class
                            <input
                              value={ruleDraft.coding.class || ""}
                              onChange={(e) => updateRuleDraftCoding("class", e.target.value)}
                            />
                          </label>
                        </div>

                        <div className="suggestion-actions">
                          <button
                            className="primary-button small"
                            onClick={saveRuleDraft}
                            disabled={
                              !ruleDraft.vendorName.trim() ||
                              (ruleDraft.type !== "vendor_default" && !ruleDraft.matchText.trim())
                            }
                          >
                            Save rule
                          </button>
                          <button className="secondary-button" onClick={() => setRuleDraft(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Historical Patterns Used</h2>
                <span className={result.dataSource === "snowflake" ? "status-pill live" : "status-pill"}>
                  {result.dataSource === "snowflake" ? "Live Snowflake" : "Sample data"}
                </span>
              </div>
              <p className="history-count">
                Based on {result.historicalCount} past line items from this vendor
              </p>

              <div className="history-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>GL</th>
                      <th>Dept</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.historicalItems.map((item, index) => (
                      <tr key={`${item.description}-${index}`}>
                        <td>{item.description}</td>
                        <td>{item.coding.glAccountCode}</td>
                        <td>{item.coding.department || "-"}</td>
                        <td>${item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f7f8fb;
          color: #111827;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .app-shell {
          max-width: 1280px;
          margin: 0 auto;
          padding: 32px 24px 48px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 24px;
        }

        h1,
        h2,
        p {
          margin: 0;
        }

        h1 {
          font-size: 28px;
          line-height: 1.15;
          letter-spacing: 0;
        }

        h2 {
          font-size: 16px;
          line-height: 1.25;
          letter-spacing: 0;
        }

        .header p {
          margin-top: 8px;
          color: #6b7280;
          font-size: 14px;
        }

        .demo-actions,
        .suggestion-actions,
        .chip-row,
        .rule-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .demo-actions span {
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        button,
        input,
        select,
        textarea {
          font: inherit;
        }

        button {
          border: 0;
        }

        .demo-actions button,
        .secondary-button {
          min-height: 34px;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          color: #374151;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }

        .secondary-button.compact,
        .icon-button {
          min-height: 30px;
          padding: 6px 10px;
          font-size: 12px;
        }

        .primary-button {
          width: 100%;
          min-height: 42px;
          margin-top: 20px;
          padding: 11px 14px;
          border-radius: 8px;
          background: #111827;
          color: #ffffff;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
        }

        .primary-button.small {
          width: auto;
          min-height: 34px;
          margin-top: 0;
          padding: 8px 12px;
          font-size: 13px;
        }

        .primary-button:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }

        .icon-button {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          color: #6b7280;
          cursor: pointer;
          font-weight: 700;
        }

        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 760px);
          gap: 24px;
        }

        .workspace.has-results {
          grid-template-columns: minmax(360px, 0.92fr) minmax(420px, 1.08fr);
          align-items: start;
        }

        .left-column,
        .right-column {
          display: grid;
          gap: 16px;
        }

        .panel {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          padding: 20px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }

        .panel-header,
        .line-header,
        .suggestion-topline,
        .rule-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .panel-header {
          margin-bottom: 16px;
        }

        .drop-zone {
          min-height: 104px;
          display: grid;
          place-items: center;
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          background: #fbfdff;
          cursor: pointer;
          text-align: center;
          color: #4b5563;
        }

        .drop-zone.dragging {
          border-color: #111827;
          background: #f9fafb;
        }

        .drop-zone.disabled {
          cursor: wait;
          opacity: 0.72;
        }

        .drop-zone strong,
        .drop-zone span {
          display: block;
        }

        .drop-zone span {
          margin-top: 4px;
          color: #6b7280;
          font-size: 12px;
        }

        label {
          display: block;
          margin: 14px 0 6px;
          color: #4b5563;
          font-size: 13px;
          font-weight: 600;
        }

        input,
        select,
        textarea {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          color: #111827;
          padding: 10px 11px;
          font-size: 14px;
          letter-spacing: 0;
        }

        input:disabled {
          background: #f9fafb;
          color: #6b7280;
          cursor: not-allowed;
        }

        textarea {
          min-height: 76px;
          resize: vertical;
        }

        .line-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 112px 36px;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
        }

        .line-row .icon-button {
          width: 36px;
          height: 36px;
        }

        .status-pill,
        .source-chip {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 3px 9px;
          border-radius: 999px;
          background: #f3f4f6;
          color: #4b5563;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .status-pill.success,
        .status-pill.saved {
          background: #dcfce7;
          color: #15803d;
        }

        .status-pill.live {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .muted-label,
        .history-count {
          color: #6b7280;
          font-size: 13px;
        }

        .rule-list {
          display: grid;
          gap: 10px;
        }

        .rule-row {
          align-items: flex-start;
          border: 1px solid #edf0f5;
          border-radius: 8px;
          padding: 12px;
          background: #fbfdff;
        }

        .rule-row.disabled {
          opacity: 0.55;
        }

        .rule-title {
          font-size: 13px;
          font-weight: 700;
        }

        .rule-meta {
          margin-top: 3px;
          color: #6b7280;
          font-size: 12px;
        }

        .suggestion-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #fbfdff;
          padding: 16px;
          margin-bottom: 12px;
        }

        .suggestion-topline strong {
          min-width: 0;
          font-size: 14px;
          line-height: 1.35;
        }

        .coding-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0 12px;
          margin-top: 4px;
        }

        .coding-grid label {
          margin-top: 12px;
        }

        .coding-grid label:first-child {
          margin-top: 12px;
        }

        .compact-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .evidence-box {
          display: grid;
          gap: 4px;
          margin-top: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          padding: 10px 12px;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.45;
        }

        .evidence-box strong {
          color: #111827;
        }

        .suggestion-actions {
          margin-top: 12px;
        }

        .rule-draft {
          margin-top: 14px;
          padding: 14px;
          border: 1px solid #c7d2fe;
          border-radius: 8px;
          background: #f8fafc;
        }

        .rule-draft-header {
          display: grid;
          gap: 4px;
          margin-bottom: 12px;
        }

        .rule-draft-header strong {
          color: #111827;
          font-size: 14px;
        }

        .rule-draft-header span {
          color: #6b7280;
          font-size: 13px;
          line-height: 1.35;
        }

        .builder-section-title {
          margin-top: 14px;
          color: #4b5563;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0;
        }

        .condition-note {
          align-self: end;
          min-height: 40px;
          display: flex;
          align-items: center;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          color: #6b7280;
          padding: 8px 11px;
          font-size: 13px;
          line-height: 1.35;
        }

        .draft-row {
          display: grid;
          grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
          gap: 12px;
        }

        .history-table-wrap {
          max-height: 320px;
          overflow: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        th,
        td {
          border-bottom: 1px solid #eef2f7;
          padding: 9px 8px;
          text-align: left;
          vertical-align: top;
        }

        th {
          color: #6b7280;
          font-weight: 700;
        }

        td:last-child,
        th:last-child {
          text-align: right;
        }

        .error-box {
          margin-top: 14px;
          border: 1px solid #fecaca;
          border-radius: 8px;
          background: #fef2f2;
          color: #b91c1c;
          padding: 12px;
          font-size: 13px;
        }

        @media (max-width: 980px) {
          .header,
          .workspace.has-results {
            grid-template-columns: 1fr;
          }

          .header {
            display: grid;
          }
        }

        @media (max-width: 640px) {
          .app-shell {
            padding: 20px 14px 32px;
          }

          .line-row,
          .coding-grid,
          .draft-row {
            grid-template-columns: 1fr;
          }

          .line-row .icon-button {
            width: 100%;
          }

          .suggestion-topline,
          .panel-header,
          .rule-row {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>
    </main>
  );
}
