const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const doc = new PDFDocument({ margin: 50 });
const outputPath = path.join(process.env.HOME, "Desktop", "sample-invoice-cdw.pdf");
doc.pipe(fs.createWriteStream(outputPath));

// Header
doc.fontSize(20).font("Helvetica-Bold").text("INVOICE", { align: "right" });
doc.moveDown(0.5);
doc.fontSize(10).font("Helvetica").text("Invoice #: CDW-7294851", { align: "right" });
doc.text("Date: May 12, 2026", { align: "right" });
doc.text("Due Date: June 11, 2026", { align: "right" });
doc.text("PO #: PO-2026-04428", { align: "right" });

doc.moveDown(2);

// Vendor info
doc.fontSize(14).font("Helvetica-Bold").text("CDW CANADA CORP.");
doc.fontSize(10).font("Helvetica").text("55 Town Centre Court, Suite 600");
doc.text("Toronto, ON M1P 4X4");
doc.text("Canada");
doc.text("Tax ID: 85672 3401 RT0001");

doc.moveDown(1.5);

// Bill To
doc.fontSize(10).font("Helvetica-Bold").text("Bill To:");
doc.font("Helvetica").text("Customer Account: cuacc_cl1bul55b000401qmifxrd70e");
doc.text("Procurement Department");
doc.text("IT Equipment & Licensing");

doc.moveDown(2);

// Table header
const tableTop = doc.y;
const col1 = 50;
const col2 = 70;
const col3 = 370;
const col4 = 430;
const col5 = 500;

doc.font("Helvetica-Bold").fontSize(9);
doc.text("#", col1, tableTop);
doc.text("Description", col2, tableTop);
doc.text("Qty", col3, tableTop);
doc.text("Unit Price", col4, tableTop);
doc.text("Amount", col5, tableTop);

// Line under header
doc.moveTo(col1, tableTop + 15).lineTo(560, tableTop + 15).stroke();

// Line items - mix of items that should trigger different GL codes (96 vs 201 vs 153)
const lineItems = [
  { num: "1", description: "Dell PowerEdge R760 Server - 2x Intel Xeon Gold", qty: "4", unit: "$8,445.00", amount: "$33,780.00" },
  { num: "2", description: "Cisco Catalyst 9300-48P Network Switch", qty: "6", unit: "$5,892.00", amount: "$35,352.00" },
  { num: "3", description: "Microsoft 365 E5 License - Annual (50 seats)", qty: "1", unit: "$2,280.00", amount: "$2,280.00" },
  { num: "4", description: "VMware vSphere Enterprise Plus - Per CPU License", qty: "8", unit: "$4,118.00", amount: "$32,944.00" },
  { num: "5", description: "APC Smart-UPS SRT 5000VA RM", qty: "2", unit: "$4,650.00", amount: "$9,300.00" },
  { num: "6", description: "Cat6A Cabling & Installation - Server Room B", qty: "1", unit: "$1,875.00", amount: "$1,875.00" },
  { num: "7", description: "Lenovo ThinkPad X1 Carbon Gen 12", qty: "15", unit: "$1,849.00", amount: "$27,735.00" },
  { num: "8", description: "Shipping & Handling", qty: "1", unit: "$485.00", amount: "$485.00" },
];

let y = tableTop + 25;
doc.font("Helvetica").fontSize(9);

for (const item of lineItems) {
  doc.text(item.num, col1, y);
  doc.text(item.description, col2, y);
  doc.text(item.qty, col3, y);
  doc.text(item.unit, col4, y);
  doc.text(item.amount, col5, y);
  y += 20;
}

// Subtotal section
y += 10;
doc.moveTo(col1, y).lineTo(560, y).stroke();
y += 15;

doc.font("Helvetica").fontSize(9);
doc.text("Subtotal:", col4, y);
doc.text("$143,751.00", col5, y);
y += 18;
doc.text("HST (13%):", col4, y);
doc.text("$18,687.63", col5, y);
y += 18;
doc.font("Helvetica-Bold");
doc.text("Total Due:", col4, y);
doc.text("$162,438.63", col5, y);

// Footer
doc.moveDown(6);
doc.font("Helvetica").fontSize(8).fillColor("#888");
doc.text("Payment Terms: Net 30 | Wire to: RBC Royal Bank, Transit: 00266, Acct: 1049-382", 50, undefined, { align: "center" });
doc.text("For questions: ar@cdw.ca | Reference this invoice number on all correspondence", { align: "center" });

doc.end();
console.log("Generated:", outputPath);
