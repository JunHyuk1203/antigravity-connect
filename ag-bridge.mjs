#!/usr/bin/env node
/**
 * ag-bridge.mjs — Antigravity Connect 로컬 브릿지
 *
 * 이 스크립트는 사용자의 PC에서 실행하여
 * Antigravity IDE ↔ 웹 앱을 연결합니다.
 *
 * 필요 조건:
 *   - Node.js 18+
 *   - Antigravity IDE 실행 중
 *   - "Antigravity Ask Bridge" 확장 설치
 *     (https://open-vsx.org/extension/antigravityautomation/antigravity-ask-bridge)
 *
 * 실행:
 *   node ag-bridge.mjs --room my-project-2024
 *   node ag-bridge.mjs --room my-project --port 5821 --ide-port 5821
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
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
const PORT     = parseInt(args.port     || '5821');
const IDE_PORT = parseInt(args['ide-port'] || '5821');
const IDE_HOST = args['ide-host'] || '127.0.0.1';

console.log(`
╔═══════════════════════════════════════╗
║     Antigravity Connect — Bridge      ║
╚═══════════════════════════════════════╝
  Room:     ${ROOM}
  Listen:   ws://127.0.0.1:${PORT}
  IDE:      ws://${IDE_HOST}:${IDE_PORT}
`);

// ─── State ──────────────────────────────────────
/** @type {Set<WebSocket>} */
const webClients = new Set();
let ideSocket = null;
let pendingRequests = new Map(); // id → { ws, resolve }

// ─── WebSocket Server (for web app) ─────────────
const server = createServer((req, res) => {
  // Simple health endpoint
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

const wss = new WebSocketServer({
  server,
  // Allow connections from GitHub Pages and localhost
  verifyClient: ({ origin }) => {
    const allowed = [
      'http://localhost',
      'http://127.0.0.1',
      'https://github.io',
      null, // no origin (e.g., node clients)
    ];
    if (!origin) return true;
    return allowed.some(a => !a || origin.startsWith(a)) || origin.includes('github.io');
  },
});

wss.on('connection', (ws, req) => {
  console.log(`[Bridge] Web client connected from ${req.socket.remoteAddress}`);
  webClients.add(ws);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join':
        console.log(`[Bridge] Client joined room: ${msg.room}`);
        // Send current IDE connection status
        ws.send(JSON.stringify({
          type: 'status',
          ide: ideSocket?.readyState === WebSocket.OPEN,
        }));
        break;

      case 'ask':
        console.log(`[Bridge] Ask from web: "${msg.prompt?.slice(0, 60)}..."`);
        await forwardToIDE(msg.id, msg.prompt, ws);
        break;

      case 'pong':
        break;

      default:
        console.log(`[Bridge] Unknown msg: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    webClients.delete(ws);
    console.log(`[Bridge] Web client disconnected`);
  });

  ws.on('error', (e) => console.error('[Bridge] WS error:', e.message));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Bridge] Listening on ws://127.0.0.1:${PORT}`);
  console.log(`[Bridge] Health: http://127.0.0.1:${PORT}/ping`);
  connectToIDE();
});

// ─── Antigravity IDE Connection ──────────────────
function connectToIDE() {
  console.log(`[Bridge] Connecting to Antigravity IDE at ws://${IDE_HOST}:${IDE_PORT}...`);

  ideSocket = new WebSocket(`ws://${IDE_HOST}:${IDE_PORT}`);

  ideSocket.on('open', () => {
    console.log(`[Bridge] ✅ Connected to Antigravity IDE`);
    broadcast({ type: 'ideStatus', connected: true });
  });

  ideSocket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Response from IDE → forward to requesting web client
    if (msg.type === 'response' || msg.text) {
      const reqId = msg.id || msg.requestId;
      if (reqId && pendingRequests.has(reqId)) {
        const { ws } = pendingRequests.get(reqId);
        pendingRequests.delete(reqId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'response', id: reqId, text: msg.text }));
        }
      } else {
        // Broadcast to all web clients
        broadcast({ type: 'response', text: msg.text || msg.response });
      }
    }
  });

  ideSocket.on('close', () => {
    console.log('[Bridge] IDE connection closed. Retrying in 5s...');
    broadcast({ type: 'ideStatus', connected: false });
    setTimeout(connectToIDE, 5000);
  });

  ideSocket.on('error', (e) => {
    console.error(`[Bridge] IDE error: ${e.message}`);
    console.log('[Bridge] Make sure Antigravity Ask Bridge extension is running.');
  });
}

async function forwardToIDE(id, prompt, requesterWs) {
  if (!ideSocket || ideSocket.readyState !== WebSocket.OPEN) {
    // No IDE — try Antigravity REST API fallback
    const restResponse = await tryRESTFallback(prompt);
    if (restResponse) {
      requesterWs.send(JSON.stringify({ type: 'response', id, text: restResponse }));
    } else {
      requesterWs.send(JSON.stringify({
        type: 'response',
        id,
        text: '로컬 Antigravity IDE에 연결되어 있지 않습니다. IDE가 실행 중인지, Antigravity Ask Bridge 확장이 설치됐는지 확인해 주세요.',
      }));
    }
    return;
  }

  // Track this request
  pendingRequests.set(id, { ws: requesterWs });

  // Send to IDE (Ask Bridge format)
  ideSocket.send(JSON.stringify({
    type:  'ask',
    id,
    text:  prompt,
    model: 'auto',
  }));

  // Timeout
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
  try {
    const res = await fetch(`http://127.0.0.1:5820/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.text || data.response;
    }
  } catch {}
  return null;
}

function broadcast(msg) {
  const json = JSON.stringify(msg);
  webClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  });
}

// ─── Graceful shutdown ───────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down...');
  wss.close();
  ideSocket?.close();
  exit(0);
});
