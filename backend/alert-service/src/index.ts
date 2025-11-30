import express from 'express';
import { Pool } from 'pg';
import axios from 'axios';

/**
 * Alert service
 *
 * This service manages alerting rules and processes alert events when
 * metrics breach a threshold.  It exposes endpoints to create and
 * list alert rules and to receive alert notifications from the
 * ingestion service.  Upon receiving an alert, it records it in the
 * database and attempts to notify configured channels and create an
 * ITSM ticket via a webhook.  Notifications are simulated via
 * console logs for now; integration with an email/SMS provider or
 * third‑party ITSM system would be configured via environment
 * variables in a production deployment.
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

// Optional integration endpoints for ITSM or messaging systems.  In a
// real environment these would be configured to point at ServiceNow,
// Jira, Slack, Twilio, etc.  They are used only if set.
const ITSM_WEBHOOK_URL = process.env.ITSM_WEBHOOK_URL || '';
const EMAIL_WEBHOOK_URL = process.env.EMAIL_WEBHOOK_URL || '';
const SMS_WEBHOOK_URL = process.env.SMS_WEBHOOK_URL || '';

const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(express.json());

// Ensure alert_rules and alerts tables exist.  In production this
// responsibility would be handled by a migration tool, but we create
// tables on startup for simplicity.
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id SERIAL PRIMARY KEY,
      metric TEXT NOT NULL,
      threshold DOUBLE PRECISION NOT NULL,
      comparison TEXT NOT NULL,
      channel TEXT DEFAULT 'email',
      suggestion TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      device_id UUID NOT NULL,
      metric TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      threshold DOUBLE PRECISION NOT NULL,
      rule_id INTEGER REFERENCES alert_rules(id),
      suggestion TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// Health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Create an alert rule.  Expects a JSON body with at least metric,
// threshold and comparison.  channel, suggestion and description are
// optional.
app.post('/api/alert-rules', async (req, res) => {
  const { metric, threshold, comparison, channel, suggestion, description } = req.body;
  if (!metric || threshold === undefined || !comparison) {
    return res.status(400).json({ error: 'metric, threshold and comparison are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO alert_rules (metric, threshold, comparison, channel, suggestion, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [metric, threshold, comparison, channel ?? 'email', suggestion ?? null, description ?? null],
    );
    res.status(201).json({ rule_id: rows[0].id });
  } catch (err) {
    console.error('Failed to create alert rule', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// List all alert rules
app.get('/api/alert-rules', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_rules ORDER BY created_at DESC');
    res.json({ rules: rows });
  } catch (err) {
    console.error('Failed to list alert rules', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Receive an alert from the ingestion service.  Body should include
// device_id, metric, value, threshold and rule_id.  Suggestion and
// description may be provided or looked up.  The service logs the
// alert, saves it to the database and attempts to notify any
// configured channels.  It also calls the ITSM webhook if present.
app.post('/api/alerts', async (req, res) => {
  const { device_id, metric, value, threshold, rule_id, suggestion, description } = req.body;
  if (!device_id || !metric || value === undefined || threshold === undefined) {
    return res.status(400).json({ error: 'device_id, metric, value and threshold are required' });
  }
  try {
    await pool.query(
      `INSERT INTO alerts (device_id, metric, value, threshold, rule_id, suggestion, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [device_id, metric, value, threshold, rule_id ?? null, suggestion ?? null, description ?? null],
    );
    // Simulate sending notifications
    console.log(`ALERT: Device ${device_id} metric ${metric}=${value} breached threshold ${threshold}`);
    if (suggestion) {
      console.log(`Suggested remediation: ${suggestion}`);
    }
    // If email webhook is defined, post the alert
    if (EMAIL_WEBHOOK_URL) {
      try {
        await axios.post(EMAIL_WEBHOOK_URL, {
          device_id,
          metric,
          value,
          threshold,
          suggestion,
          description,
        });
      } catch (err) {
        console.error('Failed to post to email webhook', err);
      }
    }
    // Similarly, send SMS webhook
    if (SMS_WEBHOOK_URL) {
      try {
        await axios.post(SMS_WEBHOOK_URL, {
          device_id,
          metric,
          value,
          threshold,
          suggestion,
          description,
        });
      } catch (err) {
        console.error('Failed to post to SMS webhook', err);
      }
    }
    // Create ITSM ticket if webhook defined
    if (ITSM_WEBHOOK_URL) {
      try {
        await axios.post(ITSM_WEBHOOK_URL, {
          device_id,
          metric,
          value,
          threshold,
          suggestion,
          description,
        });
      } catch (err) {
        console.error('Failed to post to ITSM webhook', err);
      }
    }
    res.status(202).json({ status: 'alert_processed' });
  } catch (err) {
    console.error('Failed to process alert', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(PORT, async () => {
  await ensureTables();
  console.log(`Alert service listening on port ${PORT}`);
});