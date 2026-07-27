const http = require('http');
const net = require('net');
const url = require('url');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;

// Headers that reveal you're using a proxy
const HOP_BY_HOP_HEADERS = [
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'via',
  'forwarded',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
];

function cleanHeaders(headers) {
  const cleaned = { ...headers };
  HOP_BY_HOP_HEADERS.forEach((header) => {
    delete cleaned[header];
  });
  return cleaned;
}

// Start Cloudflare tunnel
function startCloudflare() {
  const tunnel = spawn('cloudflared', [
    'tunnel',
    '--url',
    `http://localhost:${PORT}`,
    '--no-autoupdate',
  ]);

  tunnel.stdout.on('data', (data) => {
    console.log(`Cloudflare: ${data}`);
  });

  tunnel.stderr.on('data', (data) => {
    const output = data.toString();
    // Extract the Cloudflare URL
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log(`\n🌍 Your Cloudflare URL: ${match[0]}`);
      console.log(`Set your browser proxy to this URL\n`);
    }
  });

  tunnel.on('error', (err) => {
    console.error('Cloudflare tunnel error:', err.message);
  });
}

const server = http.createServer((req, res) => {
  const targetUrl = url.parse(req.url);

  if (!targetUrl.hostname) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  console.log(`Proxying HTTP: ${targetUrl.hostname}`);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.path,
    method: req.method,
    headers: {
      ...cleanHeaders(req.headers),
      host: targetUrl.hostname,
      // Spoof a real browser
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const cleanedResHeaders = cleanHeaders(proxyRes.headers);
    res.writeHead(proxyRes.statusCode, cleanedResHeaders);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(500);
    res.end('Error');
  });
});

// Handle HTTPS tunneling
server.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS: ${req.url}`);

  const [hostname, port] = req.url.split(':');

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-agent: \r\n' +
      '\r\n'
    );
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('HTTPS error:', err.message);
    clientSocket.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
  startCloudflare(); // 👈 starts Cloudflare tunnel after server is ready
});