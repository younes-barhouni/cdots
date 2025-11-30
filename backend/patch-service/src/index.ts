import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

/**
 * Patch management service
 *
 * This service allows administrators to query available patches, approve
 * or deny patches for deployment, define patch groups and schedules,
 * receive status updates from agents and produce compliance reports.
 *
 * In this initial implementation the service stores patch metadata and
 * assignments in PostgreSQL.  It provides a REST API for the
 * dashboard and agents.  Actual patch discovery and installation are
 * stubbed or simplified; integration with Windows Update and
 * third‑party vendors would be added in a production version.
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3004;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

async function ensureTables() {
  // Table of available patches.  In reality this would be populated
  // automatically by querying Windows Update APIs or vendor feeds.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patches (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      vendor TEXT NOT NULL,
      severity TEXT,
      release_date DATE,
      description TEXT
    );
  `);
  // Table of patch assignments to devices.  The schedule_at column
  // specifies when the patch should be installed.  Status is one of
  // 'pending', 'approved', 'in_progress', 'success', 'failed',
  // 'denied'.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patch_assignments (
      device_id UUID NOT NULL,
      patch_id INTEGER REFERENCES patches(id),
      schedule_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      installed_at TIMESTAMPTZ,
      error_message TEXT,
      PRIMARY KEY (device_id, patch_id)
    );
  `);
  // Table for grouping patches together.  Not used extensively yet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patch_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patch_group_patches (
      group_id INTEGER REFERENCES patch_groups(id),
      patch_id INTEGER REFERENCES patches(id),
      PRIMARY KEY (group_id, patch_id)
    );
  `);
}

// Health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Seed some example patches if none exist.  This is for demo
// purposes; real patches would come from OS patch feeds.
async function seedPatches() {
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM patches');
  const count = parseInt(rows[0].count, 10);
  if (count === 0) {
    await pool.query(
      `INSERT INTO patches (name, vendor, severity, release_date, description) VALUES
      ('KB5012170: Security Update', 'Microsoft', 'critical', '2025-10-12', 'Security update for Windows Server'),
      ('Adobe Reader 2025.1', 'Adobe', 'moderate', '2025-09-01', 'Update for Adobe Reader'),
      ('Java Runtime 21u1', 'Oracle', 'important', '2025-08-15', 'Java Runtime update')`
    );
  }
}

/**
 * GET /api/patches/:deviceId
 *
 * Returns a list of patch assignments for the specified device.  By
 * default only assignments with status 'approved' and schedule_at in
 * the past (i.e. ready to install) are returned.  The response also
 * includes all available patches that have not been assigned to this
 * device yet so that an admin can review potential updates.
 */
app.get('/api/patches/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  try {
    // Fetch assignments ready to install
    const { rows: assignments } = await pool.query(
      `SELECT pa.patch_id, pa.schedule_at, pa.status, p.name, p.vendor, p.severity, p.description
       FROM patch_assignments pa
       JOIN patches p ON pa.patch_id = p.id
       WHERE pa.device_id = $1 AND pa.status = 'approved' AND (pa.schedule_at IS NULL OR pa.schedule_at <= NOW())`,
      [deviceId],
    );
    // Fetch available patches not yet assigned
    const { rows: available } = await pool.query(
      `SELECT p.id as patch_id, p.name, p.vendor, p.severity, p.description
       FROM patches p
       WHERE p.id NOT IN (SELECT patch_id FROM patch_assignments WHERE device_id = $1)`,
      [deviceId],
    );
    res.json({ assignments, available });
  } catch (err) {
    console.error('Failed to fetch patches', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/patches/approve
 *
 * Approves patches for one or more devices.  Body should include
 * `patch_id`, an array of `device_ids` and an optional `schedule_at`.
 * If schedule_at is omitted or null, the patch will be eligible for
 * immediate installation.  This endpoint creates or updates
 * assignments with status 'approved'.
 */
app.post('/api/patches/approve', async (req, res) => {
  const { patch_id, device_ids, schedule_at } = req.body;
  if (!patch_id || !Array.isArray(device_ids) || device_ids.length === 0) {
    return res.status(400).json({ error: 'patch_id and at least one device_id are required' });
  }
  const schedule = schedule_at ? new Date(schedule_at) : null;
  try {
    for (const deviceId of device_ids) {
      await pool.query(
        `INSERT INTO patch_assignments (device_id, patch_id, schedule_at, status)
         VALUES ($1, $2, $3, 'approved')
         ON CONFLICT (device_id, patch_id) DO UPDATE
         SET schedule_at = EXCLUDED.schedule_at, status = 'approved'`,
        [deviceId, patch_id, schedule],
      );
    }
    res.status(201).json({ message: 'patch approved' });
  } catch (err) {
    console.error('Failed to approve patch', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/patch-status
 *
 * Agents call this endpoint to report progress or results for a
 * specific patch.  Body should include `device_id`, `patch_id`,
 * `status` and optional `error_message`.  If status is 'success' the
 * installed_at timestamp is recorded.  If status is 'failed', an
 * error message may be provided.  The status is updated for the
 * assignment.
 */
app.post('/api/patch-status', async (req, res) => {
  const { device_id, patch_id, status, error_message } = req.body;
  if (!device_id || !patch_id || !status) {
    return res.status(400).json({ error: 'device_id, patch_id and status are required' });
  }
  try {
    const installedAt = status === 'success' ? new Date() : null;
    await pool.query(
      `UPDATE patch_assignments SET status = $1, installed_at = COALESCE($2, installed_at), error_message = $3
       WHERE device_id = $4 AND patch_id = $5`,
      [status, installedAt, error_message ?? null, device_id, patch_id],
    );
    res.status(202).json({ message: 'status updated' });
  } catch (err) {
    console.error('Failed to update patch status', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/compliance-report
 *
 * Returns a simple compliance report listing each device along with
 * counts of patches in various states (pending, approved, in_progress,
 * success, failed).  This allows administrators to identify missing
 * patches and track rollout progress.
 */
app.get('/api/compliance-report', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.device_id,
             SUM(CASE WHEN pa.status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN pa.status = 'approved' THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN pa.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
             SUM(CASE WHEN pa.status = 'success' THEN 1 ELSE 0 END) AS success,
             SUM(CASE WHEN pa.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM devices d
      LEFT JOIN patch_assignments pa ON pa.device_id = d.device_id
      GROUP BY d.device_id
    `);
    res.json({ report: rows });
  } catch (err) {
    console.error('Failed to generate compliance report', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(PORT, async () => {
  await ensureTables();
  await seedPatches();
  console.log(`Patch service listening on port ${PORT}`);
});