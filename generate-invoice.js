const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const doc = new PDFDocument({ margin: 50 });
const outputPath = path.join(__dirname, "sample-invoice-aws.pdf");
doc.pipe(fs.createWriteStream(outputPath));

// Header
doc.fontSize(20).font("Helvetica-Bold").text("INVOICE", { align: "right" });
doc.moveDown(0.5);
doc.fontSize(10).font("Helvetica").text("Invoice #: INV-2026-05-1847", { align: "right" });
doc.text("Date: May 1, 2026", { align: "right" });
doc.text("Due Date: May 31, 2026", { align: "right" });

doc.moveDown(2);

// Vendor info
doc.fontSize(14).font("Helvetica-Bold").text("Amazon Web Services, Inc.");
doc.fontSize(10).font("Helvetica").text("410 Terry Avenue North");
doc.text("Seattle, WA 98109");
doc.text("United States");

doc.moveDown(1.5);

// Bill To
doc.fontSize(10).font("Helvetica-Bold").text("Bill To:");
doc.font("Helvetica").text("Brex Inc.");
doc.text("11 York Street, 4th Floor");
doc.text("San Francisco, CA 94107");
doc.text("Account ID: 4829-1037-5521");

doc.moveDown(2);

// Table header
const tableTop = doc.y;
const col1 = 50;
const col2 = 320;
const col3 = 420;
const col4 = 490;

doc.font("Helvetica-Bold").fontSize(9);
doc.text("Description", col1, tableTop);
doc.text("Qty", col2, tableTop);
doc.text("Unit Price", col3, tableTop);
doc.text("Amount", col4, tableTop);

// Line under header
doc.moveTo(col1, tableTop + 15).lineTo(550, tableTop + 15).stroke();

// Line items
const lineItems = [
  { description: "EC2 Reserved Instances - m5.2xlarge (production)", qty: "12", unit: "$1,125.00", amount: "$13,500.00" },
  { description: "RDS PostgreSQL Multi-AZ - db.r5.xlarge", qty: "3", unit: "$1,850.00", amount: "$5,550.00" },
  { description: "S3 Standard Storage (4.2 TB)", qty: "1", unit: "$3,800.00", amount: "$3,800.00" },
  { description: "CloudFront CDN - Data Transfer (8.5 TB)", qty: "1", unit: "$1,420.00", amount: "$1,420.00" },
  { description: "AWS Business Support Plan", qty: "1", unit: "$2,400.00", amount: "$2,400.00" },
  { description: "Lambda - Function Invocations (45M requests)", qty: "1", unit: "$890.00", amount: "$890.00" },
];

let y = tableTop + 25;
doc.font("Helvetica").fontSize(9);

for (const item of lineItems) {
  doc.text(item.description, col1, y);
  doc.text(item.qty, col2, y);
  doc.text(item.unit, col3, y);
  doc.text(item.amount, col4, y);
  y += 20;
}

// Subtotal section
y += 10;
doc.moveTo(col1, y).lineTo(550, y).stroke();
y += 15;

doc.font("Helvetica").fontSize(9);
doc.text("Subtotal:", col3, y);
doc.text("$27,560.00", col4, y);
y += 18;
doc.text("Tax (0%):", col3, y);
doc.text("$0.00", col4, y);
y += 18;
doc.font("Helvetica-Bold");
doc.text("Total Due:", col3, y);
doc.text("$27,560.00", col4, y);

// Footer
doc.moveDown(6);
doc.font("Helvetica").fontSize(8).fillColor("#888");
doc.text("Payment Terms: Net 30 | Wire to: JPMorgan Chase, Acct: 892-401-7753, Routing: 021000021", col1, undefined, { align: "center" });

doc.end();
console.log("Generated:", outputPath);
