# Google Sheets REST API For Grafana PoV Tracker

A Node.js REST API to query rows from a Google Sheet using a Service Account.
It can be used for example to track the progress of a technical PoV with Grafana Dashboards
![PoC tracking dashboard](/assets/dashboard.png)

## Architecture

![Architecture](/assets/arch.png)

## Prerequisites

- Node.js 24+ or Docker on an Linux Machine
- A Google Cloud project with the **Google Sheets API** enabled
- A Google Service Account with a JSON key
- A Grafana Cloud Account with an apikey to create dashboards & datasources & pdcs

## Setup

### 1. Clone the repository

Clone this repo and create your `.env` file — you will fill in the values during the following steps:

```bash
git clone https://github.com/alainpham/gsheets-api
cd gsheets-api
cp .env.example .env
```

### 2. Enable Google Sheets API (if not enabled yet on the org)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services → Library**
3. Search for **Google Sheets API** and enable it

### 3. Create a Service Account

![Service Account for Google Sheet Access](/assets/gcp-iam-service-account.png)

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**, give it a name, and click **Done**
3. Open the service account, go to the **Keys** tab
4. Click **Add Key → Create new key → JSON**
5. Save the downloaded file as `service-account.json` in the project root

### 4. Share your Google Sheet

Open your Google Sheet and share it with the service account email (e.g. `my-sa@project.iam.gserviceaccount.com`), granting **Viewer** access.

Your sheet should have a tab with the following columns (the app will auto-detect the table by locating the `Requirement` header). The `Criteria Met` column accepts `Yes`, `No`, or `Partial`. The `Priority` column accepts `High`, `Medium`, or `Low`.

| Category | Business Objective Alignment | Requirement | Validation Method | Priority | Criteria Met | Date Validated | Validated By | Grafana Comments | Comments |
|----------|------------------------------|-------------|-------------------|----------|--------------|----------------|--------------|------------------|----------|
| Data Pipeline, Reversibility | Reduce operational efforts | Leverage Open Standards to collect logs, metrics, traces & profiles and guarantee full vendor agnosticity | PoV | Medium | Yes | 2026-04-17 | | | |
| Application Observability, Kubernetes Monitoring | Reduce operational efforts, Reduce MTTR | Turn key solution for Kubernetes monitoring, APM & Frontend monitoring, and most well known technologies (out of the box dashboards, alerts, configs) | PoV | High | Yes | 2026-04-17 | | | |

### 5. Create a Grafana Cloud Access Policy token

A single Cloud Access Policy token is used by the provisioning script for all operations (plugins, PDC, datasources, dashboards).

1. Go to [grafana.com](https://grafana.com) and sign in
2. Click your avatar (top-right) → **My Account**
3. In the left sidebar go to **Security → Access Policies**
4. Click **Add access policy**, give it a name (e.g. `pov-provisioner`), then under **Realms** select your organisation and your stack
5. Add the following scopes:

   | Scope | Purpose |
   |-------|---------|
   | `dashboards:read` / `dashboards:write` | Provision dashboards |
   | `datasources:read` / `datasources:write` | Create datasources |
   | `pdc:read` / `pdc:write` | Check for and register the PDC network |

6. Click **Create** → **Add token**, copy the token and save it as `GRAFANA_CLOUD_ACCESS_POLICY_TOKEN` in your `.env`

> The **cluster** name (e.g. `prod-eu-west-2`) and **numeric stack ID** are visible on the stack's detail page at grafana.com/orgs/`<org>`/stacks. Save them as `GRAFANA_CLUSTER` and `GRAFANA_STACK_ID`.

### 6. Configure environment

Open `.env` in your editor and fill in the variables below:

#### Google Sheets

| Variable | Required | Description |
|----------|----------|-------------|
| `SPREADSHEET_ID` | Yes | The ID from your sheet URL: `https://docs.google.com/spreadsheets/d/<ID>/edit` |
| `RANGE` | No | A1 notation range, e.g. `Success Criteria!B15:P36`. Leave empty to auto-detect the table by scanning for a `Requirement` column header |
| `GOOGLE_KEY_FILE` | No | Path to the service account JSON key (default: `service-account.json`) |
| `PORT` | No | HTTP port (default: `8080`) |

#### Grafana Cloud — used by `setup-grafana-cloud.sh`

| Variable | Required | Description |
|----------|----------|-------------|
| `GRAFANA_CLOUD_ACCESS_POLICY_TOKEN` | Yes | Cloud Access Policy token from grafana.com → Security → Access Policies (scopes: `dashboards:read/write`, `datasources:read/write`, `pdc:read/write`) |
| `GRAFANA_STACK_SLUG` | Yes | Stack subdomain — for `https://myorg.grafana.net` the slug is `myorg` |
| `GRAFANA_STACK_ID` | Yes | Numeric stack ID, visible in grafana.com/orgs/`<org>`/stacks |
| `GRAFANA_STACK_URL` | Yes | Full URL of your Grafana Cloud stack, e.g. `https://myorg.grafana.net` |
| `GRAFANA_CLUSTER` | Yes | Grafana Cloud cluster, e.g. `prod-eu-west-2` (visible in stack settings on grafana.com) |
| `PDC_NETWORK_NAME` | No | Name for the PDC network (default: `pov-pdc`) |
| `DATASOURCE_NAME` | No | Infinity datasource name in Grafana (default: `pov-success`) |
| `GSHEETS_API_URL` | No | URL where the container is reachable from Grafana Cloud via PDC (default: `http://172.17.0.1:8080`) |

### 7. Run the container

The container needs access to your `.env` file and `service-account.json` key, which are excluded from the image for security. Mount them at runtime:

```bash
docker run -d -p 172.17.0.1:8080:8080 \
  --name gsheets-api \
  --env-file .env \
  -v $(pwd)/service-account.json:/app/service-account.json:ro \
  alainpham/gsheets-api
```

The API will be available at `http://localhost:8080`.

> **Note:** The `service-account.json` path inside the container must match the `GOOGLE_KEY_FILE` value in your `.env` (default: `service-account.json`).

## Available Endpoints

| URL                                   | Description                       |
|---------------------------------------|-----------------------------------|
| `http://localhost:8080`               | UI — view sheet data in table     |
| `http://localhost:8080/docs`          | Swagger UI                        |
| `http://localhost:8080/openapi.json`  | Raw OpenAPI spec (JSON)           |

## Docker builds

### Build the image

```bash
docker build -t alainpham/gsheets-api .
```

### Push to Docker Hub

```bash
docker push alainpham/gsheets-api
```

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
