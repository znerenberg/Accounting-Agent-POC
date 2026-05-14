"use client";

import { useState, useRef } from "react";

interface LineItemInput {
  id: string;
  description: string;
  amount: string;
}

interface Suggestion {
  lineItemId: string;
  glAccountCode: string;
  glAccountName: string;
  department: string | null;
  class: string | null;
  location: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface HistoricalItem {
  description: string;
  amount: number;
  billedAt: string;
  coding: {
    glAccountCode: string;
    glAccountName: string;
    department: string | null;
    class: string | null;
    location: string | null;
  };
}

interface ApiResponse {
  vendorName: string;
  suggestions: Suggestion[];
  historicalItems: HistoricalItem[];
  historicalCount: number;
  dataSource?: "snowflake" | "mock";
}

const SAMPLE_VENDORS = [
  "Amazon Web Services",
  "WeWork",
  "Salesforce",
  "Baker McKenzie LLP",
  "Datadog",
  "Gusto",
];

export default function Home() {
  const [vendorName, setVendorName] = useState("");
  const [customerAccountId, setCustomerAccountId] = useState("");
  const [lineItems, setLineItems] = useState<LineItemInput[]>([
    { id: "li_1", description: "", amount: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      { id: `li_${lineItems.length + 1}`, description: "", amount: "" },
    ]);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
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

    try {
      const response = await fetch("/api/suggest-coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName,
          customerAccountId: customerAccountId || undefined,
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

  const confidenceColor = (c: string) => {
    if (c === "high") return "#16a34a";
    if (c === "medium") return "#ca8a04";
    return "#dc2626";
  };

  const confidenceBg = (c: string) => {
    if (c === "high") return "#dcfce7";
    if (c === "medium") return "#fef9c3";
    return "#fef2f2";
  };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "#111" }}>
          Bill Coding Assistant
        </h1>
        <p style={{ color: "#666", marginTop: 8, fontSize: 15 }}>
          AI-powered GL coding suggestions based on how past bills were coded
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap: 32 }}>
        {/* Left: Input */}
        <div>
          {/* Invoice Upload */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0" }}>Upload Invoice</h2>
            <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px 0" }}>
              Upload a PDF or image of an invoice to automatically extract the vendor and line items
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed #d1d5db",
                borderRadius: 8,
                padding: "24px 16px",
                textAlign: "center",
                cursor: uploading ? "not-allowed" : "pointer",
                background: uploading ? "#f9fafb" : "#fff",
                transition: "border-color 0.2s",
              }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#111"; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = "#d1d5db";
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
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Extracting line items...</div>
                  <div style={{ fontSize: 12, color: "#999" }}>This may take a few seconds</div>
                </div>
              ) : uploadedFileName ? (
                <div>
                  <div style={{ fontSize: 14, color: "#16a34a", marginBottom: 4 }}>Extracted from: {uploadedFileName}</div>
                  <div style={{ fontSize: 12, color: "#999" }}>Click or drop to upload a different invoice</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>+</div>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Click to upload or drag and drop</div>
                  <div style={{ fontSize: 12, color: "#999" }}>PDF, PNG, JPG, or WebP</div>
                </div>
              )}
            </div>
          </div>

          {/* Manual Entry / Edit */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px 0" }}>Bill Details</h2>
            <p style={{ fontSize: 12, color: "#999", margin: "0 0 16px 0" }}>
              {uploadedFileName ? "Review and edit the extracted details, then suggest coding" : "Or enter bill details manually"}
            </p>

            {/* Vendor */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#555", marginBottom: 6 }}>
              Vendor
            </label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. Amazon Web Services"
              list="vendor-suggestions"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 4, boxSizing: "border-box" }}
            />
            <datalist id="vendor-suggestions">
              {SAMPLE_VENDORS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p style={{ fontSize: 12, color: "#999", margin: "2px 0 20px 0" }}>
              Try: {SAMPLE_VENDORS.join(", ")}
            </p>

            {/* Customer Account ID (for Snowflake) */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#555", marginBottom: 6 }}>
              Customer Account ID <span style={{ fontWeight: 400, color: "#999" }}>(optional — enables live Snowflake data)</span>
            </label>
            <input
              type="text"
              value={customerAccountId}
              onChange={(e) => setCustomerAccountId(e.target.value)}
              placeholder="e.g. cuacc_cl1bul55b000401qmifxrd70e"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
            />

            {/* Line Items */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#555", marginBottom: 10 }}>
              Line Items
            </label>
            {lineItems.map((li, index) => (
              <div key={li.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={li.description}
                  onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  placeholder="Description (e.g. EC2 instances)"
                  style={{ flex: 2, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
                />
                <input
                  type="text"
                  value={li.amount}
                  onChange={(e) => updateLineItem(index, "amount", e.target.value)}
                  placeholder="Amount"
                  style={{ flex: 0.7, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
                />
                {lineItems.length > 1 && (
                  <button
                    onClick={() => removeLineItem(index)}
                    style={{ padding: "8px 12px", background: "none", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", color: "#999", fontSize: 16 }}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addLineItem}
              style={{ marginTop: 4, padding: "8px 14px", background: "none", border: "1px dashed #d1d5db", borderRadius: 8, cursor: "pointer", color: "#666", fontSize: 13 }}
            >
              + Add line item
            </button>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={loading || !vendorName.trim() || !lineItems.some((li) => li.description.trim())}
              style={{
                display: "block",
                width: "100%",
                marginTop: 24,
                padding: "12px 16px",
                background: loading ? "#9ca3af" : "#111",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Analyzing patterns..." : "Suggest Coding"}
            </button>

            {error && (
              <div style={{ marginTop: 16, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right: Results */}
        {result && (
          <div>
            {/* Suggestions */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px 0" }}>
                Suggested Coding
              </h2>
              {result.suggestions.map((s, i) => (
                <div
                  key={i}
                  style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12, background: "#fafafa" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>
                      {lineItems.find((li) => li.id === s.lineItemId)?.description || s.lineItemId}
                    </span>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 500,
                        color: confidenceColor(s.confidence),
                        background: confidenceBg(s.confidence),
                      }}
                    >
                      {s.confidence} confidence
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 13 }}>
                    <div>
                      <span style={{ color: "#888" }}>GL Account: </span>
                      <span style={{ fontWeight: 500 }}>{s.glAccountCode} - {s.glAccountName}</span>
                    </div>
                    <div>
                      <span style={{ color: "#888" }}>Department: </span>
                      <span style={{ fontWeight: 500 }}>{s.department || "—"}</span>
                    </div>
                    <div>
                      <span style={{ color: "#888" }}>Class: </span>
                      <span style={{ fontWeight: 500 }}>{s.class || "—"}</span>
                    </div>
                    <div>
                      <span style={{ color: "#888" }}>Location: </span>
                      <span style={{ fontWeight: 500 }}>{s.location || "—"}</span>
                    </div>
                  </div>

                  <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#666", fontStyle: "italic" }}>
                    {s.reasoning}
                  </p>
                </div>
              ))}
            </div>

            {/* Historical context */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px 0" }}>
                Historical Patterns Used
              </h2>
              <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px 0" }}>
                Based on {result.historicalCount} past line items from this vendor
                {result.dataSource && (
                  <span style={{
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 500,
                    background: result.dataSource === "snowflake" ? "#dbeafe" : "#f3f4f6",
                    color: result.dataSource === "snowflake" ? "#1d4ed8" : "#666",
                  }}>
                    {result.dataSource === "snowflake" ? "Live Snowflake" : "Sample Data"}
                  </span>
                )}
              </p>

              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px 8px 8px 0", color: "#888", fontWeight: 500 }}>Description</th>
                      <th style={{ textAlign: "left", padding: 8, color: "#888", fontWeight: 500 }}>GL</th>
                      <th style={{ textAlign: "left", padding: 8, color: "#888", fontWeight: 500 }}>Dept</th>
                      <th style={{ textAlign: "right", padding: "8px 0 8px 8px", color: "#888", fontWeight: 500 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.historicalItems.map((item, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 8px 8px 0" }}>{item.description}</td>
                        <td style={{ padding: 8 }}>{item.coding.glAccountCode}</td>
                        <td style={{ padding: 8 }}>{item.coding.department}</td>
                        <td style={{ padding: "8px 0 8px 8px", textAlign: "right" }}>${item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
