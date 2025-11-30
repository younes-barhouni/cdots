import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';

/**
 * Network Performance Dashboard
 *
 * This React component fetches network performance metrics from the
 * performance-service and renders several views: an aggregated
 * performance report by site, a list of top talkers from flow data,
 * an interface report summarising per‑interface statistics, and a
 * time‑series chart for a selected device/interface.  The user can
 * filter by site and time range.  Adjust the API_BASE via
 * import.meta.env.VITE_API_BASE or default to localhost:3006.
 */

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3006';

interface PerformanceRow {
  site_id: string | null;
  avg_bandwidth_in: number | null;
  avg_bandwidth_out: number | null;
  avg_latency_ms: number | null;
  avg_packet_loss: number | null;
  sample_count: number | null;
}

interface TalkerRow {
  src_ip: string;
  dst_ip: string;
  total_bytes: number;
  total_packets: number;
}

interface InterfaceRow {
  device_id: string;
  interface_name: string;
  site_id: string | null;
  avg_bandwidth_in: number | null;
  avg_bandwidth_out: number | null;
  avg_latency_ms: number | null;
  avg_packet_loss: number | null;
  avg_jitter_ms: number | null;
  sample_count: number | null;
}

interface TrendPoint {
  timestamp: string;
  bandwidth_in: number | null;
  bandwidth_out: number | null;
  latency_ms: number | null;
  packet_loss: number | null;
  jitter_ms: number | null;
}

const App: React.FC = () => {
  const [siteId, setSiteId] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [performanceData, setPerformanceData] = useState<PerformanceRow[]>([]);
  const [topTalkers, setTopTalkers] = useState<TalkerRow[]>([]);
  const [interfaceReport, setInterfaceReport] = useState<InterfaceRow[]>([]);
  const [selectedInterface, setSelectedInterface] = useState<{ deviceId: string; interfaceName: string } | null>(null);
  const [interfaceTrend, setInterfaceTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch all reports when the component mounts or filters change
  useEffect(() => {
    fetchAllReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAllReports() {
    setLoading(true);
    try {
      // Build common query parameters for time filtering
      const timeParams: Record<string, string> = {};
      if (startTime) timeParams['start_time'] = startTime;
      if (endTime) timeParams['end_time'] = endTime;

      // Performance report by site
      const perfResp = await axios.get(`${API_BASE}/api/performance-report`, {
        params: siteId ? { site_id: siteId } : {},
      });
      setPerformanceData(perfResp.data?.report || []);

      // Top talkers (limit 10) with optional filters
      const talkersResp = await axios.get(`${API_BASE}/api/top-talkers`, {
        params: {
          ...(siteId ? { site_id: siteId } : {}),
          ...timeParams,
        },
      });
      setTopTalkers(talkersResp.data?.talkers || []);

      // Interface report with optional filters
      const ifaceResp = await axios.get(`${API_BASE}/api/interface-report`, {
        params: {
          ...(siteId ? { site_id: siteId } : {}),
          ...timeParams,
        },
      });
      setInterfaceReport(ifaceResp.data?.interfaces || []);

      // If an interface is selected, refresh its trend chart
      if (selectedInterface) {
        await fetchInterfaceTrend(selectedInterface.deviceId, selectedInterface.interfaceName);
      }
    } catch (err) {
      console.error('Failed to fetch reports', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchInterfaceTrend(deviceId: string, interfaceName: string) {
    try {
      const timeParams: Record<string, string> = {};
      if (startTime) timeParams['start_time'] = startTime;
      if (endTime) timeParams['end_time'] = endTime;
      const resp = await axios.get(`${API_BASE}/api/interface-trend`, {
        params: {
          device_id: deviceId,
          interface_name: interfaceName,
          ...timeParams,
        },
      });
      setInterfaceTrend(resp.data?.trend || []);
    } catch (err) {
      console.error('Failed to fetch interface trend', err);
    }
  }

  function handleApplyFilters(e: React.FormEvent) {
    e.preventDefault();
    fetchAllReports();
  }

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Network Performance Dashboard</h1>
      <form onSubmit={handleApplyFilters} style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <label>
          Site ID:&nbsp;
          <input
            type="text"
            value={siteId}
            placeholder="(all)"
            onChange={(e) => setSiteId(e.target.value)}
            style={{ padding: '0.25rem' }}
          />
        </label>
        <label>
          Start Time:&nbsp;
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{ padding: '0.25rem' }}
          />
        </label>
        <label>
          End Time:&nbsp;
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ padding: '0.25rem' }}
          />
        </label>
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>Apply Filters</button>
      </form>
      {loading && <p>Loading...</p>}
      {/* Performance Report Section */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Aggregated Performance by Site</h2>
        {performanceData.length === 0 ? (
          <p>No data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={performanceData.map((row) => ({
              site: row.site_id || 'Unknown',
              bandwidth_in: row.avg_bandwidth_in || 0,
              bandwidth_out: row.avg_bandwidth_out || 0,
              latency: row.avg_latency_ms || 0,
              packet_loss: row.avg_packet_loss || 0,
            }))} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="site" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="bandwidth_in" name="Bandwidth In" fill="#8884d8" />
              <Bar dataKey="bandwidth_out" name="Bandwidth Out" fill="#82ca9d" />
              <Bar dataKey="latency" name="Latency (ms)" fill="#ffc658" />
              <Bar dataKey="packet_loss" name="Packet Loss (%)" fill="#d84a8e" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
      {/* Top Talkers Section */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Top Talkers</h2>
        {topTalkers.length === 0 ? (
          <p>No flow data available</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Source IP</th>
                <th style={{ textAlign: 'left', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Destination IP</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Total Bytes</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Total Packets</th>
              </tr>
            </thead>
            <tbody>
              {topTalkers.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>{row.src_ip}</td>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>{row.dst_ip}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.total_bytes}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.total_packets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {/* Interface Report Section */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Interface Report</h2>
        {interfaceReport.length === 0 ? (
          <p>No interface statistics available</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Device ID</th>
                <th style={{ textAlign: 'left', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Interface</th>
                <th style={{ textAlign: 'left', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Site</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>BW In</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>BW Out</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Latency</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Loss</th>
                <th style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Jitter</th>
                <th style={{ padding: '0.25rem', borderBottom: '1px solid #ccc' }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {interfaceReport.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>{row.device_id}</td>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>{row.interface_name}</td>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>{row.site_id || ''}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.avg_bandwidth_in?.toFixed(2)}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.avg_bandwidth_out?.toFixed(2)}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.avg_latency_ms?.toFixed(2)}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.avg_packet_loss?.toFixed(2)}</td>
                  <td style={{ padding: '0.25rem', textAlign: 'right', borderBottom: '1px solid #eee' }}>{row.avg_jitter_ms?.toFixed(2)}</td>
                  <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                    <button
                      onClick={() => {
                        setSelectedInterface({ deviceId: row.device_id, interfaceName: row.interface_name });
                        fetchInterfaceTrend(row.device_id, row.interface_name);
                      }}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {/* Interface Trend Chart */}
      {selectedInterface && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            Interface Trend: {selectedInterface.interfaceName}
          </h2>
          {interfaceTrend.length === 0 ? (
            <p>No trend data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={interfaceTrend.map((pt) => ({
                timestamp: new Date(pt.timestamp).toLocaleTimeString(),
                bandwidth_in: pt.bandwidth_in || 0,
                bandwidth_out: pt.bandwidth_out || 0,
                latency: pt.latency_ms || 0,
                packet_loss: pt.packet_loss || 0,
                jitter: pt.jitter_ms || 0,
              }))} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="bandwidth_in" name="BW In" stroke="#8884d8" dot={false} />
                <Line type="monotone" dataKey="bandwidth_out" name="BW Out" stroke="#82ca9d" dot={false} />
                <Line type="monotone" dataKey="latency" name="Latency (ms)" stroke="#ffc658" dot={false} />
                <Line type="monotone" dataKey="packet_loss" name="Loss (%)" stroke="#d84a8e" dot={false} />
                <Line type="monotone" dataKey="jitter" name="Jitter (ms)" stroke="#888888" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>
      )}
    </div>
  );
};

export default App;