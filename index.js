import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import swaggerUi from 'swagger-ui-express';
import { spec } from './openapi.js';

dotenv.config();

const PORT = process.env.PORT || 8080;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const RANGE = process.env.RANGE || 'Sheet1!A1:Z1000';
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

// Fetch all rows as an array of objects (first row = headers)
async function fetchRows(range) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range || RANGE,
  });

  const [headers, ...rows] = res.data.values || [];
  if (!headers) return { headers: [], rows: [] };

  return {
    headers,
    rows: rows.map((row) =>
      Object.fromEntries(headers.map((h, j) => [h, row[j] ?? '']))
    ),
  };
}

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
app.get('/openapi.json', (req, res) => res.json(spec));
app.get('/config', (req, res) => res.json({ range: RANGE }));

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

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
