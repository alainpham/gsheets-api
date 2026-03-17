# Google Sheets REST API

A Node.js REST API to query rows from a Google Sheet using a Service Account.

## Prerequisites

- Node.js 18+
- A Google Cloud project with the **Google Sheets API** enabled
- A Google Service Account with a JSON key

## Setup

### 1. Enable Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services → Library**
3. Search for **Google Sheets API** and enable it

### 2. Create a Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**, give it a name, and click **Done**
3. Open the service account, go to the **Keys** tab
4. Click **Add Key → Create new key → JSON**
5. Save the downloaded file as `service-account.json` in the project root

### 3. Share your Google Sheet

Open your Google Sheet and share it with the service account email (e.g. `my-sa@project.iam.gserviceaccount.com`), granting **Viewer** access.

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# The ID from your Google Sheet URL:
# https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
SPREADSHEET_ID=your_spreadsheet_id_here

# Default sheet range in A1 notation
RANGE=Sheet1!A1:Z1000

# Path to your service account key file
GOOGLE_KEY_FILE=service-account.json

# Server port (optional, default: 8080)
PORT=8080
```

### 5. Install dependencies

```bash
npm install
```

## Running the API

```bash
npm start
```

The server starts at `http://localhost:8080`.

---

## Docker

### Build the image

```bash
docker build -t alainpham/gsheets-api .
```

### Push to Docker Hub

```bash
docker push alainpham/gsheets-api
```

### Run the container

The container needs access to your `.env` file and `service-account.json` key, which are excluded from the image for security. Mount them at runtime:

```bash
docker run -p 172.17.0.1:8080:8080 \
  --name gsheets-api \
  --env-file .env \
  -v $(pwd)/service-account.json:/app/service-account.json:ro \
  alainpham/gsheets-api
```

The API will be available at `http://localhost:8080`.

> **Note:** The `service-account.json` path inside the container must match the `GOOGLE_KEY_FILE` value in your `.env` (default: `service-account.json`).

| URL | Description |
|-----|-------------|
| `http://localhost:8080` | UI — view sheet data in a table |
| `http://localhost:8080/docs` | Swagger UI |
| `http://localhost:8080/openapi.json` | Raw OpenAPI spec (JSON) |

---

## API Reference

> Row indices are **0-based** and do not count the header row.
> The first row of your sheet is always treated as column headers.

### `GET /rows`

Returns all rows as JSON objects.

**Query params:**
| Param | Description | Example |
|-------|-------------|---------|
| `range` | Optional A1 notation range | `Sheet1!A1:N100` |

**Example:**
```bash
curl http://localhost:8080/rows
```

```json
{
  "headers": [
    "Category", "Business Objective Alignment", "Requirement", "Validation Method",
    "Priority ", "Criteria Met ", "Date Validated", "Validated By",
    "Grafana Comments", "Comments", "Link to resources", "Complexity Level",
    "Completion", "Total Completion"
  ],
  "total": 2,
  "rows": [
    {
      "Category": "Performance",
      "Business Objective Alignment": "Reduce latency",
      "Requirement": "P95 response time < 200ms",
      "Validation Method": "Load test",
      "Priority ": "High",
      "Criteria Met ": "Yes",
      "Date Validated": "2024-01-15",
      "Validated By": "John Doe",
      "Grafana Comments": "Dashboard link attached",
      "Comments": "Tested under 500 concurrent users",
      "Link to resources": "https://grafana.example.com/d/abc",
      "Complexity Level": "Medium",
      "Completion": "100%",
      "Total Completion": "100%"
    },
    {
      "Category": "Reliability",
      "Business Objective Alignment": "Improve uptime",
      "Requirement": "99.9% availability SLA",
      "Validation Method": "Monitoring review",
      "Priority ": "High",
      "Criteria Met ": "In Progress",
      "Date Validated": "",
      "Validated By": "",
      "Grafana Comments": "",
      "Comments": "Pending final sign-off",
      "Link to resources": "",
      "Complexity Level": "High",
      "Completion": "75%",
      "Total Completion": "75%"
    }
  ]
}
```

---

### `GET /rows/:index`

Returns a single row by its 0-based index.

**Example:**
```bash
curl http://localhost:8080/rows/0
```

```json
{
  "index": 0,
  "row": {
    "Category": "Performance",
    "Business Objective Alignment": "Reduce latency",
    "Requirement": "P95 response time < 200ms",
    "Validation Method": "Load test",
    "Priority ": "High",
    "Criteria Met ": "Yes",
    "Date Validated": "2024-01-15",
    "Validated By": "John Doe",
    "Grafana Comments": "Dashboard link attached",
    "Comments": "Tested under 500 concurrent users",
    "Link to resources": "https://grafana.example.com/d/abc",
    "Complexity Level": "Medium",
    "Completion": "100%",
    "Total Completion": "100%"
  }
}
```

---

## Project structure

```
.
├── index.js              # REST API server
├── openapi.js            # OpenAPI spec
├── public/
│   └── index.html        # Read-only table UI
├── Dockerfile
├── .dockerignore
├── service-account.json  # Google service account key (do not commit)
├── .env                  # Environment variables (do not commit)
├── .env.example          # Environment variable template
├── .gitignore
└── package.json
```
