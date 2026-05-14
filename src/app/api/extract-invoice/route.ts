import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  baseURL: process.env.LLM_GATEWAY_URL || "https://llm.staging.brexapps.io/gateway/anthropic",
  apiKey: process.env.LLM_GATEWAY_API_KEY || "",
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("invoice") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
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
