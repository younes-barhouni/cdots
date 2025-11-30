import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

/**
 * Automation and workflow service
 *
 * This service allows technicians to define automation workflows that are
 * triggered by events (e.g. service failures).  Workflows consist of a
 * set of actions such as running scripts, restarting services,
 * isolating devices, sending notifications or creating tickets.  The
 * service provides endpoints to create workflows, list them, test
 * workflows in a sandbox environment, submit events for processing and
 * retrieve audit logs of workflow executions.  Conditions are stored
 * alongside workflows but are not evaluated in this simplified
 * implementation—every matching event type will trigger the workflow.
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      conditions JSONB,
      test_mode BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_actions (
      id SERIAL PRIMARY KEY,
      workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      parameters JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_logs (
      id SERIAL PRIMARY KEY,
      workflow_id INTEGER REFERENCES workflows(id) ON DELETE SET NULL,
      event_data JSONB,
      result JSONB,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// Health endpoint
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Create a new workflow.  Expects a JSON body with the following
 * properties:
 * - name: a descriptive name for the workflow
 * - event_type: the type of event that will trigger this workflow
 * - conditions: optional JSON object describing conditions (ignored in this implementation)
 * - actions: an array of objects with action_type and parameters
 * - test: optional boolean indicating whether to immediately test the workflow
 *   after creation
 *
 * Returns the created workflow ID and (if test is true) the test
 * execution result.
 */
app.post('/api/workflows', async (req, res) => {
  const { name, event_type, conditions, actions, test } = req.body;
  if (!name || !event_type || !Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'name, event_type and at least one action are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO workflows (name, event_type, conditions) VALUES ($1, $2, $3) RETURNING id`,
      [name, event_type, conditions ?? null],
    );
    const workflowId = rows[0].id;
    // Insert actions
    for (const action of actions) {
      await pool.query(
        `INSERT INTO workflow_actions (workflow_id, action_type, parameters) VALUES ($1, $2, $3)`,
        [workflowId, action.action_type, action.parameters ?? null],
      );
    }
    // When running in test mode we will collect the results of each action.  The
    // executeWorkflow function returns an array of action results.  To satisfy
    // strict null checks we declare testResult as an array or null.
    let testResult: any[] | null = null;
    if (test) {
      // Use provided test_event if present or a dummy event
      const testEvent = req.body.test_event || { event_type, test: true };
      testResult = await executeWorkflow(workflowId, testEvent, true);
    }
    res.status(201).json({ workflow_id: workflowId, test_result: testResult });
  } catch (err) {
    console.error('Failed to create workflow', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * List all workflows.  Returns an array of workflows with basic
 * information.  Actions are not included to keep the response small.
 */
app.get('/api/workflows', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, event_type, conditions, created_at FROM workflows ORDER BY created_at DESC`,
    );
    res.json({ workflows: rows });
  } catch (err) {
    console.error('Failed to list workflows', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Receive an event and trigger any workflows configured for this event
 * type.  The event body should include at least `event_type`.  All
 * matching workflows will be executed.  The response includes the
 * results of each workflow execution.
 */
app.post('/api/events', async (req, res) => {
  const event = req.body;
  const { event_type } = event;
  if (!event_type) {
    return res.status(400).json({ error: 'event_type is required' });
  }
  try {
    const { rows: workflows } = await pool.query(
      `SELECT id, conditions FROM workflows WHERE event_type = $1`,
      [event_type],
    );
    const results = [] as any[];
    for (const wf of workflows) {
      // Evaluate conditions – currently always true
      if (evaluateConditions(wf.conditions, event)) {
        const result = await executeWorkflow(wf.id, event, false);
        results.push({ workflow_id: wf.id, result });
      }
    }
    res.status(202).json({ processed: results.length, results });
  } catch (err) {
    console.error('Failed to process event', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Test a workflow without committing the results.  Expects a
 * workflow_id and a test_event in the request body.  The workflow
 * actions are executed in test mode and the resulting actions are
 * returned.  No audit log entry is created when test=true.
 */
app.post('/api/workflows/test', async (req, res) => {
  const { workflow_id, test_event } = req.body;
  if (!workflow_id) {
    return res.status(400).json({ error: 'workflow_id is required' });
  }
  try {
    const result = await executeWorkflow(workflow_id, test_event ?? {}, true);
    res.json({ result });
  } catch (err) {
    console.error('Failed to test workflow', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Get workflow execution logs.  Returns a list of entries with
 * workflow_id, event_data, result and executed_at.
 */
app.get('/api/workflow-logs', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT workflow_id, event_data, result, executed_at FROM workflow_logs ORDER BY executed_at DESC LIMIT 100`,
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error('Failed to fetch workflow logs', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Evaluate workflow conditions.  In this simplified implementation
 * conditions are not evaluated; all workflows of matching event type
 * will run.  You can extend this function to match specific fields
 * from the event against the stored conditions.
 */
function evaluateConditions(_conditions: any, _event: any): boolean {
  return true;
}

/**
 * Execute a workflow.  Loads all actions for the given workflow id and
 * iterates over them.  Each action is executed by calling doAction.
 * The results of each action are collected into an array and
 * optionally written to the workflow_logs table unless testMode is
 * true.  Returns the array of action results.
 */
async function executeWorkflow(workflowId: number, event: any, testMode: boolean = false) {
  // Fetch all actions associated with the workflow
  const { rows: actions } = await pool.query(
    `SELECT id, action_type, parameters FROM workflow_actions WHERE workflow_id = $1 ORDER BY id ASC`,
    [workflowId],
  );
  const results: any[] = [];
  for (const action of actions) {
    const result = await doAction(action, event, testMode);
    results.push(result);
  }
  if (!testMode) {
    // Insert log entry
    await pool.query(
      `INSERT INTO workflow_logs (workflow_id, event_data, result) VALUES ($1, $2, $3)`,
      [workflowId, event, results],
    );
  }
  return results;
}

/**
 * Execute a single action.  The actionType determines what
 * behaviour occurs.  In this simplified implementation the actions
 * simply log and return a message.  In a full implementation actions
 * would perform tasks on remote devices, call external APIs or
 * integrate with other systems.
 */
async function doAction(action: any, event: any, _testMode: boolean) {
  const type: string = action.action_type;
  const params: any = action.parameters || {};
  switch (type) {
    case 'run_script':
      // In a real system this might dispatch the script to an agent
      console.log(`Running script: ${params.script || 'default script'}`);
      return { action: type, status: 'success', message: `script ${params.script || 'executed'}` };
    case 'restart_service':
      // Here we would instruct the agent to restart a service
      console.log(`Restarting service: ${params.service || 'unknown'}`);
      return { action: type, status: 'success', message: `service ${params.service || 'restarted'}` };
    case 'isolate_device':
      // Could disable network connectivity or quarantine the device
      console.log(`Isolating device ${event.device_id || 'unknown'}`);
      return { action: type, status: 'success', message: 'device isolated' };
    case 'notify':
    case 'send_notification':
      // Would trigger the alert-service or send email/SMS; we just log
      console.log(`Sending notification: ${params.message || 'service failure detected'}`);
      return { action: type, status: 'success', message: 'notification sent' };
    case 'create_ticket':
      console.log('Creating ticket via ITSM integration');
      return { action: type, status: 'success', message: 'ticket created' };
    default:
      console.log(`Unknown action type: ${type}`);
      return { action: type, status: 'unknown', message: 'unknown action' };
  }
}

app.listen(PORT, async () => {
  await ensureTables();
  console.log(`Automation service listening on port ${PORT}`);
});