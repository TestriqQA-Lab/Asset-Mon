// Tiny webhook receiver that logs every delivery to a file.
const http = require('http');
const fs = require('fs');
const PORT = process.env.PORT || 7777;
const LOG = process.env.LOG || 'webhook-log.json';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const event = req.headers['x-assetmon-event'];
    const sig = req.headers['x-assetmon-signature'];
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      url: req.url,
      event, sig,
      body: body.slice(0, 4000),
    };
    fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(PORT, () => console.log('webhook receiver on', PORT));
