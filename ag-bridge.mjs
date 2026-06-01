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
const PORT     = parseInt(args.port     || '5822');
const IDE_PORT = parseInt(args['ide-port'] || '5821');
const IDE_HOST = args['ide-host'] || '127.0.0.1';

// ─── Model Constants ──────────────────────────────
// These numeric IDs match the IDE extension's internal enum.
const IDE_MODELS = {
  GEMINI_FLASH:    1018,
  GEMINI_PRO_LOW:  1164,
  GEMINI_PRO_HIGH: 1165,
  CLAUDE_SONNET:   1163,
  CLAUDE_OPUS:     1154,
  GPT_OSS:         342,
};
// GPT_OSS (342) is the only model working on this account tier.
// GEMINI_FLASH (1018) quota resets at ~21:34 KST.
// CLAUDE_SONNET (1163) / CLAUDE_OPUS (1154) not available on this tier.
const DEFAULT_MODEL = IDE_MODELS.GPT_OSS;

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
        console.log(`[Bridge] Ask from web: "${msg.prompt?.slice(0, 60)}..." model=${msg.model || DEFAULT_MODEL}`);
        await forwardToIDE(msg.id, msg.prompt, msg.model || DEFAULT_MODEL, ws);
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

function postJSON(path, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({
      hostname: IDE_HOST,
      port: IDE_PORT - 1, // httpPort is always wsPort - 1 (5820)
      path: path,
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
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: IDE_HOST,
      port: IDE_PORT - 1,
      path: path,
      method: 'GET'
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function listConversations() {
  return getJSON('/conversations');
}

function isConversationFinished(convo) {
  const steps = convo?.trajectory?.steps ?? [];
  const lastStep = steps.at(-1);
  return Boolean(lastStep && lastStep.type !== 'CORTEX_STEP_TYPE_USER_INPUT');
}

function isCascadeIdle(listData, conversationId) {
  if (!listData || typeof listData !== 'object') return false;
  const entry = listData[conversationId];
  if (!entry) return false;
  return entry.status === 'CASCADE_RUN_STATUS_IDLE';
}

async function forwardToIDE(id, prompt, modelId, requesterWs) {
  if (!ideSocket || ideSocket.readyState !== 1) {
    requesterWs.send(JSON.stringify({
      type: 'response',
      id,
      text: '로컬 Antigravity IDE에 연결되어 있지 않습니다. IDE가 실행 중인지 확인해 주세요.',
    }));
    return;
  }

  const resolvedModel = (typeof modelId === 'number' && modelId > 0) ? modelId : DEFAULT_MODEL;
  console.log(`[Bridge] Queueing job in IDE with model=${resolvedModel}...`);
  
  let jobId = null;
  try {
    const result = await postJSON('/conversations', { text: prompt, model: resolvedModel });
    const res = result.data;
    if (res && res.success && res.job_id) {
      jobId = res.job_id;
      console.log(`[Bridge] Job queued successfully, Job ID: ${jobId}`);
    } else {
      throw new Error(res?.error || `HTTP ${result.statusCode}`);
    }
  } catch (err) {
    console.error(`[Bridge] Queue failed:`, err.message);
    requesterWs.send(JSON.stringify({
      type: 'response',
      id,
      text: `IDE 작업 등록 실패: ${err.message}`,
    }));
    return;
  }

  let pollTimer = null;
  let convoPollTimer = null;
  let timeoutTimer = null;
  
  const cleanTimers = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (convoPollTimer) clearInterval(convoPollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };

  timeoutTimer = setTimeout(() => {
    cleanTimers();
    requesterWs.send(JSON.stringify({
      type: 'response',
      id,
      text: 'IDE 응답 시간이 초과됐습니다. Antigravity IDE가 다른 작업을 수행 중인지 확인해 주세요.',
    }));
  }, 45000); // 45 seconds overall timeout to allow full generation

  pollTimer = setInterval(async () => {
    try {
      const job = await getJSON(`/conversations/jobs/${jobId}`);
      console.log(`[Bridge] Polling job ${jobId} status: ${job?.status}`);
      
      if (!job) return;
      
      if (job.status === 'completed') {
        clearInterval(pollTimer);
        pollTimer = null;
        
        const convoId = job.conversation_id;
        console.log(`[Bridge] Job completed! Conversation ID: ${convoId}. Opening in IDE panel...`);

        // ✅ Focus the conversation in the IDE panel immediately
        // This switches the IDE chat panel to show this conversation in real-time
        postJSON(`/conversations/${convoId}/focus`, {})
          .then(r => console.log(`[Bridge] ✅ Conversation focused in IDE panel: ${convoId}`, r?.data))
          .catch(e => console.warn(`[Bridge] Could not focus conversation in IDE panel: ${e.message}`));


        let attempts = 0;
        const maxAttempts = 40;

        
        convoPollTimer = setInterval(async () => {
          attempts++;
          try {
            const [convo, convoList] = await Promise.all([
              getJSON(`/conversations/${convoId}`),
              listConversations().catch(() => null),
            ]);

            const finished = isConversationFinished(convo);
            const idle = convoList ? isCascadeIdle(convoList, convoId) : true; // if list fails, assume idle

            console.log(`[Bridge] Poll attempt ${attempts}/${maxAttempts}: finished=${finished}, idle=${idle}`);

            if (finished && idle) {
              const result = extractConversationText(convo);
              cleanTimers();
              if (result) {
                console.log(`[Bridge] ✅ AI Response retrieved. Sending to client.`);
                requesterWs.send(JSON.stringify({ type: 'response', id, text: result }));
                // Report this model as working
                requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: 'ok' }));
              } else {
                const errStep = (convo?.trajectory?.steps ?? []).findLast(s => s.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE');
                const userErrMsg = errStep?.errorMessage?.error?.userErrorMessage;
                const errorCode = errStep?.errorMessage?.error?.errorCode;
                // Determine error type for UI
                let modelStatus = 'unavailable';
                let fallbackText = 'IDE에서 대화를 열었으나, AI가 답변을 작성하지 못했습니다.';
                if (userErrMsg) {
                  if (errorCode === 429 || userErrMsg.includes('quota') || userErrMsg.includes('Individual quota')) {
                    modelStatus = 'quota_exceeded';
                    fallbackText = `⚠️ 한도 초과: ${userErrMsg}`;
                  } else if (userErrMsg.includes('unknown model') || userErrMsg.includes('not found') || userErrMsg.includes('terminated')) {
                    modelStatus = 'unavailable';
                    fallbackText = `⚠️ 모델 사용 불가: ${userErrMsg}`;
                  } else {
                    fallbackText = `⚠️ IDE AI 오류: ${userErrMsg}`;
                  }
                }
                console.warn(`[Bridge] Conversation finished but no text. Status: ${modelStatus}`, errStep);
                requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: modelStatus }));
                requesterWs.send(JSON.stringify({ type: 'response', id, text: fallbackText }));
              }
            } else if (attempts >= maxAttempts) {
              cleanTimers();
              requesterWs.send(JSON.stringify({
                type: 'response',
                id,
                text: 'IDE 응답 대기 시간이 초과됐습니다. AI가 여전히 처리 중이거나 오류가 발생했을 수 있습니다.',
              }));
            }
          } catch (convoErr) {
            console.error(`[Bridge] Conversation polling error:`, convoErr.message);
          }
        }, 1000);
      } else if (job.status === 'failed') {
        cleanTimers();
        console.error(`[Bridge] Job failed:`, job.error);
        requesterWs.send(JSON.stringify({
          type: 'response',
          id,
          text: `IDE 처리 오류: ${job.error || '알 수 없음'}`,
        }));
      }
    } catch (err) {
      console.error(`[Bridge] Polling error:`, err.message);
    }
  }, 1000);
}

function extractConversationText(convo) {
  const steps = convo?.trajectory?.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      // plannerResponse with no response/modifiedResponse means it errored (STOP_REASON_CLIENT_STREAM_ERROR etc)
      const text = step.plannerResponse?.modifiedResponse ?? step.plannerResponse?.response ?? null;
      if (text) return text;
      continue;
    }
    if (step.type === 'CORTEX_STEP_TYPE_MODEL_RESPONSE') {
      const text = step.modelResponse?.text ?? null;
      if (text) return text;
      continue;
    }
    if (step.type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
      return step.notifyUser?.notificationContent ?? null;
    }
    // NOTE: CORTEX_STEP_TYPE_ERROR_MESSAGE is intentionally NOT handled here.
    // Error steps are handled in forwardToIDE after isConversationFinished check.
  }
  return null;
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
