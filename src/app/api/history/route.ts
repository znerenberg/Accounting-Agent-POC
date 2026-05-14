import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

interface HistoricalBill {
  vendor_name: string;
  purchased_at: string;
  amount: number;
  gl_value: string;
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
    const vendorFilter = vendorName
      ? `AND LOWER(v.NAME) LIKE LOWER('%${vendorName.replace(/'/g, "''")}%')`
      : "";

    const query = `
SELECT
  v.NAME as vendor_name,
  e.PURCHASED_AT,
  GET_PATH(e.BILLING_AMOUNT, 'quantity') as amount,
  MAX(CASE WHEN efv.KEY LIKE 'gl_account_%' THEN efv.VALUE END) as gl_value,
  MAX(CASE WHEN efv.KEY LIKE 'department_%' THEN efv.VALUE END) as department_value,
  MAX(CASE WHEN efv.KEY LIKE 'class_%' THEN efv.VALUE END) as class_value,
  MAX(CASE WHEN efv.KEY LIKE 'location_%' THEN efv.VALUE END) as location_value
FROM EXPENSES_V2.EXPENSES_V2.EXPENSES e
JOIN EXPENSES_V2.EXPENSES_V2.VENDORS v ON v.ID = e.VENDORS_VENDOR_ID
LEFT JOIN EXPENSES_V2.EXPENSES_V2.EXTENSIBLE_FIELDS_EXTENDED_FIELD_VALUES efv
  ON efv.SOURCE_OBJECT_ID = e.ID
  AND efv.SOURCE_OBJECT_TYPE = 'EXPENSE'
  AND (efv.KEY LIKE 'gl_account_%' OR efv.KEY LIKE 'department_%' OR efv.KEY LIKE 'class_%' OR efv.KEY LIKE 'location_%')
WHERE e.EXPENSE_TYPE = 'BILLPAY'
  AND e.CUSTOMER_ACCOUNT_ID = '${customerAccountId.replace(/'/g, "''")}'
  AND v.NAME NOT LIKE 'Synthetic%'
  ${vendorFilter}
GROUP BY v.NAME, e.PURCHASED_AT, e.BILLING_AMOUNT, e.ID
ORDER BY v.NAME, e.PURCHASED_AT DESC
LIMIT 50
`.trim().replace(/\n/g, " ");

    const result = execSync(
      `snow sql -c brex -q "${query}" --format json`,
      { encoding: "utf-8", timeout: 60000 }
    );

    const rows: HistoricalBill[] = JSON.parse(result).map((row: Record<string, string>) => ({
      vendor_name: row.VENDOR_NAME,
      purchased_at: row.PURCHASED_AT,
      amount: parseFloat(row.AMOUNT) || 0,
      gl_value: row.GL_VALUE || null,
      department_value: row.DEPARTMENT_VALUE || null,
      class_value: row.CLASS_VALUE || null,
      location_value: row.LOCATION_VALUE || null,
    }));

    // Group by vendor for summary
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

    return NextResponse.json({
      customer_account_id: customerAccountId,
      vendor_filter: vendorName || null,
      total_bills: rows.length,
      vendors: summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Snowflake query failed: ${message}` }, { status: 500 });
  }
}
