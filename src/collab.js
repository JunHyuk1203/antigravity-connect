/**
 * collab.js — Y.js real-time sync engine
 * Uses y-webrtc (P2P) + y-indexeddb (offline persistence)
 */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { showToast } from './utils.js';

let _ydoc = null;
let _provider = null;

/**
 * Initialize Y.js document with WebRTC sync
 * @param {string} roomId
 * @returns {{ ydoc: Y.Doc, provider: WebrtcProvider }}
 */
export async function initCollab(roomId) {
  // Create Y.js document
  _ydoc = new Y.Doc();

  // Persist to IndexedDB so content survives page refresh
  const persistence = new IndexeddbPersistence(`ag-connect-${roomId}`, _ydoc);
  await new Promise(resolve => persistence.on('synced', resolve));

  // Sync via WebRTC P2P (uses public signaling servers — no backend needed)
  _provider = new WebrtcProvider(`antigravity-connect-${roomId}`, _ydoc, {
    signaling: [
      'wss://signaling.yjs.dev',
      'wss://y-webrtc-signaling-eu.herokuapp.com',
    ],
    maxConns: 20,
    filterBcConns: false, // allow BroadcastChannel for same-origin tabs
  });

  // Update sync status
  const syncDot   = document.getElementById('sync-dot');
  const syncLabel = document.getElementById('sync-label');

  _provider.on('synced', ({ synced }) => {
    if (synced) {
      syncDot.className = 'sync-dot synced';
      syncLabel.textContent = '동기화됨';
    } else {
      syncDot.className = 'sync-dot syncing';
      syncLabel.textContent = '동기화 중...';
    }
  });

  _provider.on('status', ({ connected }) => {
    if (connected) {
      showToast('🌐 협업 세션에 연결됐습니다', 'success');
    }
  });

  // Update peer count in status bar
  _provider.awareness.on('change', updatePeerCount);

  console.log(`[Collab] Room: ${roomId}`);
  return { ydoc: _ydoc, provider: _provider };
}

function updatePeerCount() {
  if (!_provider) return;
  const states = _provider.awareness.getStates();
  const count  = states.size;   // includes self
  const el     = document.getElementById('sb-peers');
  if (el) el.textContent = `${count}명 접속`;

  const countEl = document.getElementById('collab-count');
  if (countEl) countEl.textContent = `${count}명 편집 중`;
}

export function getYdoc()    { return _ydoc;     }
export function getProvider(){ return _provider; }
