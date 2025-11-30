import express from 'express';
import { Pool } from 'pg';

/**
 * Network performance service
 *
 * This service receives network performance metrics from collectors and
 * provides aggregated reports for dashboards.  Metrics include
 * bandwidth usage (in/out), latency and packet loss.  Reports are
 * grouped by site or device and averaged over all samples in the
 * database.  In a real implementation you might use a time‑series
 * database or perform windowed aggregations; here we use simple
 * averages on all recorded samples.
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3006;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/cdotrmm';

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

// CORS middleware
// Allow cross‑origin requests from the dashboard (port 3007) by
// setting permissive headers.  Without these headers browsers will
// block requests due to the Same‑Origin Policy.  The dashboard
// runs on a different origin (localhost:3007) than this service
// (localhost:3006), so we allow any origin here.  In a real
// deployment you should restrict the allowed origins to trusted
// hosts.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Respond to preflight OPTIONS requests by sending status 204
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_performance (
      id SERIAL PRIMARY KEY,
      device_id UUID,
      site_id TEXT,
      timestamp TIMESTAMPTZ NOT NULL,
      bandwidth_in DOUBLE PRECISION,
      bandwidth_out DOUBLE PRECISION,
      latency_ms DOUBLE PRECISION,
      packet_loss DOUBLE PRECISION
    );
  `);

  // Table for flow data (NetFlow/sFlow/J‑Flow).  Each entry represents
  // traffic between a source and destination IP on a device/site at a
  // specific timestamp.  Use BIGINT for byte and packet counters.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flow_data (
      id SERIAL PRIMARY KEY,
      device_id UUID,
      site_id TEXT,
      timestamp TIMESTAMPTZ NOT NULL,
      src_ip TEXT NOT NULL,
      dst_ip TEXT NOT NULL,
      bytes BIGINT,
      packets BIGINT
    );
  `);

  // Table for interface statistics collected via SNMP.  Stores per
  // interface counters along with quality metrics such as latency,
  // packet loss and jitter.  In a real implementation these values
  // would come from ifTable/ifXTable and other MIBs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interface_stats (
      id SERIAL PRIMARY KEY,
      device_id UUID NOT NULL,
      site_id TEXT,
      interface_name TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      bandwidth_in DOUBLE PRECISION,
      bandwidth_out DOUBLE PRECISION,
      packets BIGINT,
      errors BIGINT,
      latency_ms DOUBLE PRECISION,
      packet_loss DOUBLE PRECISION,
      jitter_ms DOUBLE PRECISION
    );
  `);
}

// Health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Endpoint for collectors to post network performance metrics.  The
 * request body should include device_id (UUID), site_id (string),
 * timestamp (ISO string) and numeric values for bandwidth_in,
 * bandwidth_out, latency_ms and packet_loss.  The timestamp will be
 * stored as provided; if omitted it will default to now.
 */
app.post('/api/performance', async (req, res) => {
  const { device_id, site_id, timestamp, bandwidth_in, bandwidth_out, latency_ms, packet_loss } = req.body;
  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }
  try {
    const ts = timestamp ? new Date(timestamp) : new Date();
    await pool.query(
      `INSERT INTO network_performance (device_id, site_id, timestamp, bandwidth_in, bandwidth_out, latency_ms, packet_loss)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [device_id, site_id ?? null, ts, bandwidth_in ?? null, bandwidth_out ?? null, latency_ms ?? null, packet_loss ?? null],
    );
    res.status(201).json({ status: 'created' });
  } catch (err) {
    console.error('Failed to insert network performance', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Endpoint for collectors to post flow data (NetFlow/sFlow/J‑Flow).  The
 * request body should include device_id, site_id, timestamp, src_ip,
 * dst_ip, bytes and packets.  If timestamp is omitted the current
 * time will be used.
 */
app.post('/api/flow-data', async (req, res) => {
  const { device_id, site_id, timestamp, src_ip, dst_ip, bytes, packets } = req.body;
  if (!device_id || !src_ip || !dst_ip) {
    return res.status(400).json({ error: 'device_id, src_ip and dst_ip are required' });
  }
  try {
    const ts = timestamp ? new Date(timestamp) : new Date();
    await pool.query(
      `INSERT INTO flow_data (device_id, site_id, timestamp, src_ip, dst_ip, bytes, packets)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [device_id, site_id ?? null, ts, src_ip, dst_ip, bytes ?? null, packets ?? null],
    );
    res.status(201).json({ status: 'created' });
  } catch (err) {
    console.error('Failed to insert flow data', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Endpoint for collectors to post interface statistics.  Required fields
 * are device_id and interface_name.  Additional metrics may be
 * provided including bandwidth counters, packet counts, errors,
 * latency, packet_loss and jitter.  If timestamp is omitted it
 * defaults to now.
 */
app.post('/api/interface-stats', async (req, res) => {
  const { device_id, site_id, interface_name, timestamp, bandwidth_in, bandwidth_out, packets, errors, latency_ms, packet_loss, jitter_ms } = req.body;
  if (!device_id || !interface_name) {
    return res.status(400).json({ error: 'device_id and interface_name are required' });
  }
  try {
    const ts = timestamp ? new Date(timestamp) : new Date();
    await pool.query(
      `INSERT INTO interface_stats (device_id, site_id, interface_name, timestamp, bandwidth_in, bandwidth_out, packets, errors, latency_ms, packet_loss, jitter_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [device_id, site_id ?? null, interface_name, ts, bandwidth_in ?? null, bandwidth_out ?? null, packets ?? null, errors ?? null, latency_ms ?? null, packet_loss ?? null, jitter_ms ?? null],
    );
    res.status(201).json({ status: 'created' });
  } catch (err) {
    console.error('Failed to insert interface stats', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Get top talkers based on flow data.  Query parameters can include
 * `site_id`, `start_time` and `end_time` to filter the data.  Returns
 * an array of source/destination pairs sorted by total bytes.
 */
app.get('/api/top-talkers', async (req, res) => {
  const siteId = req.query.site_id as string | undefined;
  const startTime = req.query.start_time as string | undefined;
  const endTime = req.query.end_time as string | undefined;
  try {
    let query = `SELECT src_ip, dst_ip, SUM(bytes) AS total_bytes, SUM(packets) AS total_packets
                 FROM flow_data`;
    const params: any[] = [];
    const conditions: string[] = [];
    if (siteId) {
      params.push(siteId);
      conditions.push(`site_id = $${params.length}`);
    }
    if (startTime) {
      params.push(new Date(startTime));
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (endTime) {
      params.push(new Date(endTime));
      conditions.push(`timestamp <= $${params.length}`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` GROUP BY src_ip, dst_ip ORDER BY SUM(bytes) DESC LIMIT 10`;
    const { rows } = await pool.query(query, params);
    res.json({ talkers: rows });
  } catch (err) {
    console.error('Failed to get top talkers', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Get aggregated interface statistics.  Optional query parameters
 * include site_id, device_id, interface_name, start_time and
 * end_time.  The results are grouped by device, interface and
 * site.  Aggregated metrics include average bandwidth and quality
 * metrics.
 */
app.get('/api/interface-report', async (req, res) => {
  const siteId = req.query.site_id as string | undefined;
  const deviceId = req.query.device_id as string | undefined;
  const iface = req.query.interface_name as string | undefined;
  const startTime = req.query.start_time as string | undefined;
  const endTime = req.query.end_time as string | undefined;
  try {
    let query = `SELECT device_id, interface_name, site_id,
                        AVG(bandwidth_in) AS avg_bandwidth_in,
                        AVG(bandwidth_out) AS avg_bandwidth_out,
                        AVG(latency_ms) AS avg_latency_ms,
                        AVG(packet_loss) AS avg_packet_loss,
                        AVG(jitter_ms) AS avg_jitter_ms,
                        COUNT(*) AS sample_count
                 FROM interface_stats`;
    const params: any[] = [];
    const conditions: string[] = [];
    if (siteId) {
      params.push(siteId);
      conditions.push(`site_id = $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (iface) {
      params.push(iface);
      conditions.push(`interface_name = $${params.length}`);
    }
    if (startTime) {
      params.push(new Date(startTime));
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (endTime) {
      params.push(new Date(endTime));
      conditions.push(`timestamp <= $${params.length}`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` GROUP BY device_id, interface_name, site_id`;
    const { rows } = await pool.query(query, params);
    res.json({ interfaces: rows });
  } catch (err) {
    console.error('Failed to get interface report', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Get time‑series data for a specific device/interface combination.  The
 * required parameters are device_id and interface_name.  Optional
 * start_time and end_time parameters limit the timeframe.  Results
 * are ordered by timestamp and include quality metrics.
 */
app.get('/api/interface-trend', async (req, res) => {
  const deviceId = req.query.device_id as string | undefined;
  const iface = req.query.interface_name as string | undefined;
  const startTime = req.query.start_time as string | undefined;
  const endTime = req.query.end_time as string | undefined;
  if (!deviceId || !iface) {
    return res.status(400).json({ error: 'device_id and interface_name are required' });
  }
  try {
    let query = `SELECT timestamp, bandwidth_in, bandwidth_out, latency_ms, packet_loss, jitter_ms
                 FROM interface_stats WHERE device_id = $1 AND interface_name = $2`;
    const params: any[] = [deviceId, iface];
    if (startTime) {
      params.push(new Date(startTime));
      query += ` AND timestamp >= $${params.length}`;
    }
    if (endTime) {
      params.push(new Date(endTime));
      query += ` AND timestamp <= $${params.length}`;
    }
    query += ` ORDER BY timestamp ASC`;
    const { rows } = await pool.query(query, params);
    res.json({ trend: rows });
  } catch (err) {
    console.error('Failed to get interface trend', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/performance-report
 *
 * Returns aggregated network performance metrics grouped by site.
 * Clients can optionally supply a `site_id` query parameter to
 * restrict the aggregation to a single site.  The response contains
 * average bandwidth_in, bandwidth_out, latency_ms and packet_loss per
 * site over all collected samples.
 */
app.get('/api/performance-report', async (req, res) => {
  const siteId = req.query.site_id as string | undefined;
  try {
    let query = `
      SELECT site_id,
             AVG(bandwidth_in) AS avg_bandwidth_in,
             AVG(bandwidth_out) AS avg_bandwidth_out,
             AVG(latency_ms) AS avg_latency_ms,
             AVG(packet_loss) AS avg_packet_loss,
             COUNT(*) AS sample_count
      FROM network_performance`;
    const params: any[] = [];
    if (siteId) {
      query += ` WHERE site_id = $1`;
      params.push(siteId);
    }
    query += ` GROUP BY site_id`;
    const { rows } = await pool.query(query, params);
    res.json({ report: rows });
  } catch (err) {
    console.error('Failed to generate performance report', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(PORT, async () => {
  await ensureTables();
  console.log(`Performance service listening on port ${PORT}`);
});