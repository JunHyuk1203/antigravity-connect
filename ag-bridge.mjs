#!/usr/bin/env node
/**
 * ag-bridge.mjs — Antigravity Connect 로컬 브릿지 (100% 무의존성 에디션)
 *
 * 이 버전은 외부 패키지('ws' 등)에 전혀 의존하지 않으며,
 * Node.js 내장 모듈(http, net, crypto)만을 사용하여 구현되었습니다.
 * 따라서 npm install 없이 즉시 단독 실행(node.exe)이 가능합니다.
 */

import http from 'http';
import crypto from 'crypto';
import net from 'net';
import { argv, exit } from 'process';

// ─── CLI Args ───────────────────────────────────
function parseArgs() {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (args[key] !== true) i++;
    }
  }
  return args;
}

const args = parseArgs();
const ROOM     = args.room     || 'default';
const PORT     = parseInt(args.port     || '5822'); // Default to 5822 to avoid conflict with IDE on 5821
const IDE_PORT = parseInt(args['ide-port'] || '5821');
const IDE_HOST = args['ide-host'] || '127.0.0.1';

console.log(`
╔═══════════════════════════════════════╗
║   Antigravity Connect — Native Bridge ║
╚═══════════════════════════════════════╝
  Room:     ${ROOM}
  Listen:   ws://127.0.0.1:${PORT}
  IDE:      ws://${IDE_HOST}:${IDE_PORT}
`);

// ─── State ──────────────────────────────────────
/** @type {Set<NativeWebSocket>} */
const webClients = new Set();
let ideSocket = null;
let pendingRequests = new Map(); // id → { ws }

// ─── Native WebSocket Class ──────────────────────
class NativeWebSocket {
  constructor(socket, isClient = false) {
    this.socket = socket;
    this.isClient = isClient;
    this.buffer = Buffer.alloc(0);
    this.listeners = {};
    this.readyState = 1; // OPEN

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseFrames();
    });

    this.socket.on('close', () => {
      this.readyState = 3; // CLOSED
      this.emit('close');
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  on(event, cb) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  }

  emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(...args); } catch (e) { console.error(e); }
      });
    }
  }

  send(data) {
    if (this.socket.destroyed || this.readyState !== 1) return;
    const payload = Buffer.from(data);
    const len = payload.length;

    let header;
    if (len <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + Opcode 1 (Text)
      header[1] = this.isClient ? (0x80 | len) : len;
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = this.isClient ? (0x80 | 126) : 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = this.isClient ? (0x80 | 127) : 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    if (this.isClient) {
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        masked[i] = payload[i] ^ mask[i % 4];
      }
      this.socket.write(Buffer.concat([header, mask, masked]));
    } else {
      this.socket.write(Buffer.concat([header, payload]));
    }
  }

  close() {
    this.readyState = 2; // CLOSING
    this.socket.end();
  }

  parseFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      
      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0F;
      const hasMask = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7F;

      if (opcode === 8) { // Connection Close
        this.socket.end();
        return;
      }

      let headerOffset = 2;
      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        headerOffset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        headerOffset = 10;
      }

      let maskKeyOffset = headerOffset;
      if (hasMask) {
        headerOffset += 4;
      }

      const totalFrameLen = headerOffset + payloadLen;
      if (this.buffer.length < totalFrameLen) return;

      const payload = this.buffer.subarray(headerOffset, totalFrameLen);
      let dataBuffer = payload;

      if (hasMask) {
        const maskKey = this.buffer.subarray(maskKeyOffset, maskKeyOffset + 4);
        dataBuffer = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          dataBuffer[i] = payload[i] ^ maskKey[i % 4];
        }
      }

      if (opcode === 9) { // Ping
        const pongHeader = Buffer.alloc(2);
        pongHeader[0] = 0x8A; // FIN + Pong Opcode
        pongHeader[1] = 0;
        this.socket.write(pongHeader);
      } else if (opcode === 1) { // Text Message
        this.emit('message', dataBuffer.toString());
      }

      this.buffer = this.buffer.subarray(totalFrameLen);
    }
  }
}

// ─── WebSocket Server (for web app) ─────────────
const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('pong');
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on('upgrade', (req, socket) => {
  const origin = req.headers['origin'] || '';
  const allowed = [
    'http://localhost',
    'http://127.0.0.1',
    'https://github.io',
  ];
  
  const isAllowed = !origin || allowed.some(a => origin.startsWith(a)) || origin.includes('github.io');
  if (!isAllowed) {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  const ws = new NativeWebSocket(socket, false);
  console.log(`[Bridge] Web client connected`);
  webClients.add(ws);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join':
        console.log(`[Bridge] Client joined room: ${msg.room}`);
        ws.send(JSON.stringify({
          type: 'status',
          ide: ideSocket !== null && ideSocket.readyState === 1,
        }));
        break;

      case 'ask':
        console.log(`[Bridge] Ask from web: "${msg.prompt?.slice(0, 60)}..."`);
        await forwardToIDE(msg.id, msg.prompt, ws);
        break;

      default:
        console.log(`[Bridge] Unknown msg: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    webClients.delete(ws);
    console.log(`[Bridge] Web client disconnected`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Bridge] Listening on ws://127.0.0.1:${PORT}`);
  console.log(`[Bridge] Health: http://127.0.0.1:${PORT}/ping`);
  connectToIDE();
});

// ─── Antigravity IDE Connection ──────────────────
function connectToIDE() {
  console.log(`[Bridge] Connecting to Antigravity IDE at ws://${IDE_HOST}:${IDE_PORT}...`);

  const rawSocket = net.connect(IDE_PORT, IDE_HOST);
  let ws = null;
  let handshakeDone = false;

  rawSocket.on('connect', () => {
    const key = crypto.randomBytes(16).toString('base64');
    const handshakeReq = [
      `GET / HTTP/1.1`,
      `Host: ${IDE_HOST}:${IDE_PORT}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `\r\n`
    ].join('\r\n');
    rawSocket.write(handshakeReq);
  });

  rawSocket.on('data', (chunk) => {
    if (!handshakeDone) {
      const resp = chunk.toString();
      if (resp.startsWith('HTTP/1.1 101')) {
        handshakeDone = true;
        ws = new NativeWebSocket(rawSocket, true);
        ideSocket = ws;
        
        console.log(`[Bridge] ✅ Connected to Antigravity IDE`);
        broadcast({ type: 'ideStatus', connected: true });

        // Feed remaining data if there's any body frame after HTTP headers
        const headerEnd = chunk.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const remainder = chunk.subarray(headerEnd + 4);
          if (remainder.length > 0) {
            ws.buffer = remainder;
            ws.parseFrames();
          }
        }

        ws.on('message', (rawMsg) => {
          let msg;
          try { msg = JSON.parse(rawMsg); } catch { return; }

          if (msg.type === 'response' || msg.text) {
            const reqId = msg.id || msg.requestId;
            if (reqId && pendingRequests.has(reqId)) {
              const { ws: clientWs } = pendingRequests.get(reqId);
              pendingRequests.delete(reqId);
              if (clientWs.readyState === 1) {
                clientWs.send(JSON.stringify({ type: 'response', id: reqId, text: msg.text }));
              }
            } else {
              broadcast({ type: 'response', text: msg.text || msg.response });
            }
          }
        });

        ws.on('close', () => {
          ideSocket = null;
          console.log('[Bridge] IDE connection closed. Retrying in 5s...');
          broadcast({ type: 'ideStatus', connected: false });
          setTimeout(connectToIDE, 5000);
        });
      } else {
        console.error('[Bridge] IDE Handshake failed: ' + resp);
        rawSocket.destroy();
      }
    }
  });

  rawSocket.on('close', () => {
    if (!handshakeDone) {
      console.log('[Bridge] IDE connection closed before handshake. Retrying in 5s...');
      setTimeout(connectToIDE, 5000);
    }
  });

  rawSocket.on('error', (e) => {
    // Suppress console spam if IDE is not open
    // console.error(`[Bridge] IDE error: ${e.message}`);
  });
}

async function forwardToIDE(id, prompt, requesterWs) {
  if (!ideSocket || ideSocket.readyState !== 1) {
    const restResponse = await tryRESTFallback(prompt);
    if (restResponse) {
      requesterWs.send(JSON.stringify({ type: 'response', id, text: restResponse }));
    } else {
      requesterWs.send(JSON.stringify({
        type: 'response',
        id,
        text: '로컬 Antigravity IDE에 연결되어 있지 않습니다. IDE가 실행 중인지 확인해 주세요.',
      }));
    }
    return;
  }

  pendingRequests.set(id, { ws: requesterWs });

  ideSocket.send(JSON.stringify({
    type:  'ask',
    id,
    text:  prompt,
    model: 'auto',
  }));

  setTimeout(() => {
    if (pendingRequests.has(id)) {
      pendingRequests.delete(id);
      requesterWs.send(JSON.stringify({
        type: 'response',
        id,
        text: 'IDE 응답 시간이 초과됐습니다. Antigravity IDE가 응답 중인지 확인해 주세요.',
      }));
    }
  }, 30000);
}

async function tryRESTFallback(prompt) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ text: prompt });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5820,
      path: '/ask',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.text || parsed.response);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

function broadcast(msg) {
  const json = JSON.stringify(msg);
  webClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(json);
  });
}

// ─── Graceful shutdown ───────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down...');
  server.close();
  ideSocket?.close();
  exit(0);
});
