# ▲ Antigravity Connect

> 실시간 협업 코딩 환경 및 Antigravity IDE 연동형 AI 공유 웹 서비스

[![Deploy to GitHub Pages](https://github.com/JunHyuk1203/antigravity-connect/actions/workflows/deploy.yml/badge.svg)](https://github.com/JunHyuk1203/antigravity-connect/actions)

안티그래비티 커넥트는 구글 문서(Google Docs)처럼 실시간으로 팀원들과 동시 코딩을 진행하며, 안티그래비티 IDE의 AI 코딩 비서 능력을 실시간으로 룸 전체에 공유(P2P)할 수 있는 프리미엄 협업 개발 에디터입니다.

---

## 💻 공식 웹 서비스 데모

**🌐 [https://JunHyuk1203.github.io/antigravity-connect/](https://JunHyuk1203.github.io/antigravity-connect/)**

방 번호(`#room=`) 파라미터를 추가하여 팀원에게 간단히 링크를 공유할 수 있습니다:
```
https://JunHyuk1203.github.io/antigravity-connect/#room=team-collab-space
```

---

## ⚡ 주요 핵심 기능

| 기능 | 설명 |
|------|------|
| **실시간 공동 편집** | CRDT(Y.js) 알고리즘 기반으로 여러 명이 동시에 코드를 짜도 충돌 없이 실시간 병합 |
| **팀원 커서 트래킹** | 참여자별 이름과 개별 색상이 부여된 실시간 아바타 및 라이브 텍스트 에디터 커서 |
| **P2P AI 계정 공유** | 호스트의 PC에 설치된 안티그래비티 AI 응답을 룸 전체 팀원에게 WebRTC 보안 채널로 동시 공유 |
| **원클릭 데스크톱 런처** | 로컬 서버 구동, 브라우저 열기, 포트 매핑을 한 번에 자동화해주는 12KB 초경량 native 실행 파일 |
| **로컬 오프라인 보존** | 브라우저를 닫거나 연결이 중단되어도 IndexedDB에 자동 임시 저장되어 유실 방지 |

---

## 🚀 사용 가이드 (1초만에 룸 시작하기)

### 방법 A: 데스크톱 런처 (`AntigravityRoom.exe`) 사용 (가장 추천! 👍)

Windows 사용자를 위해 복잡한 터미널 명령어나 Node.js 설치 확인 과정을 단 한 번의 클릭으로 자동화해주는 native 실행 파일(`.exe`)을 제공합니다.

1. 이 저장소 최상위 경로에 있는 **[AntigravityRoom.exe](AntigravityRoom.exe)**를 실행합니다.
2. 원하는 **ROOM ID**를 적어 넣거나 "랜덤 생성" 버튼을 클릭합니다.
3. **🚀 호스트 모드로 시작** 버튼을 클릭합니다.
   * *배후에서 로컬 `ag-bridge.mjs` 백그라운드 프로세스가 자동 실행되며, 팀원들과의 실시간 연동 및 로컬 IDE AI 통신이 즉시 준비됩니다.*
   * *동시에 호스트 웹 브라우저가 실행되며 룸에 자동 진입합니다!*
4. 외부에서 접속하는 팀원은 런처 하단의 **"🌐 게스트로 참가"** 버튼을 누르거나 생성된 URL 링크만 브라우저에 붙여넣으면 무설정으로 코딩 및 AI를 공유받을 수 있습니다.

---

## 🔌 호스트 로컬 IDE 수동 연결 (고급 사용자용)

런처(`.exe`)를 쓰지 않고 터미널에서 수동으로 로컬 Antigravity IDE를 연동할 수도 있습니다.

### 사전 요구사항
1. **Antigravity IDE**가 활성화되어 켜져 있어야 합니다.
2. IDE 확장 마켓플레이스에서 **`Antigravity Ask Bridge`** 확장을 설치합니다.
   * [Open VSX 마켓플레이스에서 수동 설치](https://open-vsx.org/extension/antigravityautomation/antigravity-ask-bridge)

### 수동 브릿지 실행
```bash
# 1. ws 패키지 최초 설치 (1회만)
npm install ws

# 2. 브릿지 실행 (룸 이름을 맞춰 실행)
node ag-bridge.mjs --room team-collab-space
```

### 명령어 파라미터
```
--room      룸 ID (웹 서비스 주소의 room= 파라미터와 정확히 매칭되어야 합니다)
--port      로컬 브릿지 수신 포트 (기본값: 5821)
--ide-port  IDE 내부 브릿지 포트 (기본값: 5821)
--ide-host  IDE 내부 브릿지 호스트 주소 (기본값: 127.0.0.1)
```

---

## 🔒 보안성 및 네트워크 구조

```
[게스트 브라우저]                                       [호스트 브라우저] (호스트 PC 내부)
       │                                                      │
       │  (1) AI 질문 전송 (WebRTC P2P 암호화망)             │
       ├─────────────────────────────────────────────────────►│
       │                                                      │  (2) WebSocket (127.0.0.1:5821)
       │                                                      ├──────────────┐
       │                                                      │              ▼
       │  (4) 답변 실시간 수신                                 │     [ag-bridge.mjs]
       │◄─────────────────────────────────────────────────────┤              │
       │                                                      │              ▼
       │                                                      │     [Antigravity IDE] (AI 실행)
       │                                                      │◄─────────────┘
```

* **보안 안전**: `ag-bridge.mjs` 혹은 `Launcher`에 내장된 WebSocket 통신은 오직 `127.0.0.1`(Localhost)로만 수신 대기하므로 외부 위협 노출도가 제로(0)입니다.
* **통신 경로**: 모든 원격 팀원(게스트)들과의 AI 트래픽 공유는 보안성이 확보된 WebRTC P2P 및 Y.js 동기화 프로토콜을 통해 Host 브라우저가 다리를 놓아주는 방식으로 동작합니다.

---

## 🛠️ 사용 기술 스택

* **[Y.js](https://github.com/yjs/yjs)**: 실시간 CRDT 데이터 무손실 충돌 제어 및 병합 엔진
* **[y-webrtc](https://github.com/yjs/y-webrtc)**: 중앙 서버 없는 초고속 P2P WebRTC 통신 레이어
* **[y-indexeddb](https://github.com/yjs/y-indexeddb)**: 웹 브라우저 내 오프라인 임시 자동저장 장치
* **Windows Forms (C# / .NET)**: Native 초경량 룸 런처 빌드
* **Gemini API / Google AI Studio**: 개인 API용 Fallback 백엔드
* **GitHub Pages & Actions**: 자동 빌드 및 분산 정적 호스팅

---

## 📄 라이선스

MIT © 2026 Antigravity Connect
