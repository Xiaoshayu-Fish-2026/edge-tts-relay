// Netlify Function：HTTP 进去，mp3 出来。
// 内部用 WebSocket 连微软 Edge TTS，把音频收集齐后 base64 返回。
// 调用：/.netlify/functions/tts?text=你好&voice=zh-CN-XiaoyiNeural
const crypto = require('node:crypto');
const WebSocket = require('ws');

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM = '130.0.2849.68';

function secMsGec() {
  let ticks = (BigInt(Math.floor(Date.now() / 1000)) + 11644473600n) * 10000000n;
  ticks -= ticks % 3000000000n;
  return crypto.createHash('sha256').update(`${ticks}${TRUSTED}`, 'ascii').digest('hex').toUpperCase();
}

function synth(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`;
    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM} Edg/${CHROMIUM} Safari/537.36`,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Sec-MS-GEC': secMsGec(),
        'Sec-MS-GEC-Version': `1-${CHROMIUM}`,
      },
    });

    const chunks = [];
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { ws.terminate(); } catch {}
      if (err) reject(err); else resolve(Buffer.concat(chunks));
    };

    ws.on('unexpected-response', (_req, res) => finish(new Error('HTTP ' + res.statusCode)));
    ws.on('open', () => {
      const ts = new Date().toISOString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
        + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>`
        + `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n`
        + `X-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) chunks.push(Buffer.from(data).subarray(2));
      else if (String(data).includes('Path:turn.end')) finish();
    });
    ws.on('error', (e) => finish(e));
    setTimeout(() => finish(new Error('timeout')), 9000);
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const text = (q.text || '').slice(0, 300);
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'text required' }) };

  try {
    const audio = await synth(
      text,
      q.voice || 'zh-CN-XiaoyiNeural',
      q.rate || '+0%',
      q.pitch || '+0Hz',
    );
    return {
      statusCode: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
      isBase64Encoded: true,
      body: audio.toString('base64'),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err && err.message || err) }) };
  }
};

