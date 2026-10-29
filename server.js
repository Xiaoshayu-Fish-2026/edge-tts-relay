// Edge TTS 的 WebSocket 中转（Render 版，跟 Worker / Deno 版同一个东西）。
//
// 客户端连 wss://<服务名>.onrender.com/consumer/speech/synthesize/readaloud/edge/v1?...
// 本进程把连接原样转给 wss://speech.platform.bing.com，二进制音频原样回传。
//
// 额外提供 GET /ping 用于保活：Render 免费实例 15 分钟没请求就休眠，
// 让机器人每 10 分钟打一次 /ping 就能一直醒着。
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const UPSTREAM = 'wss://speech.platform.bing.com';
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/ping')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('edge-tts relay: connect with a WebSocket\n');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (client) => {
    const url = new URL(req.url || '/', 'http://localhost');

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (['host', 'upgrade', 'connection', 'sec-websocket-key',
        'sec-websocket-version', 'sec-websocket-extensions'].includes(key)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }

    const upstream = new WebSocket(UPSTREAM + url.pathname + url.search, { headers });
    upstream.binaryType = 'arraybuffer';

    const queue = [];
    let ready = false;

    upstream.on('open', () => {
      ready = true;
      for (const m of queue.splice(0)) {
        try { upstream.send(m); } catch { /* ignore */ }
      }
    });
    upstream.on('message', (data, isBinary) => {
      try { client.send(data, { binary: isBinary }); } catch { /* client gone */ }
    });
    upstream.on('close', () => { try { client.close(); } catch { /* ignore */ } });
    upstream.on('error', () => { try { client.close(); } catch { /* ignore */ } });

    client.on('message', (data, isBinary) => {
      if (ready) { try { upstream.send(data, { binary: isBinary }); } catch { /* ignore */ } }
      else queue.push(data);
    });
    client.on('close', () => { try { upstream.close(); } catch { /* ignore */ } });
  });
});

server.listen(PORT, () => {
  console.log(`edge-tts relay listening on ${PORT}`);
});
