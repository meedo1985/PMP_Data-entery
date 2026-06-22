// Quick LAN connectivity test — run with: node test-lan.js
// Open http://192.168.10.106:3737 on your phone while this is running.
// Press Ctrl+C to stop.
const http = require('http');
const os   = require('os');

const PORT = 3737;

function getLanIPs() {
  const out = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const i of iface) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  const from = req.socket.remoteAddress;
  console.log(`[${new Date().toLocaleTimeString()}] HIT from ${from}  ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#0f1e30;color:#fff}
    h1{color:#2ecc71;font-size:2em}p{color:#aaa;font-size:1.2em}</style></head>
    <body>
      <h1>&#10003; LAN Connection Works!</h1>
      <p>Your device can reach this PC.</p>
      <p style="font-size:.9em;color:#666">Request from: ${from}</p>
    </body></html>
  `);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIPs();
  console.log('\n=== PMP LAN Connectivity Test ===');
  console.log(`\nOpen one of these on your phone:\n`);
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  console.log('\nWaiting for connections... (Ctrl+C to stop)\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${PORT} is already in use.`);
    console.error('The PMP app might already be running. Try opening the URL directly.\n');
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});
