import express from 'express';
import { Pool } from 'pg';
import axios from 'axios';

// Read environment variables for configuration.  The `.env` file or
// Docker‑compose file should supply these values in development; in
// production they can come from the environment or secret manager.
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

// Create a PostgreSQL connection pool.  In a more advanced
// implementation we might use a separate metrics database such as
// TimescaleDB, VictoriaMetrics, or InfluxDB.  For now we stick with
// vanilla PostgreSQL.
const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();

// Middleware to parse JSON bodies.
app.use(express.json());

// Health check endpoint to verify the service is up.
app.get('/healthz', (_req, res) => {
  res.status(200).send({ status: 'ok' });
});

// POST /api/ingest receives a metrics payload from an agent and stores it
// into the database.  The expected schema for the request body is:
//
// {
//   "device_id": "uuid",
//   "timestamp": "2025-11-25T12:00:00Z",
//   "metrics": {
//     "cpu": 0.55,
//     "memory": 0.70,
//     "disk": 0.30,
//     "network": 1024
//   }
// }
//
// This handler performs minimal validation and inserts the data into
// a table called `metrics`.  The table will be created by a future
// migration script.
app.post('/api/ingest', async (req, res) => {
  const { device_id, timestamp, metrics } = req.body;
  if (!device_id || !timestamp || !metrics) {
    return res.status(400).json({ error: 'device_id, timestamp and metrics are required' });
  }
  try {
    await pool.query(
      'INSERT INTO metrics(device_id, timestamp, cpu, memory, disk, network) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        device_id,
        new Date(timestamp),
        metrics.cpu ?? null,
        metrics.memory ?? null,
        metrics.disk ?? null,
        metrics.network ?? null,
      ],
    );
    // Evaluate alert rules asynchronously.  We do not await this call
    // to avoid delaying the response; any errors will be logged.
    evaluateRules(device_id, metrics).catch((err) => {
      console.error('rule evaluation error', err);
    });
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    console.error('Failed to insert metrics', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Evaluate alert rules for a given device and metrics payload.  This
 * function retrieves all alert rules from the database and checks
 * whether the current metrics breach any thresholds.  When a breach is
 * detected it sends an alert to the alert service.  Suggestions are
 * generated from the rule or a default mapping.
 */
async function evaluateRules(deviceId: string, metrics: Record<string, number>) {
  try {
    const { rows: rules } = await pool.query('SELECT id, metric, threshold, comparison, suggestion, description FROM alert_rules');
    for (const rule of rules) {
      const value = (metrics as any)[rule.metric];
      if (value === undefined || value === null) continue;
      let breach = false;
      if (rule.comparison === 'gt' && value > rule.threshold) breach = true;
      if (rule.comparison === 'lt' && value < rule.threshold) breach = true;
      if (breach) {
        const suggestion = rule.suggestion ?? getDefaultSuggestion(rule.metric);
        const description = rule.description ?? `Metric ${rule.metric} ${rule.comparison} threshold ${rule.threshold}`;
        await sendAlert({
          device_id: deviceId,
          metric: rule.metric,
          value,
          threshold: rule.threshold,
          rule_id: rule.id,
          suggestion,
          description,
        });
      }
    }
  } catch (err) {
    console.error('Failed to evaluate alert rules', err);
  }
}

/**
 * Send an alert to the alert service.  This helper wraps the HTTP
 * request to the alert service, handling any errors gracefully.
 */
async function sendAlert(payload: any) {
  const url = process.env.ALERT_SERVICE_URL || 'http://alert-service:3003/api/alerts';
  try {
    await axios.post(url, payload);
  } catch (err) {
    console.error('Failed to send alert', err);
  }
}

/**
 * Provide default remediation suggestions based on common metrics.  If
 * no specific suggestion exists for a metric the generic fallback is
 * returned.
 */
function getDefaultSuggestion(metric: string): string {
  switch (metric) {
    case 'cpu':
      return 'Investigate high CPU usage by reviewing running processes and workloads.';
    case 'memory':
      return 'Analyse memory consumption and optimise applications to reduce usage.';
    case 'disk':
      return 'Check disk utilisation; free up space or expand storage as required.';
    case 'latency':
      return 'Investigate network latency; verify connectivity and reduce load.';
    default:
      return 'Investigate the alert condition and take appropriate action.';
  }
}

app.listen(PORT, () => {
  console.log(`Ingestion service listening on port ${PORT}`);
});