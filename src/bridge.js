/**
 * bridge.js — Local Antigravity IDE bridge connector
 * Connects to the ag-bridge.mjs script running on the user's machine
 * via WebSocket (ws://127.0.0.1:5822)
 */

import { showToast } from './utils.js';
import { onBridgeMessage } from './chat.js';

const BRIDGE_PORTS = [5822, 3000];
let _bridgeState = 'disconnected'; // 'connecting', 'connected', 'disconnected'
let _ideConnected = false;
let _ws = null;
let _reconnectTimer = null;
let _roomId = '';
let _connected = false;

// Expose to window for chat.js
window.__bridge = {
  connected: false,
  ws: null,
  connect,
  selectedIdeModel: 342, // GPT_OSS default
  modelQuotaStatus: {}, // modelId -> 'ok' | 'quota_exceeded' | 'unavailable'
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

  setBridgeAndIdeState('connecting', false);
  showToast('🔌 로컬 IDE에 연결 중...', '');

  try {
    _ws = new WebSocket(url);
    window.__bridge.ws = _ws;
  } catch {
    setBridgeAndIdeState('disconnected', false);
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    setBridgeAndIdeState('connected', false);
    showToast('🔌 로컬 브릿지 연결 성공!', 'success');

    if (typeof window.__checkForPendingRequests === 'function') {
      window.__checkForPendingRequests();
    }

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
    setBridgeAndIdeState('disconnected', false);
    showToast('⚠️ 로컬 브릿지 연결이 끊겼습니다', '');

    // Auto-reconnect after 5s
    clearTimeout(_reconnectTimer);
    _reconnectTimer = setTimeout(() => {
      if (!_connected) connect(url, roomId);
    }, 5000);
  };

  _ws.onerror = () => {
    setBridgeAndIdeState('disconnected', false);
  };
}

function handleBridgeMessage(msg) {
  switch (msg.type) {
    case 'status':
      {
        const initiallyConnected = _ideConnected;
        setBridgeAndIdeState('connected', msg.ide);
        if (msg.ide && !initiallyConnected) {
          showToast('✅ Antigravity IDE 연결됨!', 'success');
        }
      }
      break;

    case 'ideStatus':
      {
        const prevConnected = _ideConnected;
        setBridgeAndIdeState('connected', msg.connected);
        if (msg.connected && !prevConnected) {
          showToast('✅ Antigravity IDE 연결됨!', 'success');
        } else if (!msg.connected && prevConnected) {
          showToast('⚠️ IDE 연결이 끊겼습니다', 'error');
        }
      }
      break;

    case 'response':
      // NOTE: In shared-ide mode, responses are handled directly by sendViaBridge() Promise.
      // onBridgeMessage is NOT called here to prevent duplicate responses.
      // (The Promise resolver in chat.js already handles the response.)
      // Only call onBridgeMessage in local-ide mode (handled by chat.js directly).
      break;

    case 'modelStatus':
      // Bridge reports quota/availability of a model
      if (msg.modelId !== undefined) {
        window.__bridge.modelQuotaStatus[msg.modelId] = msg.status; // 'ok' | 'quota_exceeded' | 'unavailable'
        // Dispatch event so chat.js can update the UI
        window.dispatchEvent(new CustomEvent('modelStatusUpdate', { detail: msg }));
      }
      break;

    case 'fileChange':
      console.log('[Bridge] File changed:', msg.path);
      break;


    case 'ping':
      _ws?.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      console.log('[Bridge] Unknown message:', msg);
  }
}

function setBridgeAndIdeState(bridgeState, ideConnected) {
  _bridgeState = bridgeState;
  
  if (bridgeState !== 'connected') {
    _ideConnected = false;
  } else {
    _ideConnected = ideConnected;
  }

  const isFullyConnected = (bridgeState === 'connected' && _ideConnected);
  window.__bridge.connected = isFullyConnected;

  if (window.__presence_provider) {
    window.__presence_provider.awareness.setLocalStateField('ideConnected', isFullyConnected);
  }

  const dot   = document.getElementById('bridge-dot');
  const label = document.getElementById('bridge-label');
  const aiDot = document.getElementById('ai-status-dot');

  if (!dot || !label) return;

  if (bridgeState === 'connecting') {
    dot.className = 'bridge-dot connecting';
    label.textContent = '연결 중...';
    if (aiDot) {
      aiDot.style.background = '#D29922';
      aiDot.style.boxShadow = '0 0 6px #D29922';
    }
  } else if (bridgeState === 'disconnected') {
    dot.className = 'bridge-dot disconnected';
    label.textContent = 'IDE 연결 안됨';
    if (aiDot) {
      aiDot.style.background = '#3B82F6';
      aiDot.style.boxShadow = '0 0 6px #3B82F6';
    }
  } else {
    // bridgeState === 'connected'
    if (_ideConnected) {
      dot.className = 'bridge-dot connected';
      label.textContent = 'IDE 연결됨';
      if (aiDot) {
        aiDot.style.background = '#3FB950';
        aiDot.style.boxShadow = '0 0 6px #3FB950';
      }
    } else {
      dot.className = 'bridge-dot connecting';
      label.textContent = 'IDE 연결 대기 중';
      if (aiDot) {
        aiDot.style.background = '#D29922';
        aiDot.style.boxShadow = '0 0 6px #D29922';
      }
    }
  }
}
