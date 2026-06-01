/**
 * presence.js — Live cursors and user avatars
 * Uses Y.js Awareness protocol
 */

import { APP } from './main.js';

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

let _provider = null;

/**
 * @param {import('y-webrtc').WebrtcProvider} provider
 * @param {string} myName
 * @param {string} myColor
 */
export function initPresence(provider, myName, myColor) {
  _provider = provider;
  window.__presence_provider = provider;

  // Set own awareness state
  provider.awareness.setLocalStateField('user', {
    name:   myName,
    color:  myColor,
    initials: initials(myName),
  });

  provider.awareness.setLocalStateField('cursor', null);
  provider.awareness.setLocalStateField('ideConnected', false); // default

  // Update presence bar on change
  provider.awareness.on('change', () => {
    const states = provider.awareness.getStates();
    renderAvatars(states);
    updateHostIdeStatus(states);
  });
}

function updateHostIdeStatus(states) {
  let hostConnected = false;
  let hostName = '';
  states.forEach((state) => {
    if (state.ideConnected) {
      hostConnected = true;
      hostName = state.user?.name || '호스트';
    }
  });

  const badge = document.getElementById('host-ide-badge');
  if (badge) {
    if (hostConnected) {
      badge.textContent = `🟢 Host IDE (${hostName})`;
      badge.className = 'host-ide-badge online';
    } else {
      badge.textContent = '🔴 Host IDE 연결 안됨';
      badge.className = 'host-ide-badge offline';
    }
  }
  window.__hostIdeConnected = { connected: hostConnected, name: hostName };
}

  // Track cursor position in editor
  const editor = document.getElementById('code-editor');
  if (editor) {
    editor.addEventListener('keyup',  () => updateCursorAwareness(provider));
    editor.addEventListener('click',  () => updateCursorAwareness(provider));
    editor.addEventListener('select', () => updateCursorAwareness(provider));
  }

  // Initial render
  renderAvatars(provider.awareness.getStates());
  updateHostIdeStatus(provider.awareness.getStates());
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function updateCursorAwareness(provider) {
  const editor = document.getElementById('code-editor');
  if (!editor) return;

  const pos = editor.selectionStart;
  const val = editor.value;
  const pre = val.slice(0, pos);
  const lines = pre.split('\n');
  const line  = lines.length - 1;
  const ch    = lines[lines.length - 1].length;

  provider.awareness.setLocalStateField('cursor', { line, ch, pos });
}

function renderAvatars(states) {
  const bar    = document.getElementById('presence-bar');
  if (!bar) return;

  bar.innerHTML = '';
  let count = 0;

  states.forEach((state, clientId) => {
    if (!state.user) return;
    const { name, color, initials: ini } = state.user;

    const avatar = document.createElement('div');
    avatar.className = 'presence-avatar';
    avatar.style.background = color || COLORS[count % COLORS.length];
    avatar.textContent = ini || name[0].toUpperCase();
    avatar.setAttribute('data-tooltip', name);
    avatar.title = name;

    bar.appendChild(avatar);
    count++;
  });

  // Render remote cursors in editor
  renderRemoteCursors(states);
}

function renderRemoteCursors(states) {
  const editor    = document.getElementById('code-editor');
  const cursorDiv = document.getElementById('remote-cursors');
  if (!editor || !cursorDiv) return;

  cursorDiv.innerHTML = '';

  const myClientId = _provider?.awareness?.clientID;
  const lineH = 23.625; // 13.5px font × 1.75 line-height
  const charW = 8.1;    // approx char width for JetBrains Mono 13.5px
  const padTop  = 14;
  const padLeft = 16;

  states.forEach((state, clientId) => {
    if (clientId === myClientId) return;
    if (!state.user || !state.cursor) return;

    const { name, color } = state.user;
    const { line, ch } = state.cursor;

    const top  = padTop  + line * lineH;
    const left = padLeft + ch   * charW;

    // Cursor line
    const curLine = document.createElement('div');
    curLine.className = 'remote-cursor-line';
    curLine.style.cssText = `
      top: ${top}px;
      left: ${left}px;
      height: ${lineH}px;
      background: ${color};
      width: 2px;
    `;
    cursorDiv.appendChild(curLine);

    // Label
    const label = document.createElement('div');
    label.className = 'remote-cursor-label';
    label.style.cssText = `
      top: ${top - 20}px;
      left: ${left}px;
      background: ${color};
    `;
    label.textContent = name;
    cursorDiv.appendChild(label);
  });
}
