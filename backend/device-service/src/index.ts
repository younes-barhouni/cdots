import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(express.json());

/**
 * Device schema expected in requests.  This can be refined into its own
 * TypeScript interface or class but is kept simple here.  Devices are
 * identified by a UUID device_id.  Additional fields (hostname,
 * ip_address, os, specs, installed_software, vendor, model) can be
 * supplied as needed.  The `discovered_by` field indicates how the
 * device was added (agent, network_scan, manual).
 */
interface Device {
  device_id?: string;
  hostname?: string;
  ip_address?: string;
  os?: string;
  specs?: string;
  installed_software?: string;
  vendor?: string;
  model?: string;
  discovered_by?: string;
}

// Ensure devices table exists.  In a production system, migrations
// should be managed via tools like knex or Prisma.  Here we create the
// table if it does not exist on startup.
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      device_id UUID NOT NULL UNIQUE,
      hostname TEXT,
      ip_address TEXT,
      os TEXT,
      specs TEXT,
      installed_software TEXT,
      vendor TEXT,
      model TEXT,
      discovered_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// List all devices
app.get('/api/devices', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM devices ORDER BY created_at DESC');
    res.json({ devices: rows });
  } catch (err) {
    console.error('Failed to list devices', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Manual device creation
app.post('/api/devices', async (req, res) => {
  const device: Device = req.body;
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO devices (device_id, hostname, ip_address, os, specs, installed_software, vendor, model, discovered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        device.hostname ?? null,
        device.ip_address ?? null,
        device.os ?? null,
        device.specs ?? null,
        device.installed_software ?? null,
        device.vendor ?? null,
        device.model ?? null,
        device.discovered_by ?? 'manual',
      ],
    );
    res.status(201).json({ device_id: id });
  } catch (err) {
    console.error('Failed to add device', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Update device details
app.put('/api/devices/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const device: Device = req.body;
  try {
    await pool.query(
      `UPDATE devices SET hostname=$1, ip_address=$2, os=$3, specs=$4, installed_software=$5, vendor=$6, model=$7 WHERE device_id=$8`,
      [
        device.hostname ?? null,
        device.ip_address ?? null,
        device.os ?? null,
        device.specs ?? null,
        device.installed_software ?? null,
        device.vendor ?? null,
        device.model ?? null,
        deviceId,
      ],
    );
    res.status(204).end();
  } catch (err) {
    console.error('Failed to update device', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Delete a device
app.delete('/api/devices/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  try {
    await pool.query('DELETE FROM devices WHERE device_id=$1', [deviceId]);
    res.status(204).end();
  } catch (err) {
    console.error('Failed to delete device', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Endpoint for agent registration.  Agents will call this endpoint when
// installed on a workstation or server.  The device_id may be
// predetermined (e.g. derived from hardware serial).  If not provided
// it will be generated.  The call should include device details such
// as OS and hardware specs.
app.post('/api/devices/register', async (req, res) => {
  const device: Device = req.body;
  const deviceId = device.device_id || uuidv4();
  try {
    await pool.query(
      `INSERT INTO devices (device_id, hostname, ip_address, os, specs, installed_software, vendor, model, discovered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (device_id) DO UPDATE
       SET hostname=EXCLUDED.hostname,
           ip_address=EXCLUDED.ip_address,
           os=EXCLUDED.os,
           specs=EXCLUDED.specs,
           installed_software=EXCLUDED.installed_software,
           vendor=EXCLUDED.vendor,
           model=EXCLUDED.model,
           discovered_by=EXCLUDED.discovered_by,
           created_at=NOW()`,
      [
        deviceId,
        device.hostname ?? null,
        device.ip_address ?? null,
        device.os ?? null,
        device.specs ?? null,
        device.installed_software ?? null,
        device.vendor ?? null,
        device.model ?? null,
        device.discovered_by ?? 'agent',
      ],
    );
    res.status(202).json({ device_id: deviceId, status: 'registered' });
  } catch (err) {
    console.error('Failed to register device', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(PORT, async () => {
  await ensureTable();
  console.log(`Device service listening on port ${PORT}`);
});