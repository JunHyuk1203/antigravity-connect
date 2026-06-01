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
      type: 'response', id,
      text: '로컬 Antigravity IDE에 연결되어 있지 않습니다.',
    }));
    return;
  }

  const resolvedModel = (typeof modelId === 'number' && modelId > 0) ? modelId : DEFAULT_MODEL;

  // ── Step 1: 현재 IDE에 열린 활성 대화 ID 조회 ──────────────────────────
  let activeConvoId = null;

  // 방법 A: /conversations/active 엔드포인트 (IDE 재시작 후 사용 가능)
  try {
    const activeRes = await getJSON('/conversations/active');
    const candidate = activeRes?.conversation_id;
    if (candidate && activeRes?.error === undefined) {
      // 대화 상태 목록을 조회하여 candidate가 RUNNING 인지 확인 (현재 이 AI 대화 세션 등과의 충돌 방지)
      const list = await getJSON('/conversations');
      const status = list?.[candidate]?.status;
      if (status === 'CASCADE_RUN_STATUS_RUNNING') {
        console.log(`[Bridge] Active conversation ${candidate} is currently RUNNING. Ignoring to prevent conflicts.`);
      } else {
        activeConvoId = candidate;
        console.log(`[Bridge] Active conversation via /active: ${activeConvoId}`);
      }
    }
  } catch (e) {
    console.log('[Bridge] /conversations/active not available or error checking status, using list fallback...');
  }

  // 방법 B: GET /conversations 리스트에서 찾기 (IDE 재시작 전 폴백)
  if (!activeConvoId) {
    try {
      const list = await getJSON('/conversations');
      if (list && typeof list === 'object' && !list.error) {
        // IDLE 상태이고 summary가 있는 가장 최근 대화 선택
        // (RUNNING은 현재 AI가 작업 중인 세션 — 건드리면 충돌)
        const idleWithSummary = Object.entries(list)
          .filter(([, v]) => v.status === 'CASCADE_RUN_STATUS_IDLE' && v.summary)
          .map(([k]) => k);

        if (idleWithSummary.length > 0) {
          activeConvoId = idleWithSummary[0];
          console.log(`[Bridge] Active conversation via list: ${activeConvoId} (${list[activeConvoId]?.summary})`);
        } else {
          // summary 없어도 IDLE인 것 사용
          const idleAny = Object.entries(list)
            .filter(([, v]) => v.status === 'CASCADE_RUN_STATUS_IDLE')
            .map(([k]) => k);
          if (idleAny.length > 0) {
            activeConvoId = idleAny[0];
            console.log(`[Bridge] Active conversation via list (no summary): ${activeConvoId}`);
          }
        }
      }
    } catch (e) {
      console.warn('[Bridge] listConversations failed:', e.message);
    }
  }

  // ── Step 2: 활성 대화가 없으면 새 대화 생성 (폴백) ───────────────────────
  if (!activeConvoId) {
    console.log('[Bridge] No suitable conversation found. Creating new one...');
    let jobId = null;
    try {
      const result = await postJSON('/conversations', { text: prompt, model: resolvedModel });
      const res = result.data;
      if (res?.success && res.job_id) {
        jobId = res.job_id;
        console.log(`[Bridge] New job: ${jobId}`);
      } else {
        throw new Error(res?.error || `HTTP ${result.statusCode}`);
      }
    } catch (err) {
      requesterWs.send(JSON.stringify({ type: 'response', id, text: `IDE 연결 실패: ${err.message}` }));
      return;
    }
    await pollJobToCompletion(id, jobId, resolvedModel, requesterWs);
    return;
  }

  // ── Step 3: 기존 대화의 현재 스텝 수를 기록 ──────────────────────────────
  let stepCountBefore = 0;
  try {
    const convo = await getJSON(`/conversations/${activeConvoId}`);
    stepCountBefore = convo?.trajectory?.steps?.length ?? 0;
    console.log(`[Bridge] Sending to active convo (${stepCountBefore} existing steps)`);
  } catch (e) {
    console.warn('[Bridge] Could not get step count:', e.message);
  }

  // ── Step 4: 활성 대화에 메시지 전송 ──────────────────────────────────────
  let messageSent = false;
  try {
    const result = await postJSON(`/conversations/${activeConvoId}/message`, {
      text: prompt,
      model: resolvedModel,
    });
    if (!result.data?.success) {
      throw new Error(result.data?.error || `HTTP ${result.statusCode}`);
    }
    console.log(`[Bridge] ✅ Message sent to active conversation`);
    messageSent = true;
  } catch (err) {
    console.error('[Bridge] Send message to active conversation failed, falling back to new conversation:', err.message);
  }

  if (!messageSent) {
    console.log('[Bridge] Creating new conversation because sending to active failed...');
    let jobId = null;
    try {
      const result = await postJSON('/conversations', { text: prompt, model: resolvedModel });
      const res = result.data;
      if (res?.success && res.job_id) {
        jobId = res.job_id;
        console.log(`[Bridge] New job: ${jobId}`);
      } else {
        throw new Error(res?.error || `HTTP ${result.statusCode}`);
      }
    } catch (err) {
      requesterWs.send(JSON.stringify({ type: 'response', id, text: `IDE 연결 실패: ${err.message}` }));
      return;
    }
    await pollJobToCompletion(id, jobId, resolvedModel, requesterWs);
    return;
  }

  // ── Step 5: 새 응답 스텝이 생길 때까지 폴링 ──────────────────────────────
  let done = false;
  let attempts = 0;
  const maxAttempts = 90; // 90초

  const timeoutTimer = setTimeout(() => {
    done = true;
    requesterWs.send(JSON.stringify({ type: 'response', id, text: 'IDE 응답 대기 시간이 초과됐습니다.' }));
  }, 92000);

  const pollTimer = setInterval(async () => {
    if (done) { clearInterval(pollTimer); return; }
    attempts++;
    try {
      const [convo, convoList] = await Promise.all([
        getJSON(`/conversations/${activeConvoId}`),
        listConversations().catch(() => null),
      ]);
      const steps = convo?.trajectory?.steps ?? [];
      const newStepCount = steps.length;
      const finished = isConversationFinished(convo);
      const idle = convoList ? isCascadeIdle(convoList, activeConvoId) : true;

      console.log(`[Bridge] Poll ${attempts}/${maxAttempts}: steps=${newStepCount}(+${newStepCount - stepCountBefore}), finished=${finished}, idle=${idle}`);

      // 새 스텝이 생겼고 대화가 완료됐을 때
      if (newStepCount > stepCountBefore && finished && idle) {
        done = true;
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);

        // 새 스텝만 추출
        const newSteps = steps.slice(stepCountBefore);
        const fakeConvo = { ...convo, trajectory: { ...convo.trajectory, steps: newSteps } };
        const result = extractConversationText(fakeConvo);

        if (result) {
          console.log('[Bridge] ✅ Got new AI response from active conversation!');
          requesterWs.send(JSON.stringify({ type: 'response', id, text: result }));
          requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: 'ok' }));
        } else {
          const errStep = newSteps.findLast(s => s.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE');
          const userErrMsg = errStep?.errorMessage?.error?.userErrorMessage;
          const errorCode = errStep?.errorMessage?.error?.errorCode;
          let modelStatus = 'unavailable';
          let fallbackText = 'IDE에서 응답을 받지 못했습니다.';
          if (userErrMsg) {
            if (errorCode === 429 || userErrMsg.includes('quota')) {
              modelStatus = 'quota_exceeded';
              fallbackText = `⚠️ 한도 초과: ${userErrMsg}`;
            } else {
              fallbackText = `⚠️ IDE 오류: ${userErrMsg}`;
            }
          }
          requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: modelStatus }));
          requesterWs.send(JSON.stringify({ type: 'response', id, text: fallbackText }));
        }
      } else if (attempts >= maxAttempts) {
        done = true;
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);
        requesterWs.send(JSON.stringify({ type: 'response', id, text: 'IDE 응답 대기 시간이 초과됐습니다.' }));
      }
    } catch (err) {
      console.error('[Bridge] Poll error:', err.message);
    }
  }, 1000);
}

// ── 새 대화(job) 완료 폴링 (폴백) ─────────────────────────────────────────
async function pollJobToCompletion(id, jobId, resolvedModel, requesterWs) {
  let pollTimer = null;
  let convoPollTimer = null;
  let timeoutTimer = null;
  const clean = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (convoPollTimer) clearInterval(convoPollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };
  timeoutTimer = setTimeout(() => { clean(); requesterWs.send(JSON.stringify({ type: 'response', id, text: 'IDE 응답 시간 초과' })); }, 60000);

  pollTimer = setInterval(async () => {
    try {
      const job = await getJSON(`/conversations/jobs/${jobId}`);
      if (!job) return;
      if (job.status === 'completed') {
        clearInterval(pollTimer); pollTimer = null;
        const convoId = job.conversation_id;
        console.log(`[Bridge] New convo ready: ${convoId}`);
        // Focus it in the IDE
        postJSON(`/conversations/${convoId}/focus`, {}).catch(() => {});
        let attempts = 0;
        convoPollTimer = setInterval(async () => {
          attempts++;
          try {
            const [convo, convoList] = await Promise.all([
              getJSON(`/conversations/${convoId}`),
              listConversations().catch(() => null),
            ]);
            const finished = isConversationFinished(convo);
            const idle = convoList ? isCascadeIdle(convoList, convoId) : true;
            if (finished && idle) {
              const result = extractConversationText(convo);
              clean();
              if (result) {
                requesterWs.send(JSON.stringify({ type: 'response', id, text: result }));
                requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: 'ok' }));
              } else {
                const errStep = (convo?.trajectory?.steps ?? []).findLast(s => s.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE');
                const userErrMsg = errStep?.errorMessage?.error?.userErrorMessage;
                const errorCode = errStep?.errorMessage?.error?.errorCode;
                let modelStatus = 'unavailable';
                let fallbackText = 'IDE에서 응답을 받지 못했습니다.';
                if (userErrMsg) {
                  if (errorCode === 429 || userErrMsg.includes('quota') || userErrMsg.includes('Quota')) {
                    modelStatus = 'quota_exceeded';
                    fallbackText = `⚠️ 한도 초과: ${userErrMsg}`;
                  } else {
                    fallbackText = `⚠️ IDE 오류: ${userErrMsg}`;
                  }
                }
                requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: modelStatus }));
                requesterWs.send(JSON.stringify({ type: 'response', id, text: fallbackText }));
              }
            } else if (attempts >= 50) {
              clean();
              requesterWs.send(JSON.stringify({ type: 'response', id, text: '대기 시간 초과' }));
            }
          } catch (e) { console.error('[Bridge] convoPoll error:', e.message); }
        }, 1000);
      } else if (job.status === 'failed') {
        clean();
        const errText = job.error || '알 수 없음';
        let modelStatus = 'unavailable';
        if (errText.includes('quota') || errText.includes('Quota') || errText.includes('429')) {
          modelStatus = 'quota_exceeded';
        }
        requesterWs.send(JSON.stringify({ type: 'modelStatus', modelId: resolvedModel, status: modelStatus }));
        requesterWs.send(JSON.stringify({ type: 'response', id, text: `⚠️ IDE 오류: ${errText}` }));
      }
    } catch (err) { console.error('[Bridge] job poll error:', err.message); }
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
