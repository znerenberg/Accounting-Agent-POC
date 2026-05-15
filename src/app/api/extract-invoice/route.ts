import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  baseURL: process.env.LLM_GATEWAY_URL || "https://llm.staging.brexapps.io/gateway/anthropic",
  apiKey: process.env.LLM_GATEWAY_API_KEY || "",
});

const DEMO_INVOICES: Record<string, { vendorName: string; lineItems: { description: string; amount: number }[] }> = {
  "anthropic-api-and-subscription.pdf": {
    vendorName: "Anthropic",
    lineItems: [
      { description: "API calls - Claude model token usage for production workflows", amount: 18200 },
      { description: "Claude Team subscription - 12 seats", amount: 360 },
    ],
  },
  "datadog-default-monitoring.pdf": {
    vendorName: "Datadog",
    lineItems: [
      { description: "Infrastructure monitoring - Pro plan", amount: 8900 },
      { description: "APM and log management", amount: 6700 },
      { description: "Security monitoring add-on", amount: 2200 },
    ],
  },
  "baker-mckenzie-same-as-last-bill.pdf": {
    vendorName: "Baker McKenzie LLP",
    lineItems: [
      { description: "Legal services - contract review", amount: 18500 },
      { description: "Legal services - regulatory compliance", amount: 22000 },
    ],
  },
  "salesforce-mixed-rules-and-fallback.pdf": {
    vendorName: "Salesforce",
    lineItems: [
      { description: "Marketing Cloud - email campaigns", amount: 3200 },
      { description: "Sales Cloud Enterprise - 50 seats", amount: 7500 },
      { description: "Tableau analytics - 10 viewer licenses", amount: 1500 },
    ],
  },
  "flatiron-vendor-cleanup-default.pdf": {
    vendorName: "Flatiron Health",
    lineItems: [
      { description: "Clinical data platform subscription", amount: 9600 },
      { description: "Implementation support services", amount: 2400 },
    ],
  },
  "sample-invoice-aws.pdf": {
    vendorName: "Amazon Web Services",
    lineItems: [
      { description: "EC2 Reserved Instances - m5.2xlarge (production)", amount: 13500 },
      { description: "RDS PostgreSQL Multi-AZ - db.r5.xlarge", amount: 5550 },
      { description: "S3 Standard Storage (4.2 TB)", amount: 3800 },
      { description: "CloudFront CDN - Data Transfer (8.5 TB)", amount: 1420 },
      { description: "AWS Business Support Plan", amount: 2400 },
      { description: "Lambda - Function Invocations (45M requests)", amount: 890 },
    ],
  },
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("invoice") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const demoInvoice = DEMO_INVOICES[file.name];
    if (demoInvoice) {
      return NextResponse.json(demoInvoice);
    }

    if (!process.env.LLM_GATEWAY_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Invoice upload needs LLM_GATEWAY_API_KEY for arbitrary PDFs. The bundled demo PDFs work without a key.",
        },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mediaType = file.type;

    // Build the content block based on file type
    let fileBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

    if (mediaType === "application/pdf") {
      fileBlock = {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      };
    } else {
      fileBlock = {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: base64,
        },
      };
    }

    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [
      fileBlock,
      {
        type: "text",
        text: `Extract the invoice details from this document. I need:
1. The vendor/supplier name
2. Each line item with its description and amount

Respond ONLY with valid JSON in this exact format:
{
  "vendorName": "the vendor or supplier name",
  "lineItems": [
    {
      "description": "line item description",
      "amount": 1234.56
    }
  ]
}

If you cannot clearly read a field, use your best guess. Always return at least one line item. Only output valid JSON, no other text.`,
      },
    ];

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    });

    const responseContent = message.content[0];
    if (responseContent.type !== "text") {
      return NextResponse.json({ error: "Unexpected response format" }, { status: 500 });
    }

    // Strip markdown code fences if Claude wrapped the JSON
    const cleanedText = responseContent.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleanedText);

    return NextResponse.json(parsed);
  } catch (error: unknown) {
    console.error("Extract invoice error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
