const http = require('http');
const net = require('net');
const url = require('url');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  // Make sure we have a full URL
  const targetUrl = url.parse(req.url);
  
  if (!targetUrl.hostname) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  console.log(`Proxying HTTP: ${req.url}`);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
      'X-Forwarded-For': '',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(500);
    res.end('Proxy error: ' + err.message);
  });
});

// Handle HTTPS
server.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS: ${req.url}`);

  const [hostname, port] = req.url.split(':');

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
});