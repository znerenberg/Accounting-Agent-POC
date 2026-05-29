import { NextRequest, NextResponse } from "next/server";
import { querySnowflakeHistory } from "../../snowflake-history";

interface HistoricalBill {
  vendor_name: string;
  purchased_at: string;
  amount: number;
  gl_value: string | null;
  department_value: string | null;
  class_value: string | null;
  location_value: string | null;
}

export async function GET(request: NextRequest) {
  const vendorName = request.nextUrl.searchParams.get("vendor");
  const customerAccountId = request.nextUrl.searchParams.get("customer_account_id");

  if (!customerAccountId) {
    return NextResponse.json({ error: "customer_account_id is required" }, { status: 400 });
  }

  try {
    const snowflakeRows = querySnowflakeHistory(vendorName, customerAccountId, 30);
    if (!snowflakeRows) {
      throw new Error("Snowflake query returned no result");
    }

    const rows: HistoricalBill[] = snowflakeRows.map((row) => ({
      vendor_name: row.VENDOR_NAME,
      purchased_at: row.PURCHASED_AT,
      amount: parseFloat(row.AMOUNT) || 0,
      gl_value: row.GL_VALUE || null,
      department_value: row.DEPARTMENT_VALUE || null,
      class_value: row.CLASS_VALUE || null,
      location_value: row.LOCATION_VALUE || null,
    }));

    return NextResponse.json(historyResponse(customerAccountId, vendorName, rows));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Snowflake query failed: ${message}` }, { status: 500 });
  }
}

function historyResponse(
  customerAccountId: string,
  vendorName: string | null,
  rows: HistoricalBill[]
) {
  const vendors = new Map<string, { bills: HistoricalBill[]; glDistribution: Map<string, number> }>();
  for (const row of rows) {
    if (!vendors.has(row.vendor_name)) {
      vendors.set(row.vendor_name, { bills: [], glDistribution: new Map() });
    }
    const v = vendors.get(row.vendor_name)!;
    v.bills.push(row);
    if (row.gl_value) {
      v.glDistribution.set(row.gl_value, (v.glDistribution.get(row.gl_value) || 0) + 1);
    }
  }

  const summary = Array.from(vendors.entries()).map(([name, data]) => ({
    vendor_name: name,
    bill_count: data.bills.length,
    gl_distribution: Object.fromEntries(data.glDistribution),
    recent_bills: data.bills.slice(0, 5),
  }));

  return {
    customer_account_id: customerAccountId,
    vendor_filter: vendorName || null,
    total_bills: rows.length,
    vendors: summary,
  };
}
