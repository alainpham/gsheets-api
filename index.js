import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import swaggerUi from 'swagger-ui-express';
import { spec } from './openapi.js';

dotenv.config();

const PORT = process.env.PORT || 8080;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const RANGE = process.env.RANGE || '';
const KEY_FILE = process.env.GOOGLE_KEY_FILE || 'service-account.json';

if (!SPREADSHEET_ID) {
  console.error('Error: SPREADSHEET_ID is required in .env');
  process.exit(1);
}

function getSheetsClient() {
  const credentials = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

function toObjects(headers, rows) {
  return rows.map((row) => Object.fromEntries(headers.map((h, j) => [h, row[j] ?? ''])));
}

// Scans every sheet for the first row that contains a "Requirement" column,
// then collects consecutive data rows until the Requirement cell is empty.
async function autoDetectRows() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetNames = meta.data.sheets.map((s) => s.properties.title);

  for (const sheetName of sheetNames) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:Z500`,
    });

    const allRows = res.data.values || [];
    const headerRowIndex = allRows.findIndex((row) => row.includes('Requirement'));
    if (headerRowIndex === -1) continue;

    const rawHeaders = allRows[headerRowIndex];
    const startCol = rawHeaders.findIndex((h) => h && h.trim());
    if (startCol === -1) continue;

    const headers = rawHeaders.slice(startCol);
    const reqCol = headers.indexOf('Requirement');
    const dataRows = [];

    for (let i = headerRowIndex + 1; i < allRows.length; i++) {
      if (!(allRows[i]?.[startCol + reqCol] || '').trim()) break;
      dataRows.push(allRows[i].slice(startCol));
    }

    if (dataRows.length > 0) {
      return { headers, rows: toObjects(headers, dataRows), sheetName, headerRow: headerRowIndex + 1, startCol };
    }
  }

  throw new Error('Could not find a table with a "Requirement" column header in any sheet');
}

// Cache for auto-detected rows, refreshed every 30 seconds.
let autoDetectCache = null;

function colLetter(index) {
  let letter = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
}

async function refreshAutoDetectCache() {
  try {
    console.log('[auto-detect] Scanning spreadsheet for table…');
    const result = await autoDetectRows();
    autoDetectCache = result;

    const { headers, rows, sheetName, headerRow, startCol } = result;
    const firstCol = colLetter(startCol);
    const lastCol  = colLetter(startCol + headers.length - 1);
    const range    = `'${sheetName}'!${firstCol}${headerRow}:${lastCol}${headerRow + rows.length}`;

    console.log(`[auto-detect] Found ${rows.length} rows  |  range: ${range}`);
    console.log(`[auto-detect] Columns: ${headers.filter(Boolean).join(' | ')}`);
    console.log('[auto-detect] Sample data (up to 5 rows):');
    rows.slice(0, 5).forEach((row, i) => console.log(`  [${i}] Requirement: ${row['Requirement']}  |  Priority: ${row['Priority '] ?? row['Priority']}`));
  } catch (err) {
    console.error('[auto-detect] Refresh failed:', err.message);
  }
}

// Fetch all rows as an array of objects (first row = headers).
// If range is empty, uses the auto-detect cache.
async function fetchRows(range) {
  if (!range) {
    if (!autoDetectCache) await refreshAutoDetectCache();
    return autoDetectCache;
  }

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const [headers, ...rows] = res.data.values || [];
  if (!headers) return { headers: [], rows: [] };
  return { headers, rows: toObjects(headers, rows) };
}

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
app.get('/openapi.json', (req, res) => res.json(spec));
app.get('/config', (req, res) => {
  let effectiveRange = RANGE;
  if (!RANGE && autoDetectCache) {
    const { sheetName, headerRow, headers, rows, startCol } = autoDetectCache;
    effectiveRange = `'${sheetName}'!${colLetter(startCol)}${headerRow}:${colLetter(startCol + headers.length - 1)}${headerRow + rows.length}`;
  }
  res.json({ range: effectiveRange, autoDetected: !RANGE });
});

// GET /rows?range=Sheet1!A1:Z100
// Returns all rows as JSON objects
app.get('/rows', async (req, res) => {
  try {
    const { range } = req.query;
    const { headers, rows } = await fetchRows(range || RANGE);
    res.json({ headers, total: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /rows/:index  (0-based, not counting header row)
// Returns a single row by index
app.get('/rows/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'index must be a non-negative integer' });
    }

    const { rows } = await fetchRows(RANGE);
    if (index >= rows.length) {
      return res.status(404).json({ error: `Row ${index} not found` });
    }

    res.json({ index, row: rows[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!RANGE) {
    refreshAutoDetectCache();
    setInterval(refreshAutoDetectCache, 120_000);
  } else {
    console.log(`[range] Using configured range: ${RANGE}`);
    try {
      const { headers, rows } = await fetchRows(RANGE);
      console.log(`[range] ${rows.length} rows  |  Columns: ${headers.filter(Boolean).join(' | ')}`);
      console.log('[range] Sample data (up to 5 rows):');
      rows.slice(0, 5).forEach((row, i) => console.log(`  [${i}] Requirement: ${row['Requirement']}  |  Priority: ${row['Priority '] ?? row['Priority']}`));
    } catch (err) {
      console.error('[range] Failed to fetch sample data:', err.message);
    }
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
