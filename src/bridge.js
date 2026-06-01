/**
 * bridge.js — Local Antigravity IDE bridge connector
 * Connects to the ag-bridge.mjs script running on the user's machine
 * via WebSocket (ws://127.0.0.1:5821)
 */

import { showToast } from './utils.js';
import { onBridgeMessage } from './chat.js';

const BRIDGE_PORTS = [5821, 5820, 5822, 3000];
let _ws = null;
let _reconnectTimer = null;
let _roomId = '';
let _connected = false;

// Expose to window for chat.js
window.__bridge = {
  connected: false,
  ws: null,
  connect,
};

/**
 * @param {{ roomId: string }} APP
 */
export function initBridge(APP) {
  _roomId = APP.roomId;
  // Auto-try to connect (silently)
  tryAutoConnect();
}

async function tryAutoConnect() {
  for (const port of BRIDGE_PORTS) {
    const success = await probe(port);
    if (success) {
      connect(`ws://127.0.0.1:${port}`, _roomId);
      return;
    }
  }
  // No bridge found — that's fine, will use Gemini fallback
  console.info('[Bridge] No local bridge found. Using Gemini API fallback.');
}

function probe(port) {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeout = setTimeout(() => { ws.close(); resolve(false); }, 800);
    ws.onopen  = () => { clearTimeout(timeout); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(timeout); resolve(false); };
  });
}

export function connect(url, roomId) {
  if (_ws) {
    _ws.close();
    _ws = null;
  }

  updateBridgeStatus('connecting');
  showToast('🔌 로컬 IDE에 연결 중...', '');

  try {
    _ws = new WebSocket(url);
    window.__bridge.ws = _ws;
  } catch {
    updateBridgeStatus('disconnected');
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    window.__bridge.connected = true;
    updateBridgeStatus('connected');
    showToast('✅ Antigravity IDE 연결됨!', 'success');

    // Identify ourselves to the bridge
    _ws.send(JSON.stringify({
      type:   'join',
      room:   roomId,
      client: 'web',
    }));
  };

  _ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleBridgeMessage(msg);
    } catch (e) {
      console.error('[Bridge] Invalid message:', e);
    }
  };

  _ws.onclose = () => {
    _connected = false;
    window.__bridge.connected = false;
    updateBridgeStatus('disconnected');
    showToast('⚠️ IDE 연결이 끊겼습니다', '');

    // Auto-reconnect after 5s
    clearTimeout(_reconnectTimer);
    _reconnectTimer = setTimeout(() => {
      if (!_connected) connect(url, roomId);
    }, 5000);
  };

  _ws.onerror = () => {
    updateBridgeStatus('disconnected');
  };
}

function handleBridgeMessage(msg) {
  switch (msg.type) {
    case 'response':
      // AI response from Antigravity IDE
      onBridgeMessage(msg.text);
      break;

    case 'fileChange':
      // IDE changed a file — could sync to editor
      console.log('[Bridge] File changed:', msg.path);
      break;

    case 'ping':
      _ws?.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      console.log('[Bridge] Unknown message:', msg);
  }
}

function updateBridgeStatus(state) {
  const dot   = document.getElementById('bridge-dot');
  const label = document.getElementById('bridge-label');
  const aiDot = document.getElementById('ai-status-dot');

  if (!dot || !label) return;

  dot.className = `bridge-dot ${state}`;

  switch (state) {
    case 'connected':
      label.textContent = 'IDE 연결됨';
      if (aiDot) {
        aiDot.style.background = '#3FB950';
        aiDot.style.boxShadow = '0 0 6px #3FB950';
      }
      break;
    case 'connecting':
      label.textContent = '연결 중...';
      break;
    case 'disconnected':
      label.textContent = 'IDE 연결 안됨';
      if (aiDot) {
        aiDot.style.background = '#3B82F6';
        aiDot.style.boxShadow = '0 0 6px #3B82F6';
      }
      break;
  }
}
