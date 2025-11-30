# cdot‑RMM

This repository contains the initial skeleton for **cdot‑RMM**, a remote
monitoring and management (RMM) platform.  The goal of this project is to
build a modern, scalable monitoring solution composed of the following major
components:

* **Go Agent** – A lightweight daemon that runs on monitored hosts and
  periodically collects system metrics (CPU, memory, disk, network) and
  hardware information.  Agents connect securely to the backend via mTLS or
  signed JWTs and stream their metrics.
* **Backend Services** – A set of microservices implemented in Node.js
  (TypeScript) responsible for ingesting and normalising agent data,
  managing device inventory and performing network discovery.  Key
  services currently included are:
  - **ingestion‑service** – Receives metrics from agents and writes
    them into the database.
  - **device‑service** – Provides an API for device registration and
    CRUD operations on inventory records.  Agents call this service
    during installation and onboarding to register themselves.  MSP
    admins can also manually add/edit/remove devices.
  - **network‑collector** – Performs active scanning of specified IP
    ranges using SNMP, ICMP and (in the future) WMI to discover
    network devices.  Discovered devices are automatically registered
    with the device service.
  - **alert‑service** – Manages alerting rules and processes alert
    notifications.  MSP admins can define threshold rules (e.g. CPU > 85 %)
    via its API.  When the ingestion service detects that a metric
    breaches a rule, it calls the alert service which records the
    alert, logs it and (optionally) invokes external notification
    webhooks such as email, SMS or ITSM ticketing systems.
  - **patch‑service** – Coordinates remote patch deployment.  It stores
    patch metadata, maintains approval and scheduling records, and
    exposes endpoints for agents to fetch approved patches and report
    installation status.  Administrators can approve or deny patches,
    organise them into groups and define installation windows.  The
    service also generates compliance reports showing patch status and
    outstanding updates across all devices.
  - **automation‑service** – Provides an automation and workflow engine
    that technicians can use to respond to specific events (e.g.
    repeated service failures).  Workflows consist of multiple
    actions—running scripts, restarting services, isolating devices,
    sending notifications or opening tickets—that are executed when a
    matching event occurs.  Users can create, test and list
    workflows via the API, and audit logs capture every workflow
    execution for traceability.
  - **performance‑service** – Collects and aggregates network
    performance metrics.  Network collectors post several types of
    telemetry to this service: basic bandwidth/latency/loss samples,
    NetFlow/sFlow/J‑Flow records and SNMP interface statistics.  The
    service stores flow data and per‑interface counters then exposes
    endpoints to retrieve top talkers, aggregated reports, and
    time‑series trends.  Administrators can query these APIs to
    identify bottlenecks, view top bandwidth consumers, and drill
    down into individual interfaces by device or site.
* **Frontend Dashboard** – A set of React (TypeScript) applications for
  operators to view devices, alerts and network performance in real
  time.  The initial dashboard included in this repository is a
  **Network Performance Dashboard**.  It communicates with the
  performance service and renders charts and tables for bandwidth,
  latency, jitter and packet loss across all client sites.  Users can
  filter by site or time range, view top talkers (source/destination
  pairs ranked by traffic volume), inspect aggregated per‑interface
  metrics and drill down into detailed time‑series trends for
  individual interfaces.  Additional dashboards (e.g. device
  inventory, alert management) will be added in future commits.
* **Infrastructure** – Docker Compose files and (later) Kubernetes manifests
  to orchestrate the services in development and production.

This skeleton provides the base directory structure and starter
implementation code for the agent and several backend services.  It
implements the initial steps of **User Story 1 – Device onboarding and
inventory**: the agent registers itself with the server during
startup, a device service stores inventory records in PostgreSQL and
supports manual CRUD operations, and a network collector stub exists
for future SNMP/ICMP discovery.  It also begins work on **User Story 2 –
Real‑time alerting** by introducing an **alert service** and adding
rule evaluation logic to the ingestion service.  MSP administrators
can create threshold rules via the alert service’s API (e.g. CPU > 85 %).
Whenever the ingestion service stores a new metrics sample it checks
against these rules and sends an alert to the alert service when a
threshold is breached.  The alert service records the alert, logs it
and triggers external notification webhooks (email, SMS, ITSM) if
configured.

The repository now also introduces a **patch management** capability as
described in **User Story 3 – Remote patch deployment**.  A new
**patch service** manages patch metadata, approvals and schedules.  The
Go agent periodically checks the patch service for approved patches,
simulates downloading and installing them, and reports progress back
to the server.  Administrators can query available OS and third‑party
updates, approve or deny patches, create groups and specify
installation windows via the patch service’s API.  A compliance
report summarises patch status across devices.

The latest update addresses **User Story 5 – Network performance dashboard**.
The network collector now generates synthetic NetFlow/sFlow/J‑Flow and
SNMP interface statistics in addition to basic performance samples and
posts them to the performance service.  The performance service
persists flow data and per‑interface counters and provides new
endpoints to retrieve top talkers, aggregated interface reports and
time‑series trends.  A new React application under
`frontend/network-dashboard` consumes these APIs and renders a rich
dashboard with charts and tables.  Users can drill down into
interfaces, filter by site or time range, and identify bandwidth
hotspots, latency spikes and packet loss across client networks.

Future commits will continue to expand integrations, data models,
time‑series storage, frontend components and operational scripts.

## Project Structure

```
cdot-rmm/
├── agent/                     # Go agent code
│   ├── cmd/agent/             # agent entry point
│   │   └── main.go
│   └── internal/              # internal packages for collectors, transport, etc.
├── backend/
│   ├── ingestion-service/     # Node.js service for metrics ingestion
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts
│   ├── device-service/        # Device inventory API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/index.ts
│   └── network-collector/     # Network discovery service stub
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/index.ts
│   └── alert-service/         # Alert rule management and notification service
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/index.ts
│   └── patch-service/         # Patch management service
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/index.ts
│   └── automation-service/    # Automation and workflow engine
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/index.ts
│   └── performance-service/   # Network performance metrics service
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/index.ts
├── frontend/
│   └── network-dashboard/    # React dashboard for network performance
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── Dockerfile
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           └── main.tsx
├── infra/
│   └── docker-compose.yml     # Development‑focused orchestration
└── shared/
    └── protobuf/              # Place to store protobuf definitions

```

## Getting Started

### Prerequisites

- **Go** 1.20 or later to build the agent
- **Node.js** 18 or later with `npm` or `pnpm` to run the backend service
- **Docker** to spin up the infrastructure defined in `infra/docker-compose.yml`

### Development

1. Clone this repository and navigate into it:
   ```sh
   git clone <your-git-url> cdot-rmm
   cd cdot-rmm
   ```
2. Start the development stack using Docker Compose:
   ```sh
   docker compose up --build
   ```
   This will bring up a PostgreSQL database, Redis cache and the
   microservices defined in this repository.  The ingestion service
   listens on port `3000`, the device service on `3001`, the network
   collector on `3002`, the alert service on `3003`, the patch
   service on `3004`, the automation service on `3005` and the
   performance service on `3006` by default.

   Alternatively, a convenience script `setup.sh` is included at the
   repository root.  Running this script builds and starts all
   containers defined in `infra/docker-compose.yml` using either
   `docker compose` or `docker-compose` depending on your Docker
   version.  To use it, make sure the script is executable and run
   it from the repository root:

   ```sh
   chmod +x setup.sh
   ./setup.sh
   ```

   Once the stack is running, you can access the network performance
   dashboard at `http://localhost:3007`.
3. Build and run the agent (optional for now):
   ```sh
   cd agent
   go build ./cmd/agent
   ./agent
   ```

This project is under active development.  Contributions and feedback are
welcome!