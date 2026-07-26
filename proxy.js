const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');

// Your proxy port
const PORT = 8080;

const server = http.createServer((req, res) => {
  // Parse the target URL
  const targetUrl = url.parse(req.url);

  console.log(`Proxying HTTP: ${req.url}`);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.path,
    method: req.method,
    headers: {
      ...req.headers,
      // Hide original IP
      'X-Forwarded-For': '',
      host: targetUrl.hostname,
    },
  };

  // Forward the request
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(500);
    res.end('Proxy error');
  });
});

// Handle HTTPS tunneling (CONNECT method)
server.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS: ${req.url}`);

  const { port, hostname } = new URL(`https://${req.url}`);

  // Connect to the target server
  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-agent: My-Proxy\r\n' +
      '\r\n'
    );
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('HTTPS tunnel error:', err.message);
    clientSocket.end();
  });
});

server.listen(PORT, () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
  console.log(`Set your browser proxy to: 127.0.0.1:${PORT}`);
});