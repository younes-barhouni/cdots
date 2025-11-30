import axios from 'axios';
import express from 'express';

/**
 * Network collector service
 *
 * This service performs discovery and active checks within specified IP
 * ranges.  In a complete implementation it would use SNMP libraries,
 * ping/ICMP packages and WMI for Windows to identify devices, gather
 * vendor/model info and send traps back to the central server.  Here we
 * implement a simple stub that iterates over provided IP ranges and
 * invokes a placeholder discovery function.  Discovered devices are
 * posted to the device service for inventory registration.
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE_URL || 'http://device-service:3001/api/devices/register';

// Endpoint of the performance service for posting network metrics.  The
// network collector will periodically generate synthetic network
// performance metrics for each discovered device and send them to this
// URL.  In a real implementation metrics would be gathered from
// SNMP/WMI polls or other telemetry sources.
const PERFORMANCE_SERVICE_URL = process.env.PERFORMANCE_SERVICE_URL || 'http://performance-service:3006/api/performance';

// Endpoints for posting flow data and interface statistics.  These can be
// overridden via environment variables.  In a production collector you
// would gather NetFlow/sFlow/J-Flow records and SNMP interface counters.
// Here we simulate data for demonstration purposes.
const FLOW_DATA_URL = process.env.FLOW_DATA_URL || 'http://performance-service:3006/api/flow-data';
const INTERFACE_STATS_URL = process.env.INTERFACE_STATS_URL || 'http://performance-service:3006/api/interface-stats';

// Keep track of devices discovered by this collector.  When a device
// is registered with the device service the response includes a
// device_id which we store in this array so that we can later send
// performance metrics.  In a production system you would persist
// this state or fetch device IDs from the device service on demand.
const knownDevices: string[] = [];

// Map of device IDs to a list of interface names.  When we generate
// synthetic interface statistics we need to know which interfaces
// exist on each device.  For demonstration we will assign two
// interfaces per device at discovery time.
const deviceInterfaces: Record<string, string[]> = {};

const app = express();
app.use(express.json());

// Health endpoint
app.get('/healthz', (_req, res) => {
  res.status(200).send({ status: 'ok' });
});

// Trigger a network scan via HTTP.  The request body should include an
// array of CIDR blocks or IP ranges.  For each range, the service will
// call the placeholder `discoverRange` function and then post the
// results to the device service.
app.post('/api/scan', async (req, res) => {
  const { ranges } = req.body;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return res.status(400).json({ error: 'ranges array is required' });
  }
  try {
    for (const range of ranges) {
      const discovered = await discoverRange(range);
      for (const device of discovered) {
        await registerDevice(device);
      }
    }
    res.status(202).json({ status: 'scan_started' });
  } catch (err) {
    console.error('Network scan failed', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Placeholder function to discover devices in a given range.  Returns a
 * list of devices with minimal metadata.  In a real implementation
 * this would perform SNMP polling, ping sweeps and WMI queries.
 */
async function discoverRange(range: string): Promise<any[]> {
  console.log(`Scanning network range: ${range}`);
  // TODO: implement SNMP, ICMP and WMI discovery here
  // For now return a dummy device after a short delay
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return [
    {
      hostname: `device-${range.replace(/\//g, '-')}`,
      ip_address: range.split('/')[0],
      vendor: 'unknown',
      model: 'unknown',
      discovered_by: 'network_scan',
    },
  ];
}

/**
 * Register a discovered device with the central device service.
 */
async function registerDevice(device: any) {
  try {
    const response = await axios.post(DEVICE_SERVICE_URL, device);
    console.log(`Registered device ${device.hostname}`);
    if (response.data && response.data.device_id) {
      const id: string = response.data.device_id;
      knownDevices.push(id);
      // assign dummy interfaces for this device if not already present
      if (!deviceInterfaces[id]) {
        deviceInterfaces[id] = [
          `${device.hostname}-eth0`,
          `${device.hostname}-eth1`,
        ];
      }
    }
  } catch (err) {
    console.error('Failed to register device', err);
  }
}

/**
 * Periodically send synthetic network performance metrics for each
 * discovered device.  This stub simulates bandwidth usage, latency
 * and packet loss for demonstration purposes.  In a production
 * implementation metrics would be collected via SNMP, ICMP probes or
 * other monitoring tools.
 */
async function sendPerformanceMetrics() {
  for (const deviceId of knownDevices) {
    const metrics = {
      device_id: deviceId,
      site_id: 'default-site',
      timestamp: new Date().toISOString(),
      bandwidth_in: Math.random() * 1000, // Kbps
      bandwidth_out: Math.random() * 1000,
      latency_ms: Math.random() * 100,
      packet_loss: Math.random() * 5,
    };
    try {
      await axios.post(PERFORMANCE_SERVICE_URL, metrics);
    } catch (err) {
      console.error('Failed to send performance metrics', err);
    }
  }
}

// Schedule performance metrics reporting every 60 seconds
setInterval(() => {
  if (knownDevices.length > 0) {
    sendPerformanceMetrics();
    sendFlowAndInterfaceStats();
  }
}, 60 * 1000);

/**
 * Generate and send synthetic flow data and interface statistics for each
 * discovered device.  In a real collector these values would come
 * from NetFlow/sFlow/J-Flow exporters and SNMP polls.  Each interval
 * we emit a handful of flow records and one stats record per
 * interface.
 */
async function sendFlowAndInterfaceStats() {
  for (const deviceId of knownDevices) {
    const siteId = 'default-site';
    // Generate 5 random flow records per device
    for (let i = 0; i < 5; i++) {
      const srcIp = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const dstIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const bytes = Math.floor(Math.random() * 10_000); // bytes transferred
      const packets = Math.floor(bytes / 64); // assume 64‑byte packets
      const flow = {
        device_id: deviceId,
        site_id: siteId,
        timestamp: new Date().toISOString(),
        src_ip: srcIp,
        dst_ip: dstIp,
        bytes,
        packets,
      };
      try {
        await axios.post(FLOW_DATA_URL, flow);
      } catch (err) {
        console.error('Failed to send flow data', err);
      }
    }
    // Generate interface statistics for each interface on the device
    const interfaces = deviceInterfaces[deviceId] || [];
    for (const iface of interfaces) {
      const stats = {
        device_id: deviceId,
        site_id: siteId,
        interface_name: iface,
        timestamp: new Date().toISOString(),
        bandwidth_in: Math.random() * 1000,
        bandwidth_out: Math.random() * 1000,
        packets: Math.floor(Math.random() * 10000),
        errors: Math.floor(Math.random() * 10),
        latency_ms: Math.random() * 100,
        packet_loss: Math.random() * 5,
        jitter_ms: Math.random() * 10,
      };
      try {
        await axios.post(INTERFACE_STATS_URL, stats);
      } catch (err) {
        console.error('Failed to send interface stats', err);
      }
    }
  }
}

app.listen(PORT, () => {
  console.log(`Network collector service listening on port ${PORT}`);
});