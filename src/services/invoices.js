// ================================================================
// invoices.js — invoice template filling service
//
// Supports DOCX templates with {{placeholder}} syntax.
// Available placeholders for single order:
//   {{wo_internal}}  {{wo_client}}  {{order_date}}  {{client_name}}
//   {{client_code}}  {{client_group}} {{service}}   {{category}}
//   {{provider_name}} {{place}}     {{reporter}}    {{start_time}}
//   {{end_time}}     {{duration}}   {{bandwidth}}   {{revenue}}
//   {{cost}}         {{profit}}     {{currency}}    {{payment_status}}
//   {{invoice_no}}   {{notes}}      {{paid_amount}} {{due_amount}}
//   {{generated_date}} {{generated_time}}
// ================================================================

const fs   = require('fs');
const path = require('path');
const db   = require('../db/database');

// ---- Helpers ----
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function fmtMoney(n) {
  if (n == null) return '0.00';
  return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---- Company settings (stored in app_settings) ----
function getCompanySettings() {
  const database = db.get();
  const getSetting = (k, d) => {
    const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
    return row ? row.value : d;
  };
  return {
    company_name:      getSetting('company_name',      'PMP Media Productions'),
    department_name:   getSetting('department_name',   'Production Department'),
    company_address:   getSetting('company_address',   ''),
    company_phone:     getSetting('company_phone',     ''),
    company_email:     getSetting('company_email',     ''),
    manager_name:      getSetting('manager_name',      ''),
    manager_title:     getSetting('manager_title',     'General Manager'),
    company_logo_path: getSetting('company_logo_path', '')
  };
}

// ---- Get full order data for template ----
function getOrderData(orderId) {
  const row = db.get().prepare('SELECT * FROM v_orders_full WHERE id = ?').get(Number(orderId));

  if (!row) throw new Error('ORDER_NOT_FOUND');

  const now = new Date();
  return {
    wo_internal:      row.wo_internal    || '',
    wo_client:        row.wo_client      || '',
    order_date:       fmtDate(row.order_date),
    client_name:      row.client_name    || '',
    client_code:      row.client_code    || '',
    client_group:     row.client_group   || '',
    service:          row.service        || '',
    category:         row.category       || '',
    provider_name:    row.provider_name  || '',
    space_provider:   row.space_provider_name || '',
    place:            row.place          || '',
    reporter:         row.reporter       || '',
    start_time:       row.start_time     || '',
    end_time:         row.end_time       || '',
    duration:         row.duration_minutes != null ? String(row.duration_minutes) + ' min' : '',
    bandwidth:        row.bandwidth_mhz  != null ? String(row.bandwidth_mhz) + ' MHz' : '',
    revenue:          fmtMoney(row.revenue),
    cost:             fmtMoney(row.cost),
    profit:           fmtMoney(row.profit),
    currency:         row.currency       || 'USD',
    payment_status:   row.payment_status || '',
    invoice_no:       row.invoice_no     || '',
    notes:            row.notes          || '',
    paid_amount:      fmtMoney(row.paid_amount),
    due_amount:       fmtMoney(row.due_amount),
    generated_date:   fmtDate(now.toISOString().slice(0, 10)),
    generated_time:   now.toTimeString().slice(0, 5),
  };
}

// ---- Fill a DOCX template ----
async function fillDocx(templatePath, orderId, outputPath) {
  let PizZip, Docxtemplater;
  try {
    PizZip        = require('pizzip');
    Docxtemplater = require('docxtemplater');
  } catch (e) {
    throw new Error('docxtemplater or pizzip not installed. Run: npm install docxtemplater pizzip');
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip     = new PizZip(content);
  const doc     = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks:    true
  });

  const data = getOrderData(orderId);
  doc.render(data);

  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, buf);
  return { ok: true, path: outputPath, data };
}

// ---- List available fields (for the UI to show) ----
function availableFields() {
  return [
    { field: 'wo_internal',    label: 'Internal WO Number' },
    { field: 'wo_client',      label: 'Client WO Number' },
    { field: 'order_date',     label: 'Order Date' },
    { field: 'client_name',    label: 'Client Name' },
    { field: 'client_code',    label: 'Client Code' },
    { field: 'client_group',   label: 'Client Group' },
    { field: 'service',        label: 'Service' },
    { field: 'category',       label: 'Category' },
    { field: 'provider_name',  label: 'Provider Name' },
    { field: 'space_provider', label: 'Space Provider' },
    { field: 'place',          label: 'Location' },
    { field: 'reporter',       label: 'Reporter / Guest' },
    { field: 'start_time',     label: 'Start Time' },
    { field: 'end_time',       label: 'End Time' },
    { field: 'duration',       label: 'Duration' },
    { field: 'bandwidth',      label: 'Bandwidth' },
    { field: 'revenue',        label: 'Revenue' },
    { field: 'cost',           label: 'Cost' },
    { field: 'profit',         label: 'Profit' },
    { field: 'currency',       label: 'Currency' },
    { field: 'payment_status', label: 'Payment Status' },
    { field: 'invoice_no',     label: 'Invoice Number' },
    { field: 'paid_amount',    label: 'Amount Paid' },
    { field: 'due_amount',     label: 'Amount Due' },
    { field: 'notes',          label: 'Notes' },
    { field: 'generated_date', label: 'Generated Date' },
    { field: 'generated_time', label: 'Generated Time' },
  ];
}

// ---- CLIENT-LEVEL INVOICE DATA ----
function getClientInvoiceData(clientId, filters = {}) {
  const database = db.get();
  const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
  if (!client) throw new Error('CLIENT_NOT_FOUND');

  const where = ['o.client_id = ?'];
  const args = [Number(clientId)];

  if (filters.from) { where.push('o.order_date >= ?'); args.push(filters.from); }
  if (filters.to)   { where.push('o.order_date <= ?'); args.push(filters.to); }

  const sql = `
    SELECT o.*, p.name AS provider_name
    FROM orders o
    LEFT JOIN providers p ON p.id = o.provider_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.order_date DESC, o.id DESC
  `;
  const orders = database.prepare(sql).all(...args);

  const totals = database.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(cost), 0) AS total_cost,
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COALESCE(SUM(revenue - cost), 0) AS total_profit
    FROM orders o
    WHERE ${where.join(' AND ')}
  `).get(...args);

  const company = getCompanySettings();

  return {
    company,
    client,
    orders,
    totals,
    filters,
    invoice_date: new Date().toISOString().slice(0, 10),
    invoice_number: `INV-${client.code}-${Date.now().toString().slice(-6)}`
  };
}

// ---- Word (.docx) invoice builder with table ----
async function generateWordInvoice(data, outputPath) {
  const PizZip = require('pizzip');

  // Build Word XML for the invoice document
  const rowsXml = data.orders.map(order => {
    const cells = [
      fmtDate(order.order_date),
      order.service || '',
      order.category || '',
      order.start_time || '',
      order.end_time || '',
      order.duration_minutes ? `${order.duration_minutes} min` : '',
      order.reporter || '',
      order.place || '',
      fmtMoney(order.cost || 0)
    ];
    return `
      <w:tr>
        ${cells.map((val, ci) => `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${ci === 8 ? '1200' : ci === 1 ? '2000' : '1200'}" w:type="dxa"/>
              <w:tcBorders>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
                <w:left w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
                <w:right w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
              </w:tcBorders>
              <w:vAlign w:val="center"/>
            </w:tcPr>
            <w:p>
              <w:pPr><w:jc w:val="${ci >= 7 ? 'right' : 'left'}"/></w:pPr>
              <w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(val)}</w:t></w:r>
            </w:p>
          </w:tc>
        `).join('')}
      </w:tr>
    `;
  }).join('');

  const headerCells = ['Date', 'Service', 'Category', 'Start', 'End', 'Duration', 'Reporter / Guest', 'Location', 'Cost'];
  const headerXml = headerCells.map((h, ci) => `
    <w:tc>
      <w:tcPr>
        <w:shd w:val="clear" w:color="auto" w:fill="1A3A5C"/>
        <w:tcW w:w="${ci === 8 ? '1200' : ci === 1 ? '2000' : '1200'}" w:type="dxa"/>
        <w:tcBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
        </w:tcBorders>
        <w:vAlign w:val="center"/>
      </w:tcPr>
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r>
          <w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
          <w:t xml:space="preserve">${escXml(h)}</w:t>
        </w:r>
      </w:p>
    </w:tc>
  `).join('');

  const groupLine = data.client.group_name
    ? `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="5A6A7A"/></w:rPr><w:t xml:space="preserve">Group / Channel: ${escXml(data.client.group_name)}</w:t></w:r></w:p>`
    : '';

  const contactParts = [data.company.company_address, data.company.company_phone, data.company.company_email].filter(Boolean);
  const contactLine = contactParts.length
    ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="7F8C8D"/></w:rPr><w:t xml:space="preserve">${escXml(contactParts.join('   ·   '))}</w:t></w:r></w:p>`
    : '';

  const managerLine = data.company.manager_name
    ? `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="5A6A7A"/></w:rPr><w:t xml:space="preserve">${escXml(data.company.manager_name)} — ${escXml(data.company.manager_title)}</w:t></w:r></w:p>`
    : '';

  const bodyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <!-- Company Header -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/><w:color w:val="1A3A5C"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr>
        <w:t xml:space="preserve">${escXml(data.company.company_name)}</w:t>
      </w:r>
    </w:p>
    ${data.company.department_name ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="5A6A7A"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escXml(data.company.department_name)}</w:t></w:r></w:p>` : ''}
    ${contactLine}
    <w:p><w:r><w:rPr><w:sz w:val="8"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>

    <!-- Invoice Title -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/><w:color w:val="2C3E50"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr><w:t xml:space="preserve">I N V O I C E</w:t></w:r>
    </w:p>
    <w:p><w:r><w:rPr><w:sz w:val="8"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>

    <!-- Invoice Meta -->
    <w:p>
      <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">Invoice #: </w:t></w:r>
      <w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(data.invoice_number)}</w:t></w:r>
      <w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">        Date: </w:t></w:r>
      <w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(fmtDate(data.invoice_date))}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">Bill To: </w:t></w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(data.client.name)} (${escXml(data.client.code)})</w:t></w:r>
    </w:p>
    ${groupLine}
    <w:p><w:r><w:rPr><w:sz w:val="8"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>

    <!-- Orders Table -->
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="1A3A5C"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D9E2"/>
        </w:tblBorders>
        <w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
      </w:tblPr>
      <w:tr>
        ${headerXml}
      </w:tr>
      ${rowsXml}
      <!-- Totals row -->
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:gridSpan w:val="8"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1A3A5C"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:bottom w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:left w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:right w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
            </w:tcBorders>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:jc w:val="right"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
              <w:t xml:space="preserve">TOTAL · ${data.totals.total_orders} order${data.totals.total_orders !== 1 ? 's' : ''}</w:t>
            </w:r>
          </w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:shd w:val="clear" w:color="auto" w:fill="1A3A5C"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:bottom w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:left w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
              <w:right w:val="single" w:sz="6" w:space="0" w:color="1A3A5C"/>
            </w:tcBorders>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:jc w:val="right"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
              <w:t xml:space="preserve">$${escXml(fmtMoney(data.totals.total_cost))}</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>

    <w:p><w:r><w:rPr><w:sz w:val="8"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>

    <!-- Signature Section -->
    <w:p>
      <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="2C3E50"/></w:rPr><w:t xml:space="preserve">Authorized Signature</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="95A5A6"/></w:rPr><w:t xml:space="preserve">________________________________</w:t></w:r>
    </w:p>
    ${managerLine}
    <w:p><w:r><w:rPr><w:sz w:val="8"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:jc w:val="right"/></w:pPr>
      <w:r><w:rPr><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="BDC3C7"/></w:rPr><w:t xml:space="preserve">[ Company Stamp / Seal ]</w:t></w:r>
    </w:p>

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // Build minimal .docx package
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', bodyXml);
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, buf);
  return {
    ok: true,
    path: outputPath,
    orderCount: data.orders.length,
    totalCost: data.totals.total_cost
  };
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, () => '&' + 'amp;')
    .replace(/</g, () => '&' + 'lt;')
    .replace(/>/g, () => '&' + 'gt;')
    .replace(/"/g, () => '&' + 'quot;')
    .replace(/'/g, () => '&' + 'apos;');
}

// ---- GENERATE FORMATTED EXCEL INVOICE ----
async function generateExcelInvoice(data, outputPath) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoice', {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      paperSize: 9
    },
    headerFooter: {
      oddHeader: data.company.company_name
        ? `&C&B${data.company.company_name}`
        : '&C&BPMP Invoice',
      oddFooter: '&CPage &P of &N'
    }
  });

  // Column widths (9 columns — no revenue)
  ws.columns = [
    { width: 14 },  // A Date
    { width: 26 },  // B Service
    { width: 12 },  // C Category
    { width: 10 },  // D Start
    { width: 10 },  // E End
    { width: 12 },  // F Duration
    { width: 20 },  // G Reporter
    { width: 18 },  // H Location
    { width: 14 }   // I Cost
  ];

  let r = 1;

  // ===== COMPANY HEADER =====
  ws.mergeCells(`A${r}:I${r}`);
  const cName = ws.getCell(`A${r}`);
  cName.value = data.company.company_name;
  cName.font = { name: 'Arial', size: 22, bold: true, color: { argb: 'FF1A3A5C' } };
  cName.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 34;
  r++;

  if (data.company.department_name) {
    ws.mergeCells(`A${r}:I${r}`);
    const cDept = ws.getCell(`A${r}`);
    cDept.value = data.company.department_name;
    cDept.font = { name: 'Arial', size: 12, color: { argb: 'FF5A6A7A' } };
    cDept.alignment = { horizontal: 'center' };
    r++;
  }

  const contactParts = [data.company.company_address, data.company.company_phone, data.company.company_email].filter(Boolean);
  if (contactParts.length) {
    ws.mergeCells(`A${r}:I${r}`);
    const cContact = ws.getCell(`A${r}`);
    cContact.value = contactParts.join('   ·   ');
    cContact.font = { name: 'Arial', size: 9, color: { argb: 'FF7F8C8D' } };
    cContact.alignment = { horizontal: 'center' };
    r++;
  }

  r++; // spacer

  // ===== INVOICE TITLE =====
  ws.mergeCells(`A${r}:I${r}`);
  const invTitle = ws.getCell(`A${r}`);
  invTitle.value = 'I N V O I C E';
  invTitle.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FF2C3E50' } };
  invTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 28;
  r++;

  r++; // spacer

  // ===== INVOICE META =====
  ws.getCell(`A${r}`).value = 'Invoice #:';
  ws.getCell(`A${r}`).font = { bold: true, size: 11 };
  ws.getCell(`B${r}`).value = data.invoice_number;
  ws.getCell(`B${r}`).font = { size: 11 };
  ws.getCell(`D${r}`).value = 'Date:';
  ws.getCell(`D${r}`).font = { bold: true, size: 11 };
  ws.getCell(`E${r}`).value = fmtDate(data.invoice_date);
  ws.getCell(`E${r}`).font = { size: 11 };
  r++;

  ws.getCell(`A${r}`).value = 'Bill To:';
  ws.getCell(`A${r}`).font = { bold: true, size: 11 };
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = `${data.client.name}  (${data.client.code})`;
  ws.getCell(`B${r}`).font = { bold: true, size: 11 };
  r++;

  if (data.client.group_name) {
    ws.mergeCells(`B${r}:E${r}`);
    ws.getCell(`B${r}`).value = `Group / Channel: ${data.client.group_name}`;
    ws.getCell(`B${r}`).font = { size: 10, color: { argb: 'FF5A6A7A' } };
    r++;
  }

  r++; // spacer

  // ===== ORDERS TABLE =====
  const headers = ['Date', 'Service', 'Category', 'Start', 'End', 'Duration', 'Reporter / Guest', 'Location', 'Cost'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1A3A5C' } },
      bottom: { style: 'thin', color: { argb: 'FF1A3A5C' } },
      left: { style: 'thin', color: { argb: 'FF1A3A5C' } },
      right: { style: 'thin', color: { argb: 'FF1A3A5C' } }
    };
  });
  ws.getRow(r).height = 24;
  r++;

  data.orders.forEach((order, idx) => {
    const vals = [
      fmtDate(order.order_date),
      order.service || '',
      order.category || '',
      order.start_time || '',
      order.end_time || '',
      order.duration_minutes ? `${order.duration_minutes} min` : '',
      order.reporter || '',
      order.place || '',
      Number(order.cost) || 0
    ];
    vals.forEach((val, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = val;
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D9E2' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D9E2' } },
        left: { style: 'thin', color: { argb: 'FFD0D9E2' } },
        right: { style: 'thin', color: { argb: 'FFD0D9E2' } }
      };
      cell.alignment = { horizontal: i >= 8 ? 'right' : 'left', vertical: 'middle' };
      cell.font = { size: 11 };
      if (i >= 8) cell.numFmt = '"$"#,##0.00';
    });
    // alternate row shading
    if (idx % 2 === 1) {
      for (let i = 1; i <= 9; i++) {
        ws.getCell(r, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8FB' } };
      }
    }
    r++;
  });

  // ===== TOTALS ROW =====
  r++;
  ws.mergeCells(`A${r}:H${r}`);
  const totalLabel = ws.getCell(`A${r}`);
  totalLabel.value = `TOTAL  ·  ${data.totals.total_orders} order${data.totals.total_orders !== 1 ? 's' : ''}`;
  totalLabel.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  totalLabel.alignment = { horizontal: 'right', vertical: 'middle' };

  ws.getCell(`I${r}`).value = Number(data.totals.total_cost);
  ws.getCell(`I${r}`).font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  ws.getCell(`I${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  ws.getCell(`I${r}`).numFmt = '"$"#,##0.00';
  ws.getCell(`I${r}`).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(r).height = 32;
  r += 2;

  // ===== SIGNATURE SECTION =====
  r += 2;
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = 'Authorized Signature';
  ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FF2C3E50' } };
  r++;

  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = '________________________________';
  ws.getCell(`A${r}`).font = { size: 11, color: { argb: 'FF95A5A6' } };
  r++;

  if (data.company.manager_name) {
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value = `${data.company.manager_name} — ${data.company.manager_title}`;
    ws.getCell(`A${r}`).font = { size: 10, color: { argb: 'FF5A6A7A' } };
    r++;
  }

  // Seal / stamp placeholder
  r++;
  ws.mergeCells(`F${r}:I${r}`);
  ws.getCell(`F${r}`).value = '[ Company Stamp / Seal ]';
  ws.getCell(`F${r}`).font = { italic: true, size: 10, color: { argb: 'FFBDC3C7' } };
  ws.getCell(`F${r}`).alignment = { horizontal: 'center' };

  // ===== SAVE =====
  await wb.xlsx.writeFile(outputPath);
  return {
    ok: true,
    path: outputPath,
    orderCount: data.orders.length,
    totalCost: data.totals.total_cost
  };
}

module.exports = { fillDocx, getOrderData, availableFields, getClientInvoiceData, generateExcelInvoice, generateWordInvoice, getCompanySettings };
