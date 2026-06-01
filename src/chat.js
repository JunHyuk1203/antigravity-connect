/**
 * chat.js — Shared AI chat panel
 * All messages are stored in a Y.Array so all participants see the same chat.
 * Supports: Gemini API (fallback) and local Antigravity IDE bridge.
 */

import * as Y from 'yjs';
import { getEditorContent, getSelectedText } from './editor.js';
import { showToast, escHtml, formatTime } from './utils.js';

let _ydoc    = null;
let _ymsg    = null; // Y.Array of message objects
let _APP     = null;
let _apiKey  = null;
let _model   = 'gemini-3.5-flash'; // Default to Gemini API
let _useLocalBridge = false;
let _useSharedBridge = false;
let _processingRequests = new Set();
let _selectedIdeModelId = 342; // GPT_OSS - default IDE model
const IDE_MODEL_NAMES = {
  342:  'GPT-OSS 120B',
  1018: 'Gemini 3.5 Flash (M)',
  1019: 'Gemini 3.5 Flash (H)',
  1017: 'Gemini 3.5 Flash (L)',
  1164: 'Gemini 3.1 Pro (L)',
  1165: 'Gemini 3.1 Pro (H)',
  1163: 'Claude Sonnet 4.6',
  1154: 'Claude Opus 4.6',
};

// ─── Init ────────────────────────────────────────
export function initChat(ydoc, APP) {
  _ydoc  = ydoc;
  _APP   = APP;
  _ymsg  = ydoc.getArray('chat:messages');

  // Restore API key (safely wrapped to avoid SecurityError)
  try {
    _apiKey = localStorage.getItem('ag-gemini-key') || null;
  } catch (e) {
    console.warn('[Storage] ag-gemini-key restore failed:', e);
  }
  updateAPIKeyUI();

  // Observe shared messages and render
  _ymsg.observe(() => {
    renderMessages();
    if (window.__bridge?.connected) {
      checkForPendingRequests();
    }
  });
  renderMessages(); // initial

  // Expose check function so bridge.js can trigger it when a local connection succeeds
  window.__checkForPendingRequests = checkForPendingRequests;

  // Input handling
  const chatInput  = document.getElementById('chat-input');
  const sendBtn    = document.getElementById('chat-send-btn');

  chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 130) + 'px';
    sendBtn.disabled = !this.value.trim();
    sendBtn.parentElement.style.display = 'flex';
  });

  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // API Key save
  document.getElementById('btn-save-key')?.addEventListener('click', saveAPIKey);
  document.getElementById('api-key-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveAPIKey();
  });

  // Model selector
  document.getElementById('model-btn')?.addEventListener('click', toggleModelDropdown);
  document.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', () => selectModel(opt));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.model-selector')) {
      document.getElementById('model-dropdown').style.display = 'none';
    }
  });

  // Context chips
  document.querySelectorAll('.ctx-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  // Bridge connect button
  document.getElementById('btn-bridge-connect')?.addEventListener('click', openBridgeModal);
  document.getElementById('btn-connect-bridge')?.addEventListener('click', tryConnectBridge);

  // Bridge room display
  const roomDisplay = document.getElementById('bridge-room-display');
  if (roomDisplay) roomDisplay.textContent = APP.roomId;

  // Model status update from bridge
  window.addEventListener('modelStatusUpdate', (e) => {
    const { modelId, status } = e.detail;
    updateModelQuotaBadge(modelId, status);
  });

  // Auto-select first IDE model if bridge is connected
  selectIdeModelById(342);
}

// ─── Message Rendering ────────────────────────────
function renderMessages() {
  const history = document.getElementById('chat-history');
  if (!history) return;

  const msgs = _ymsg.toArray();
  history.innerHTML = '';

  if (msgs.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'system-msg';
    welcome.textContent = '👋 AI에게 코드에 대해 질문해 보세요';
    history.appendChild(welcome);
    return;
  }

  msgs.forEach(msg => history.appendChild(buildMsgEl(msg)));
  history.scrollTop = history.scrollHeight;
}

function buildMsgEl(msg) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = msg.text;
    return div;
  }

  const div = document.createElement('div');
  div.className = `chat-msg ${msg.role === 'ai' ? 'ai-msg' : 'user-msg'}`;

  const isAI = msg.role === 'ai';
  const avatarColor = isAI ? '#3B82F6' : (msg.color || '#8B949E');
  const avatarText  = isAI ? '▲' : (msg.initials || msg.name?.[0]?.toUpperCase() || 'U');

  div.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar" style="background:${avatarColor}">${avatarText}</div>
      <span class="msg-name">${escHtml(isAI ? '🤖 Antigravity AI' : msg.name || '알 수 없음')}</span>
      <span class="msg-time">${formatTime(msg.ts)}</span>
    </div>
    <div class="msg-body ${isAI ? 'ai-body' : ''}">${
      isAI ? renderMarkdown(msg.text) : `<p>${escHtml(msg.text)}</p>`
    }</div>
  `;
  return div;
}

// Simple markdown renderer
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

// ─── Send Message ─────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('chat-send-btn').disabled = true;

  if (_model === 'shared-ide') {
    if (!window.__bridge?.connected) {
      showToast('⚠️ 브릿지에 연결된 IDE가 없습니다. 런청에서 브릿지를 실행하세요.', 'error');
      input.value = text;
      input.style.height = Math.min(input.scrollHeight, 130) + 'px';
      document.getElementById('chat-send-btn').disabled = false;
      return;
    }

    // Build user message
    const userMsg = {
      role:     'user',
      type:     'message',
      name:     _APP.myName,
      color:    _APP.myColor,
      initials: _APP.myName.slice(0,2).toUpperCase(),
      text,
      ts:       Date.now(),
    };
    _ymsg.push([userMsg]);

    const ctx = buildContext(text);

    // Push pending message to the shared array so the host processes it
    const pendingId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    const pendingMsg = {
      id:           pendingId,
      role:         'ai',
      type:         'message',
      name:         'Antigravity AI (연결된 IDE)',
      text:         '⏳ IDE 응답을 대기 중...',
      status:       'pending',
      prompt:       ctx,
      ideModelId:   _selectedIdeModelId,
      ts:           Date.now(),
    };
    _ymsg.push([pendingMsg]);
    return;
  }

  // Build user message
  const userMsg = {
    role:     'user',
    type:     'message',
    name:     _APP.myName,
    color:    _APP.myColor,
    initials: _APP.myName.slice(0,2).toUpperCase(),
    text,
    ts:       Date.now(),
  };
  _ymsg.push([userMsg]);

  // Typing indicator (local-only, not shared)
  showTypingIndicator();

  // Build context
  const ctx = buildContext(text);

  // Send to AI
  try {
    let response;
    if (_useLocalBridge && window.__bridge?.connected) {
      response = await sendViaBridge(ctx);
    } else if (_apiKey) {
      response = await sendViaGemini(ctx);
    } else {
      response = generateMockResponse(text);
    }

    removeTypingIndicator();

    const aiMsg = {
      role: 'ai',
      type: 'message',
      name: 'Antigravity AI',
      text: response,
      ts:   Date.now(),
    };
    _ymsg.push([aiMsg]);
  } catch (err) {
    removeTypingIndicator();
    console.error('AI error:', err);
    const errMsg = {
      role: 'ai',
      type: 'message',
      name: 'Antigravity AI',
      text: `오류가 발생했습니다: ${err.message}\n\nGemini API 키를 확인하거나, 로컬 IDE 브릿지를 연결해 주세요.`,
      ts:   Date.now(),
    };
    _ymsg.push([errMsg]);
  }
}

function buildContext(userText) {
  const lines = [];
  lines.push(`사용자 질문: ${userText}`);

  if (document.getElementById('chip-editor')?.classList.contains('active')) {
    const code = getEditorContent();
    if (code.trim()) {
      lines.push(`\n현재 편집 중인 코드:\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\``);
    }
  }

  if (document.getElementById('chip-selection')?.classList.contains('active')) {
    const sel = getSelectedText();
    if (sel.trim()) {
      lines.push(`\n선택한 코드:\n\`\`\`\n${sel}\n\`\`\``);
    }
  }

  return lines.join('\n');
}

// ─── Gemini API ───────────────────────────────────
async function sendViaGemini(prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${_model}:generateContent?key=${_apiKey}`;

  const body = {
    contents: [{
      parts: [{
        text: `당신은 Antigravity IDE에 내장된 AI 코딩 어시스턴트입니다. 
실시간 협업 코딩 세션에서 여러 개발자와 함께 코드를 분석하고 도움을 제공합니다.
한국어로 답변하고, 코드 예시는 마크다운 코드 블록을 사용하세요.

${prompt}`,
      }]
    }],
    generationConfig: {
      temperature:     0.7,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 받지 못했습니다.';
}

// ─── Bridge ───────────────────────────────────────
async function sendViaBridge(prompt, ideModelId) {
  return new Promise((resolve, reject) => {
    const bridge = window.__bridge;
    if (!bridge?.ws) { reject(new Error('브릿지 미연결')); return; }

    const reqId = Date.now().toString();
    bridge.ws.send(JSON.stringify({ type: 'ask', id: reqId, prompt, model: ideModelId || _selectedIdeModelId }));

    const timeout = setTimeout(() => reject(new Error('브릿지 응답 시간 초과')), 60000);

    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'response' && msg.id === reqId) {
          clearTimeout(timeout);
          bridge.ws.removeEventListener('message', handler);
          resolve(msg.text);
        }
      } catch {}
    };
    bridge.ws.addEventListener('message', handler);
  });
}

// ─── Mock (no API key) ────────────────────────────
function generateMockResponse(text) {
  const q = text.toLowerCase();

  if (q.includes('버그') || q.includes('오류') || q.includes('에러')) {
    return `**디버깅 도움말** 🔍\n\n오류를 분석하려면 다음 정보가 필요합니다:\n\n1. 오류 메시지 전문\n2. 재현 단계\n3. 예상 동작 vs 실제 동작\n\n> 💡 **팁**: AI 채팅을 완전히 활성화하려면 상단의 **"API 키 설정"** 또는 **"IDE 연결"**을 사용하세요.`;
  }

  if (q.includes('함수') || q.includes('function')) {
    return `**함수 작성 가이드** ⚡\n\n\`\`\`javascript\n// 모던 JavaScript 함수 패턴\nasync function processData(input) {\n  if (!input) throw new Error('입력값 없음');\n\n  const result = await transform(input);\n  return result;\n}\n\`\`\`\n\n> API 키를 설정하면 실제 코드를 분석해 드립니다.`;
  }

  return `**Antigravity AI** 입니다 🤖\n\n현재 데모 모드로 동작 중입니다. 실제 AI 기능을 사용하려면:\n\n1. **Gemini API 키** 입력 (무료)\n2. 또는 **로컬 Antigravity IDE** 연결\n\n질문하신 내용: *"${text}"*\n\nAPI 키를 설정하면 이 질문에 정확하게 답변드릴 수 있습니다!`;
}

// ─── Typing Indicator (local only) ───────────────
function showTypingIndicator() {
  const history = document.getElementById('chat-history');
  const div = document.createElement('div');
  div.className = 'chat-msg typing-msg';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar" style="background:#3B82F6">▲</div>
      <span class="msg-name">Antigravity AI</span>
    </div>
    <div class="msg-body ai-body">
      <div class="t-dot"></div>
      <div class="t-dot"></div>
      <div class="t-dot"></div>
    </div>
  `;
  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

// ─── API Key UI ───────────────────────────────────
function saveAPIKey() {
  const input = document.getElementById('api-key-input');
  const key   = input?.value.trim();
  if (!key || !key.startsWith('AIza')) {
    showToast('올바른 Gemini API 키를 입력하세요 (AIza...)', 'error');
    return;
  }
  _apiKey = key;
  try {
    localStorage.setItem('ag-gemini-key', key);
  } catch (e) {
    console.warn('[Storage] ag-gemini-key save failed:', e);
  }
  updateAPIKeyUI();
  showToast('✅ API 키가 저장됐습니다', 'success');
}

function updateAPIKeyUI() {
  const notice = document.getElementById('api-key-notice');
  if (!notice) return;

  if (_model.startsWith('gemini') && !_apiKey) {
    notice.style.display = '';
  } else {
    notice.style.display = 'none';
  }
}

// ─── Model Selector ───────────────────────────────
function toggleModelDropdown() {
  const dd = document.getElementById('model-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function selectModel(opt) {
  document.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
  opt.classList.add('active');
  _model = opt.dataset.model;

  // Check if this is an IDE model
  const ideModelIdStr = opt.dataset.ideModel;
  if (ideModelIdStr && ideModelIdStr !== '') {
    const ideModelId = parseInt(ideModelIdStr, 10);
    selectIdeModelById(ideModelId);
  } else {
    // Gemini API model
    _useLocalBridge = false;
    _useSharedBridge = false;
    _model = opt.dataset.model;
    const nameEl = opt.querySelector('.model-opt-name');
    document.getElementById('model-name-display').textContent = nameEl ? nameEl.textContent : opt.textContent.trim();
  }

  document.getElementById('model-dropdown').style.display = 'none';
  updateAPIKeyUI();
}

function selectIdeModelById(ideModelId) {
  _selectedIdeModelId = ideModelId;
  _model = 'shared-ide';
  _useLocalBridge = false;
  _useSharedBridge = true;

  // Update bridge state
  if (window.__bridge) window.__bridge.selectedIdeModel = ideModelId;

  // Update display name
  const name = IDE_MODEL_NAMES[ideModelId] || `Model ${ideModelId}`;
  document.getElementById('model-name-display').textContent = name;

  // Check quota status
  const status = window.__bridge?.modelQuotaStatus?.[ideModelId];
  if (status === 'quota_exceeded') {
    showToast(`⚠️ ${name}: 한도 초과 상태입니다. 다른 모델을 선택하세요.`, 'error');
  } else if (status === 'unavailable') {
    showToast(`⚠️ ${name}: 현재 계정에서 사용 불가능한 모델입니다.`, 'error');
  }

  updateAPIKeyUI();
}

function updateModelQuotaBadge(modelId, status) {
  const badge = document.getElementById(`quota-${modelId}`);
  if (!badge) return;
  if (status === 'quota_exceeded') {
    badge.textContent = '한도 초과';
    badge.className = 'model-quota-badge quota-exceeded';
  } else if (status === 'unavailable') {
    badge.textContent = '미지원';
    badge.className = 'model-quota-badge quota-unavailable';
  } else if (status === 'ok') {
    badge.textContent = '';
    badge.className = 'model-quota-badge';
  }

  // Also mark the option row visually
  const optEl = document.getElementById(`mopt-${modelId}`);
  if (optEl) {
    optEl.classList.toggle('model-quota-exceeded', status === 'quota_exceeded');
    optEl.classList.toggle('model-unavailable', status === 'unavailable');
  }
}

// ─── Bridge Modal ─────────────────────────────────
function openBridgeModal() {
  document.getElementById('bridge-modal').style.display = 'flex';
  const roomDisplay = document.getElementById('bridge-room-display');
  if (roomDisplay && _APP) roomDisplay.textContent = _APP.roomId;
}

window.closeBridgeModal = function () {
  document.getElementById('bridge-modal').style.display = 'none';
};

window.copyBridgeCmd = function () {
  const room = _APP?.roomId || 'your-room';
  navigator.clipboard.writeText(`node ag-bridge.mjs --room ${room}`)
    .then(() => showToast('명령어 복사됨', 'success'));
};

function tryConnectBridge() {
  const port = document.getElementById('bridge-port-input').value || '5822';
  if (window.__bridge) {
    window.__bridge.connect(`ws://127.0.0.1:${port}`, _APP.roomId);
  }
}

async function checkForPendingRequests() {
  if (!window.__bridge?.connected) return;

  const msgs = _ymsg.toArray();
  const pendingIndex = msgs.findIndex(m => m.status === 'pending');
  if (pendingIndex === -1) return;

  const msg = msgs[pendingIndex];
  
  if (_processingRequests.has(msg.id)) return;
  _processingRequests.add(msg.id);

  console.log(`[Host] Processing pending request: ${msg.id}`);

  const ideModelId = msg.ideModelId || _selectedIdeModelId;

  // Claim the task
  const claimedMsg = {
    ...msg,
    status: 'processing',
    hostClientId: _ydoc.clientID.toString(),
    hostName: _APP.myName,
    text: `⏳ Antigravity IDE에서 답변을 생성하는 중... (호스트: ${escHtml(_APP.myName)}, 모델: ${IDE_MODEL_NAMES[ideModelId] || ideModelId})`,
  };

  try {
    _ydoc.transact(() => {
      const currentMsgs = _ymsg.toArray();
      const idx = currentMsgs.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        _ymsg.delete(idx, 1);
        _ymsg.insert(idx, [claimedMsg]);
      }
    });

    const response = await sendViaBridge(msg.prompt, ideModelId);

    const finalMsg = {
      id:   msg.id,
      role: 'ai',
      type: 'message',
      name: `Antigravity AI (via ${claimedMsg.hostName})`,
      text: response,
      ts:   Date.now(),
    };

    _ydoc.transact(() => {
      const latestMsgs = _ymsg.toArray();
      const latestIndex = latestMsgs.findIndex(m => m.id === msg.id);
      if (latestIndex !== -1) {
        _ymsg.delete(latestIndex, 1);
        _ymsg.insert(latestIndex, [finalMsg]);
      }
    });
  } catch (err) {
    console.error('[Host] Error processing pending request:', err);
    _ydoc.transact(() => {
      const latestMsgs = _ymsg.toArray();
      const latestIndex = latestMsgs.findIndex(m => m.id === msg.id);
      if (latestIndex !== -1) {
        _ymsg.delete(latestIndex, 1);
        _ymsg.insert(latestIndex, [{
          id:   msg.id,
          role: 'ai',
          type: 'message',
          name: 'Antigravity AI',
          text: `⚠️ 호스트 IDE 처리 중 에러 발생: ${err.message}`,
          ts:   Date.now(),
        }]);
      }
    });
  } finally {
    _processingRequests.delete(msg.id);
  }
}

// Export for bridge.js to call
export function onBridgeMessage(text) {
  const aiMsg = {
    role: 'ai',
    type: 'message',
    name: 'Antigravity AI (로컬)',
    text,
    ts:   Date.now(),
  };
  _ymsg?.push([aiMsg]);
}
