/**
 * Antigravity Connect — Main Entry Point
 * Wires together: Y.js collab, editor, presence, AI chat, bridge
 */

import { initCollab } from './collab.js';
import { initEditor }  from './editor.js';
import { initPresence } from './presence.js';
import { initChat }    from './chat.js';
import { initBridge }  from './bridge.js';
import { showToast, escHtml, formatTime } from './utils.js';

// ─── Globals ────────────────────────────────────
export let APP = {
  myName:  '',
  myColor: '#3B82F6',
  roomId:  '',
  ydoc:    null,
  provider: null,
};

// ─── Join Screen Logic ───────────────────────────
function setupJoinScreen() {
  if (window.debugLog) window.debugLog("setupJoinScreen 기동 시작...");
  const joinScreen = document.getElementById('join-screen');
  const appEl      = document.getElementById('app');
  const nameInput  = document.getElementById('input-name');
  const roomInput  = document.getElementById('input-room');
  const btnJoin    = document.getElementById('btn-join');
  const btnRandom  = document.getElementById('btn-random-room');
  const swatches   = document.querySelectorAll('.swatch');

  if (window.debugLog) {
    window.debugLog("UI 요소 로딩 상태:");
    window.debugLog("- joinScreen: " + !!joinScreen);
    window.debugLog("- appEl: " + !!appEl);
    window.debugLog("- nameInput: " + !!nameInput);
    window.debugLog("- roomInput: " + !!roomInput);
    window.debugLog("- btnJoin: " + !!btnJoin);
    window.debugLog("- btnRandom: " + !!btnRandom);
  }

  // Restore from localStorage (safely wrapped to avoid SecurityError)
  let savedName = '';
  let selectedColor = '#3B82F6';
  try {
    savedName = localStorage.getItem('ag-name') || '';
    selectedColor = localStorage.getItem('ag-color') || '#3B82F6';
  } catch (e) {
    console.warn('[Storage] localStorage restore failed:', e);
  }
  nameInput.value = savedName;

  // Highlight stored color
  swatches.forEach(s => {
    if (s.dataset.color === selectedColor) s.classList.add('active');
    else s.classList.remove('active');

    s.addEventListener('click', () => {
      swatches.forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      selectedColor = s.dataset.color;
    });
  });

  // Pre-fill room from URL hash
  const hashRoom = new URLSearchParams(window.location.hash.replace('#', '')).get('room');
  if (hashRoom) roomInput.value = hashRoom;

  // Random room ID (3 digits)
  btnRandom.addEventListener('click', () => {
    roomInput.value = Math.floor(Math.random() * 900 + 100).toString();
  });

  // Join
  btnJoin.addEventListener('click', join);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  async function join() {
    const name = nameInput.value.trim();
    const room = roomInput.value.trim().replace(/\s+/g, '-').toLowerCase();

    if (window.debugLog) window.debugLog(`[Join] 가입 시도: 이름=${name}, 방=${room}`);

    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#F85149'; return; }
    if (!room)  { roomInput.focus(); roomInput.style.borderColor = '#F85149'; return; }

    // Save prefs (safely wrapped to avoid SecurityError)
    try {
      localStorage.setItem('ag-name', name);
      localStorage.setItem('ag-color', selectedColor);
    } catch (e) {
      console.warn('[Storage] localStorage save failed:', e);
    }

    APP.myName  = name;
    APP.myColor = selectedColor;
    APP.roomId  = room;

    // Update URL
    window.location.hash = `room=${room}`;

    // Show app
    joinScreen.style.display = 'none';
    appEl.style.display = 'flex';
    appEl.style.flexDirection = 'column';

    // Update title bar room name
    document.getElementById('tb-room-name').textContent = room;

    // Init everything
    try {
      if (window.debugLog) window.debugLog("startApp()을 비동기 호출합니다...");
      await startApp();
    } catch (err) {
      console.error('App init error:', err);
      if (window.debugLog) window.debugLog("❌ 앱 가동 오류 발생: " + err.message);
      showToast('앱 초기화 중 오류가 발생했습니다.', 'error');
    }
  }
}

async function startApp() {
  if (window.debugLog) window.debugLog("startApp 기동: Collab(동기화) 모듈 연동 중...");
  // 1. Collab (Y.js + WebRTC)
  const { ydoc, provider } = await initCollab(APP.roomId);
  if (window.debugLog) window.debugLog("✅ Collab 연동 완료. 에디터 초기화 중...");
  APP.ydoc     = ydoc;
  APP.provider = provider;

  // 2. Editor
  await initEditor(ydoc);
  if (window.debugLog) window.debugLog("✅ 에디터 컴포넌트 바인딩 완료. 커서 연동 중...");

  // 3. Presence (cursors, avatars)
  initPresence(provider, APP.myName, APP.myColor);
  if (window.debugLog) window.debugLog("✅ Presence/커서 채널 완료. AI 채팅 준비 중...");

  // 4. AI Chat
  initChat(ydoc, APP);
  if (window.debugLog) window.debugLog("✅ AI 채팅 채널 완료. IDE 로컬 브릿지 연동 중...");

  // 5. Local Bridge
  initBridge(APP);
  if (window.debugLog) window.debugLog("🎉 [성공] 룸 접속 및 전 시스템 연동이 성공적으로 완료되었습니다!");

  // ─── Share button ───
  document.getElementById('btn-share').addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast('🔗 링크가 클립보드에 복사됐습니다!', 'success');
    });
  });

  // ─── Leave button ───
  document.getElementById('btn-leave').addEventListener('click', () => {
    if (confirm('룸에서 나가시겠습니까?')) {
      provider.destroy();
      ydoc.destroy();
      window.location.hash = '';
      window.location.reload();
    }
  });
}

// ─── Boot ────────────────────────────────────────
// Natively bypasses DOMContentLoaded racing conditions to guarantee instant execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setupJoinScreen());
} else {
  setupJoinScreen();
}
