import { execFileSync } from "child_process";

export interface SnowflakeBill {
  VENDOR_NAME: string;
  PURCHASED_AT: string;
  DESCRIPTION: string | null;
  AMOUNT: string;
  GL_VALUE: string | null;
  DEPARTMENT_VALUE: string | null;
  CLASS_VALUE: string | null;
  LOCATION_VALUE: string | null;
  ITEMIZATION_STATUS: string | null;
}

const snowflakeHistoryCache = new Map<string, { createdAt: number; bills: SnowflakeBill[] }>();
const SNOWFLAKE_HISTORY_CACHE_TTL_MS = 10 * 60 * 1000;

export function snowflakeConnection() {
  return process.env.SNOWFLAKE_CONNECTION || "brex";
}

export function querySnowflakeHistory(
  vendorName: string | null,
  customerAccountId: string,
  limit = 30
): SnowflakeBill[] | null {
  try {
    const escapedVendor = vendorName?.replace(/'/g, "''") || "";
    const escapedCustomer = customerAccountId.replace(/'/g, "''");
    const cacheKey = `${escapedCustomer}:${escapedVendor}:${limit}`.toLowerCase();
    const cached = snowflakeHistoryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < SNOWFLAKE_HISTORY_CACHE_TTL_MS) {
      return cached.bills;
    }

    const vendorFilter = escapedVendor
      ? `AND LOWER(NAME) LIKE LOWER('%${escapedVendor}%')`
      : "";

    const query = `
WITH matching_vendors AS (
  SELECT ID, NAME
  FROM EXPENSES_V2.EXPENSES_V2.VENDORS
  WHERE NAME NOT LIKE 'Synthetic%'
    ${vendorFilter}
),
recent_expenses AS (
  SELECT
    e.ID,
    COALESCE(child_vendor.NAME, parent_vendor.NAME) as VENDOR_NAME,
    e.PURCHASED_AT,
    e.BILLING_AMOUNT,
    e.MEMO,
    e.AUTO_GENERATED_MEMO,
    e.ITEMIZATION_STATUS
  FROM EXPENSES_V2.EXPENSES_V2.EXPENSES e
  LEFT JOIN EXPENSES_V2.EXPENSES_V2.EXPENSES parent_expense
    ON parent_expense.ID = e.PARENT_ID
  LEFT JOIN matching_vendors child_vendor
    ON child_vendor.ID = e.VENDORS_VENDOR_ID
  LEFT JOIN matching_vendors parent_vendor
    ON parent_vendor.ID = parent_expense.VENDORS_VENDOR_ID
  WHERE e.EXPENSE_TYPE = 'BILLPAY'
    AND e.CUSTOMER_ACCOUNT_ID = '${escapedCustomer}'
    AND e.ITEMIZATION_STATUS != 'PARENT'
    AND COALESCE(child_vendor.ID, parent_vendor.ID) IS NOT NULL
  ORDER BY COALESCE(child_vendor.NAME, parent_vendor.NAME), e.PURCHASED_AT DESC
  LIMIT ${limit}
)
SELECT
  re.VENDOR_NAME,
  re.PURCHASED_AT,
  COALESCE(
    NULLIF(TO_VARCHAR(line_item.DESCRIPTION), ''),
    NULLIF(TO_VARCHAR(re.MEMO), ''),
    NULLIF(TO_VARCHAR(re.AUTO_GENERATED_MEMO), ''),
    IFF(re.ITEMIZATION_STATUS = 'CHILD', 'Line item', 'Bill from ' || re.VENDOR_NAME)
  ) as DESCRIPTION,
  GET_PATH(re.BILLING_AMOUNT, 'quantity') as AMOUNT,
  MAX(CASE WHEN efv.KEY LIKE 'gl_account_%' THEN efv.VALUE END) as GL_VALUE,
  MAX(CASE WHEN efv.KEY LIKE 'department_%' THEN efv.VALUE END) as DEPARTMENT_VALUE,
  MAX(CASE WHEN efv.KEY LIKE 'class_%' THEN efv.VALUE END) as CLASS_VALUE,
  MAX(CASE WHEN efv.KEY LIKE 'location_%' THEN efv.VALUE END) as LOCATION_VALUE,
  re.ITEMIZATION_STATUS
FROM recent_expenses re
LEFT JOIN EXPENSES_V2.EXPENSES_V2.EXPENSE_LINE_ITEMS line_item
  ON line_item.EXPENSE_ID = re.ID
  AND line_item.DELETED_AT IS NULL
LEFT JOIN EXPENSES_V2.EXPENSES_V2.EXTENSIBLE_FIELDS_EXTENDED_FIELD_VALUES efv
  ON efv.SOURCE_OBJECT_ID = re.ID
  AND efv.SOURCE_OBJECT_TYPE = 'EXPENSE'
  AND (efv.KEY LIKE 'gl_account_%' OR efv.KEY LIKE 'department_%' OR efv.KEY LIKE 'class_%' OR efv.KEY LIKE 'location_%')
GROUP BY
  re.VENDOR_NAME,
  re.PURCHASED_AT,
  line_item.DESCRIPTION,
  re.MEMO,
  re.AUTO_GENERATED_MEMO,
  re.BILLING_AMOUNT,
  re.ID,
  re.ITEMIZATION_STATUS
ORDER BY re.VENDOR_NAME, re.PURCHASED_AT DESC
`.trim().replace(/\n/g, " ");

    const result = execFileSync(
      "snow",
      ["sql", "-c", snowflakeConnection(), "-q", query, "--format", "json"],
      { encoding: "utf-8", timeout: 60000 }
    );
    const bills = JSON.parse(result) as SnowflakeBill[];
    snowflakeHistoryCache.set(cacheKey, { createdAt: Date.now(), bills });
    return bills;
  } catch {
    return null;
  }
}
