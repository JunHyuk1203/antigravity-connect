/**
 * editor.js — Collaborative code editor
 * Syncs a shared Y.Text via a <textarea> with manual CRDT binding
 * (Pure vanilla, no CodeMirror dependency to keep it CDN-free)
 */

import * as Y from 'yjs';
import { showToast } from './utils.js';

let _ytext = null;
let _editor = null;
let _isRemoteUpdate = false;

// File contents keyed by tab name
const FILE_INITIAL = {
  main: `// Antigravity Connect — 공유 코드 에디터
// 이 파일은 모든 참가자와 실시간으로 동기화됩니다.

async function fetchData(endpoint) {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(\`HTTP error: \${response.status}\`);
    }
    return await response.json();
  } catch (error) {
    console.error('Fetch failed:', error);
    throw error;
  }
}

class CollabSession {
  constructor(roomId, userName) {
    this.roomId   = roomId;
    this.userName = userName;
    this.peers    = new Map();
  }

  join() {
    console.log(\`\${this.userName} joined room: \${this.roomId}\`);
  }

  leave() {
    this.peers.clear();
  }
}

export default CollabSession;
`,
  style: `/* 공유 스타일시트 */

:root {
  --primary: #3B82F6;
  --bg: #0D1117;
  --text: #E6EDF3;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', sans-serif;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}
`,
  readme: `# Antigravity Connect

> 실시간 협업 코딩 환경 — Antigravity IDE와 연동

## 시작하기

\`\`\`bash
# 룸 참가 (URL의 # 뒤에 룸 ID가 포함됨)
https://[username].github.io/antigravity-connect/#room=my-project
\`\`\`

## 기능

- ⚡ **실시간 공동 편집** — Google Docs처럼 동시 편집
- 🎯 **라이브 커서** — 팀원 커서 실시간 표시
- 🤖 **AI 채팅** — Gemini API 또는 로컬 Antigravity IDE와 대화
- 🔗 **링크 공유** — URL만 공유하면 즉시 참가

## 로컬 IDE 연결

\`\`\`bash
# ag-bridge.mjs 실행 (Node.js 18+ 필요)
node ag-bridge.mjs --room your-room-id
\`\`\`
`,
};

const LANG_MAP = { main: 'JavaScript', style: 'CSS', readme: 'Markdown' };

let activeFile = 'main';

/**
 * @param {Y.Doc} ydoc
 */
export async function initEditor(ydoc) {
  _editor = document.getElementById('code-editor');

  // Each file gets its own Y.Text in the ydoc
  setupFile(ydoc, 'main');

  // Tab switching
  document.querySelectorAll('.file-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const file = tab.dataset.file;
      if (file === activeFile) return;

      document.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      activeFile = file;
      setupFile(ydoc, file);
    });
  });

  // Line numbers sync
  _editor.addEventListener('input', updateLineNumbers);
  _editor.addEventListener('scroll', syncLineNumScroll);
  _editor.addEventListener('keydown', handleEditorKeydown);
  _editor.addEventListener('keyup',  updateCursor);
  _editor.addEventListener('click',  updateCursor);

  updateLineNumbers();
  updateLangStatus();
}

function setupFile(ydoc, filename) {
  // Detach previous observer
  if (_ytext) {
    _ytext.unobserve(onRemoteChange);
  }

  _ytext = ydoc.getText(`file:${filename}`);

  // Initialize with default content only if empty
  if (_ytext.length === 0 && FILE_INITIAL[filename]) {
    ydoc.transact(() => {
      _ytext.insert(0, FILE_INITIAL[filename]);
    });
  }

  // Set editor content
  _isRemoteUpdate = true;
  _editor.value = _ytext.toString();
  _isRemoteUpdate = false;

  // Observe remote changes
  _ytext.observe(onRemoteChange);

  // Local edits → Y.js
  _editor.oninput = handleLocalInput;

  updateLineNumbers();
  updateLangStatus();
  document.getElementById('sb-lang').textContent = LANG_MAP[filename] || 'Text';
}

function onRemoteChange(event, transaction) {
  if (transaction.local) return; // skip own changes

  _isRemoteUpdate = true;

  // Preserve cursor position during remote update
  const sel = { start: _editor.selectionStart, end: _editor.selectionEnd };
  _editor.value = _ytext.toString();
  _editor.selectionStart = sel.start;
  _editor.selectionEnd   = sel.end;

  _isRemoteUpdate = false;
  updateLineNumbers();
}

let _lastText = '';
function handleLocalInput() {
  if (_isRemoteUpdate) return;

  const newText = _editor.value;
  const oldText = _lastText;
  _lastText = newText;

  // Compute diff (simple)
  // Find longest common prefix
  let i = 0;
  while (i < oldText.length && i < newText.length && oldText[i] === newText[i]) i++;

  // Find longest common suffix
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (
    oldSuffix > i &&
    newSuffix > i &&
    oldText[oldSuffix - 1] === newText[newSuffix - 1]
  ) {
    oldSuffix--;
    newSuffix--;
  }

  const deleteCount = oldSuffix - i;
  const insertText  = newText.slice(i, newSuffix);

  // Apply to Y.Text
  _ytext.doc.transact(() => {
    if (deleteCount > 0) _ytext.delete(i, deleteCount);
    if (insertText)       _ytext.insert(i, insertText);
  });

  updateLineNumbers();
}

function handleEditorKeydown(e) {
  // Tab → 4 spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = _editor.selectionStart;
    const end   = _editor.selectionEnd;
    const val   = _editor.value;
    _editor.value = val.slice(0, start) + '    ' + val.slice(end);
    _editor.selectionStart = _editor.selectionEnd = start + 4;
    _editor.dispatchEvent(new Event('input'));
  }
}

function updateLineNumbers() {
  const lines = (_editor.value.match(/\n/g) || []).length + 1;
  const el    = document.getElementById('line-numbers');
  if (!el) return;
  el.innerHTML = Array.from({ length: lines }, (_, i) =>
    `<div>${i + 1}</div>`
  ).join('');
}

function syncLineNumScroll() {
  const ln = document.getElementById('line-numbers');
  if (ln) ln.scrollTop = _editor.scrollTop;
}

function updateCursor() {
  const val   = _editor.value;
  const pos   = _editor.selectionStart;
  const pre   = val.slice(0, pos);
  const lines = pre.split('\n');
  const ln    = lines.length;
  const col   = lines[lines.length - 1].length + 1;
  const el    = document.getElementById('sb-cursor');
  if (el) el.textContent = `Ln ${ln}, Col ${col}`;
}

function updateLangStatus() {
  const el = document.getElementById('sb-lang');
  if (el) el.textContent = LANG_MAP[activeFile] || 'Text';
}

/**
 * Get current editor content (for AI context)
 */
export function getEditorContent() {
  return _editor ? _editor.value : '';
}

/**
 * Get selected text
 */
export function getSelectedText() {
  if (!_editor) return '';
  return _editor.value.slice(_editor.selectionStart, _editor.selectionEnd);
}
