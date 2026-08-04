const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const START_TIME = Date.now();

// ---- Dashboard stats tracking ----
const stats = {
  totalRequests: 0,
  httpRequests: 0,
  httpsRequests: 0,
  errors: 0,
};

const MAX_LOGS = 50;
const recentLogs = [];

function addLog(type, hostname, status) {
  recentLogs.unshift({ time: new Date().toISOString(), type, hostname, status });
  if (recentLogs.length > MAX_LOGS) recentLogs.pop();
}

// ---- IP / location lookup (what websites currently see) ----
let ipInfo = { ip: null, city: null, region: null, country: null, org: null };

function refreshIpInfo() {
  https.get('https://ipapi.co/json/', (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        ipInfo = {
          ip: parsed.ip || null,
          city: parsed.city || null,
          region: parsed.region || null,
          country: parsed.country_name || null,
          org: parsed.org || null,
        };
      } catch (e) {}
    });
  }).on('error', () => {});
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proxy Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e4e6eb; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #8b8f9a; font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card { background: #1a1d27; border: 1px solid #2a2e3a; border-radius: 10px; padding: 16px; }
  .card .label { color: #8b8f9a; font-size: 12px; margin-bottom: 6px; }
  .card .value { font-size: 22px; font-weight: 600; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2e3a; }
  th { color: #8b8f9a; font-weight: 500; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge.http { background: #1e3a5f; color: #60a5fa; }
  .badge.https { background: #1e3f2e; color: #4ade80; }
  .badge.error { background: #4a1e24; color: #f87171; }
  button { background: #ef4444; color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; margin-bottom: 20px; }
  button:hover { background: #dc2626; }
  .section-title { font-size: 13px; margin: 20px 0 10px; color: #8b8f9a; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <h1>Proxy Dashboard</h1>
  <div class="sub"><span class="status-dot"></span>Running &middot; uptime <span id="uptime">-</span></div>

  <div class="grid">
    <div class="card"><div class="label">Total Requests</div><div class="value" id="totalRequests">0</div></div>
    <div class="card"><div class="label">HTTP</div><div class="value" id="httpRequests">0</div></div>
    <div class="card"><div class="label">HTTPS</div><div class="value" id="httpsRequests">0</div></div>
    <div class="card"><div class="label">Errors</div><div class="value" id="errors">0</div></div>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Public IP</div><div class="value" id="publicIp" style="font-size:16px;">Loading...</div></div>
    <div class="card"><div class="label">Location</div><div class="value" id="location" style="font-size:16px;">Loading...</div></div>
    <div class="card"><div class="label">ISP</div><div class="value" id="isp" style="font-size:16px;">Loading...</div></div>
  </div>

  <button onclick="restartProxy()">Restart Proxy</button>

  <div class="section-title">Recent Requests</div>
  <div class="card">
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>Host</th></tr></thead>
      <tbody id="logsBody"></tbody>
    </table>
  </div>

<script>
  async function refresh() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();

      document.getElementById('totalRequests').textContent = data.stats.totalRequests;
      document.getElementById('httpRequests').textContent = data.stats.httpRequests;
      document.getElementById('httpsRequests').textContent = data.stats.httpsRequests;
      document.getElementById('errors').textContent = data.stats.errors;
      document.getElementById('uptime').textContent = data.uptime;
      document.getElementById('publicIp').textContent = data.ipInfo.ip || 'Unknown';
      document.getElementById('location').textContent = (data.ipInfo.city && data.ipInfo.country) ? (data.ipInfo.city + ', ' + data.ipInfo.country) : 'Unknown';
      document.getElementById('isp').textContent = data.ipInfo.org || 'Unknown';

      const tbody = document.getElementById('logsBody');
      tbody.innerHTML = data.logs.map(function (log) {
        const badgeClass = log.status === 'error' ? 'error' : log.type.toLowerCase();
        const time = new Date(log.time).toLocaleTimeString();
        return '<tr><td>' + time + '</td><td><span class="badge ' + badgeClass + '">' + log.type + '</span></td><td>' + log.hostname + '</td></tr>';
      }).join('');
    } catch (err) {
      console.error('Failed to refresh stats', err);
    }
  }

  async function restartProxy() {
    if (!confirm('Restart the proxy server now?')) return;
    await fetch('/api/restart', { method: 'POST' });
    alert('Restart triggered. Give it about 10 seconds then refresh this page.');
  }

  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

// ---- Headers that reveal you're using a proxy ----
const HOP_BY_HOP_HEADERS = [
  'proxy-connection', 'proxy-authenticate', 'proxy-authorization',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'via', 'forwarded', 'connection', 'keep-alive',
  'transfer-encoding', 'te', 'trailer', 'upgrade',
];

function cleanHeaders(headers) {
  const cleaned = { ...headers };
  HOP_BY_HOP_HEADERS.forEach((header) => delete cleaned[header]);
  return cleaned;
}

// ---- Cloudflare tunnel ----
function startCloudflare() {
  try {
    const binaryPath = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared');
    fs.chmodSync(binaryPath, '755');
    console.log('✅ cloudflared permissions fixed');

    const tunnel = spawn(binaryPath, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate']);

    tunnel.stdout.on('data', (data) => console.log(`CF: ${data}`));
    tunnel.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`CF: ${output}`);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) console.log(`\n🌍 Your Cloudflare URL: ${match[0]}\n`);
    });
    tunnel.on('error', (err) => console.error('Cloudflare tunnel error:', err.message));
  } catch (err) {
    console.error('Failed to start cloudflared:', err.message);
  }
}

// ---- Main server ----
const server = http.createServer((req, res) => {

  if (req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getDashboardHtml());
    return;
  }

  if (req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      stats,
      uptime: formatUptime(Date.now() - START_TIME),
      ipInfo,
      logs: recentLogs,
    }));
    return;
  }

  if (req.url === '/api/restart' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Restarting...' }));
    console.log('🔄 Restart requested from dashboard');
    setTimeout(() => process.exit(0), 500); // Railway restarts the container automatically
    return;
  }

  const targetUrl = url.parse(req.url);

  if (!targetUrl.hostname) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  stats.totalRequests++;
  stats.httpRequests++;
  addLog('HTTP', targetUrl.hostname, 'ok');

  console.log(`Proxying HTTP: ${targetUrl.hostname}`);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.path,
    method: req.method,
    headers: {
      ...cleanHeaders(req.headers),
      host: targetUrl.hostname,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const cleanedResHeaders = cleanHeaders(proxyRes.headers);
    res.writeHead(proxyRes.statusCode, cleanedResHeaders);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (err) => {
    stats.errors++;
    addLog('HTTP', targetUrl.hostname, 'error');
    console.error('Proxy error:', err.message);
    res.writeHead(500);
    res.end('Error');
  });
});

server.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS: ${req.url}`);
  const [hostname, port] = req.url.split(':');

  stats.totalRequests++;
  stats.httpsRequests++;
  addLog('HTTPS', hostname, 'ok');

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: \r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    stats.errors++;
    addLog('HTTPS', hostname, 'error');
    console.error('HTTPS error:', err.message);
    clientSocket.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  refreshIpInfo();
  setInterval(refreshIpInfo, 5 * 60 * 1000);
  startCloudflare();
});