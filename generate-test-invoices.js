const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const outputDir = path.join(__dirname, "test-invoices");
fs.mkdirSync(outputDir, { recursive: true });

const invoices = [
  {
    fileName: "anthropic-api-and-subscription.pdf",
    vendorName: "Anthropic",
    invoiceNumber: "ANT-2026-0515",
    date: "May 15, 2026",
    dueDate: "June 14, 2026",
    memo: "Shows AI rules splitting API usage from Claude subscription seats.",
    billTo: ["Brex Inc.", "Engineering Finance", "San Francisco, CA"],
    vendorAddress: ["548 Market Street", "San Francisco, CA 94104", "United States"],
    lines: [
      {
        description: "API calls - Claude model token usage for production workflows",
        qty: "1",
        unitPrice: "$18,200.00",
        amount: "$18,200.00",
      },
      {
        description: "Claude Team subscription - 12 seats",
        qty: "12",
        unitPrice: "$30.00",
        amount: "$360.00",
      },
    ],
    subtotal: "$18,560.00",
    tax: "$0.00",
    total: "$18,560.00",
  },
  {
    fileName: "datadog-default-monitoring.pdf",
    vendorName: "Datadog",
    invoiceNumber: "DD-889240",
    date: "May 10, 2026",
    dueDate: "June 9, 2026",
    memo: "Shows a simple vendor default rule applying to every line.",
    billTo: ["Brex Inc.", "Platform Engineering", "San Francisco, CA"],
    vendorAddress: ["620 8th Avenue, 45th Floor", "New York, NY 10018", "United States"],
    lines: [
      {
        description: "Infrastructure monitoring - Pro plan",
        qty: "1",
        unitPrice: "$8,900.00",
        amount: "$8,900.00",
      },
      {
        description: "APM and log management",
        qty: "1",
        unitPrice: "$6,700.00",
        amount: "$6,700.00",
      },
      {
        description: "Security monitoring add-on",
        qty: "1",
        unitPrice: "$2,200.00",
        amount: "$2,200.00",
      },
    ],
    subtotal: "$17,800.00",
    tax: "$0.00",
    total: "$17,800.00",
  },
  {
    fileName: "baker-mckenzie-same-as-last-bill.pdf",
    vendorName: "Baker McKenzie LLP",
    invoiceNumber: "BM-2026-7781",
    date: "May 8, 2026",
    dueDate: "June 7, 2026",
    memo: "Shows same-as-last-bill when vendor history is consistent.",
    billTo: ["Brex Inc.", "Legal Department", "San Francisco, CA"],
    vendorAddress: ["300 East Randolph Street", "Chicago, IL 60601", "United States"],
    lines: [
      {
        description: "Legal services - contract review",
        qty: "1",
        unitPrice: "$18,500.00",
        amount: "$18,500.00",
      },
      {
        description: "Legal services - regulatory compliance",
        qty: "1",
        unitPrice: "$22,000.00",
        amount: "$22,000.00",
      },
    ],
    subtotal: "$40,500.00",
    tax: "$0.00",
    total: "$40,500.00",
  },
  {
    fileName: "salesforce-mixed-rules-and-fallback.pdf",
    vendorName: "Salesforce",
    invoiceNumber: "SFDC-730551",
    date: "May 4, 2026",
    dueDate: "June 3, 2026",
    memo: "Shows a seeded line rule for Marketing Cloud plus fallback reasoning on other lines.",
    billTo: ["Brex Inc.", "Revenue Operations", "San Francisco, CA"],
    vendorAddress: ["415 Mission Street, 3rd Floor", "San Francisco, CA 94105", "United States"],
    lines: [
      {
        description: "Marketing Cloud - email campaigns",
        qty: "1",
        unitPrice: "$3,200.00",
        amount: "$3,200.00",
      },
      {
        description: "Sales Cloud Enterprise - 50 seats",
        qty: "50",
        unitPrice: "$150.00",
        amount: "$7,500.00",
      },
      {
        description: "Tableau analytics - 10 viewer licenses",
        qty: "10",
        unitPrice: "$150.00",
        amount: "$1,500.00",
      },
    ],
    subtotal: "$12,200.00",
    tax: "$0.00",
    total: "$12,200.00",
  },
  {
    fileName: "flatiron-vendor-cleanup-default.pdf",
    vendorName: "Flatiron Health",
    invoiceNumber: "FH-44902",
    date: "May 12, 2026",
    dueDate: "June 11, 2026",
    memo: "Good for saving a new vendor rule in-flow, then rerunning to show local-storage learning.",
    billTo: ["Brex Inc.", "Finance Operations", "San Francisco, CA"],
    vendorAddress: ["233 Spring Street", "New York, NY 10013", "United States"],
    lines: [
      {
        description: "Clinical data platform subscription",
        qty: "1",
        unitPrice: "$9,600.00",
        amount: "$9,600.00",
      },
      {
        description: "Implementation support services",
        qty: "1",
        unitPrice: "$2,400.00",
        amount: "$2,400.00",
      },
    ],
    subtotal: "$12,000.00",
    tax: "$0.00",
    total: "$12,000.00",
  },
  {
    fileName: "crowe-all-dimensions-history.pdf",
    vendorName: "Crowe LLP",
    invoiceNumber: "CR-2026-0522",
    date: "May 22, 2026",
    dueDate: "June 21, 2026",
    memo: "Shows live Snowflake history filling GL, department, class, and location from prior bills.",
    billTo: ["Brex Inc.", "Finance", "San Francisco, CA"],
    vendorAddress: ["225 West Wacker Drive", "Chicago, IL 60606", "United States"],
    lines: [
      {
        description: "Audit and assurance services - monthly retainer",
        qty: "1",
        unitPrice: "$11,500.00",
        amount: "$11,500.00",
      },
      {
        description: "Tax advisory and compliance support",
        qty: "1",
        unitPrice: "$4,200.00",
        amount: "$4,200.00",
      },
    ],
    subtotal: "$15,700.00",
    tax: "$0.00",
    total: "$15,700.00",
  },
  {
    fileName: "cdw-mixed-line-history.pdf",
    vendorName: "CDW CANADA CORP.",
    invoiceNumber: "CDW-2026-0428-MIX",
    date: "May 20, 2026",
    dueDate: "June 19, 2026",
    memo: "Shows live line-item history splitting hardware, freight, and tax coding for the same vendor.",
    billTo: ["Brex Inc.", "IT Procurement", "San Francisco, CA"],
    vendorAddress: ["200 N Milwaukee Avenue", "Vernon Hills, IL 60061", "United States"],
    lines: [
      {
        description: "UV82W4PODG",
        qty: "1",
        unitPrice: "$8,527.12",
        amount: "$8,527.12",
      },
      {
        description: "ZJ2MJJAVWV",
        qty: "1",
        unitPrice: "$18.47",
        amount: "$18.47",
      },
      {
        description: "HST",
        qty: "1",
        unitPrice: "$451.10",
        amount: "$451.10",
      },
    ],
    subtotal: "$8,996.69",
    tax: "$0.00",
    total: "$8,996.69",
  },
];

function drawInvoice(invoice) {
  const doc = new PDFDocument({ margin: 50 });
  const outputPath = path.join(outputDir, invoice.fileName);
  doc.pipe(fs.createWriteStream(outputPath));

  doc.fontSize(20).font("Helvetica-Bold").text("INVOICE", { align: "right" });
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica").text(`Invoice #: ${invoice.invoiceNumber}`, { align: "right" });
  doc.text(`Date: ${invoice.date}`, { align: "right" });
  doc.text(`Due Date: ${invoice.dueDate}`, { align: "right" });

  doc.moveDown(2);
  doc.fontSize(14).font("Helvetica-Bold").text(invoice.vendorName);
  doc.fontSize(10).font("Helvetica");
  invoice.vendorAddress.forEach((line) => doc.text(line));

  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").text("Bill To:");
  doc.font("Helvetica");
  invoice.billTo.forEach((line) => doc.text(line));

  doc.moveDown(1);
  doc.font("Helvetica-Bold").text("Demo note:");
  doc.font("Helvetica").text(invoice.memo);

  doc.moveDown(1.6);
  const tableTop = doc.y;
  const colDescription = 50;
  const colQty = 335;
  const colUnit = 405;
  const colAmount = 500;

  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Description", colDescription, tableTop);
  doc.text("Qty", colQty, tableTop);
  doc.text("Unit Price", colUnit, tableTop);
  doc.text("Amount", colAmount, tableTop);
  doc.moveTo(50, tableTop + 15).lineTo(560, tableTop + 15).stroke();

  let y = tableTop + 25;
  doc.font("Helvetica").fontSize(9);
  invoice.lines.forEach((item) => {
    doc.text(item.description, colDescription, y, { width: 270 });
    doc.text(item.qty, colQty, y);
    doc.text(item.unitPrice, colUnit, y);
    doc.text(item.amount, colAmount, y);
    y += 26;
  });

  y += 8;
  doc.moveTo(50, y).lineTo(560, y).stroke();
  y += 15;

  doc.font("Helvetica").fontSize(9);
  doc.text("Subtotal:", colUnit, y);
  doc.text(invoice.subtotal, colAmount, y);
  y += 18;
  doc.text("Tax:", colUnit, y);
  doc.text(invoice.tax, colAmount, y);
  y += 18;
  doc.font("Helvetica-Bold");
  doc.text("Total Due:", colUnit, y);
  doc.text(invoice.total, colAmount, y);

  doc.moveDown(6);
  doc.font("Helvetica").fontSize(8).fillColor("#777");
  doc.text("Payment Terms: Net 30 | Please include invoice number with payment.", 50, undefined, {
    align: "center",
  });

  doc.end();
  return outputPath;
}

const generated = invoices.map(drawInvoice);
console.log("Generated test invoices:");
generated.forEach((filePath) => console.log(`- ${filePath}`));
