# Antigravity Connect

> ?ㅼ떆媛??묒뾽 肄붾뵫 ?섍꼍 ??Antigravity IDE? ?곕룞??怨듭쑀 臾몄꽌 諛⑹떇??肄붾뱶 ?먮뵒??
[![Deploy to GitHub Pages](https://github.com/JunHyuk1203/antigravity-connect/actions/workflows/deploy.yml/badge.svg)](https://github.com/JunHyuk1203/antigravity-connect/actions)

## ?뙋 ?쇱씠釉??곕え

**https://JunHyuk1203.github.io/antigravity-connect/**

URL??`#room=` ?뚮씪誘명꽣濡?猷몄쓣 怨듭쑀?섏꽭??
```
https://JunHyuk1203.github.io/antigravity-connect/#room=my-project-2024
```

---

## ??湲곕뒫

| 湲곕뒫 | ?ㅻ챸 |
|------|------|
| ???ㅼ떆媛?怨듬룞 ?몄쭛 | Google Docs泥섎읆 ?щ윭 紐낆씠 ?숈떆 ?몄쭛 (Y.js CRDT) |
| ?렞 ?쇱씠釉?而ㅼ꽌 | ???而ㅼ꽌瑜??됱긽?쇰줈 ?ㅼ떆媛?援щ텇 |
| ?쨼 怨듭쑀 AI 梨꾪똿 | 紐⑤뱺 李멸??먭? 蹂대뒗 AI 梨꾪똿 (Gemini API ?먮뒗 濡쒖뺄 IDE) |
| ?뵕 留곹겕 怨듭쑀 | URL留?怨듭쑀?섎㈃ 利됱떆 李멸? |
| ?뮶 ?ㅽ봽?쇱씤 ???| IndexedDB濡?釉뚮씪?곗? ?ъ떆???꾩뿉???댁슜 ?좎? |
| ?뵆 IDE ?곌껐 | 濡쒖뺄 Antigravity IDE? WebSocket ?곕룞 |

---

## ?? ?쒖옉?섍린

### ?????ъ슜 (諛고룷 ?꾨즺)
1. **[留곹겕 ?묒냽](https://JunHyuk1203.github.io/antigravity-connect/)**
2. ?대쫫怨?猷?ID ?낅젰
3. URL????먯뿉寃?怨듭쑀

### 濡쒖뺄 媛쒕컻
```bash
git clone https://github.com/JunHyuk1203/antigravity-connect
cd antigravity-connect
npm install
npm run dev
```

---

## ?뵆 濡쒖뺄 IDE ?곌껐 (ag-bridge)

Antigravity IDE??AI媛 ????梨꾪똿??吏곸젒 ?묐떟?섍쾶 ?⑸땲??

### ?좏뻾 議곌굔
1. **Antigravity IDE** ?ㅽ뻾 以?2. **Antigravity Ask Bridge** ?뺤옣 ?ㅼ튂:
   ```
   Antigravity IDE ??Extensions ??"Antigravity Ask Bridge" 寃????Install
   ```
   ?먮뒗 [Open VSX?먯꽌 吏곸젒 ?ㅼ튂](https://open-vsx.org/extension/antigravityautomation/antigravity-ask-bridge)

### 釉뚮┸吏 ?ㅽ뻾
```bash
# ws ?⑦궎吏 ?ㅼ튂 (理쒖큹 1??
npm install ws

# 釉뚮┸吏 ?ㅽ뻾
node ag-bridge.mjs --room my-project-2024
```

### ?듭뀡
```
--room      猷?ID (?뱀빋怨??숈씪?섍쾶 ?ㅼ젙)
--port      釉뚮┸吏 ?쒕쾭 ?ы듃 (湲곕낯: 5821)
--ide-port  Antigravity Ask Bridge ?ы듃 (湲곕낯: 5821)
--ide-host  IDE ?몄뒪??(湲곕낯: 127.0.0.1)
```

---

## ?룛截??꾪궎?띿쿂

```
[釉뚮씪?곗? A] ??WebRTC P2P????[釉뚮씪?곗? B]
      ??                          ??      ?붴???? Y.js CRDT ?숆린?????????             (?쒓렇?먮쭅: signaling.yjs.dev)

[釉뚮씪?곗?] ??WebSocket????[ag-bridge.mjs]
                                  ??                          [Antigravity IDE]
                          (Ask Bridge Ext.)
```

---

## ?썱截?湲곗닠 ?ㅽ깮

- **[Y.js](https://github.com/yjs/yjs)** ??CRDT ?ㅼ떆媛??숆린??- **[y-webrtc](https://github.com/yjs/y-webrtc)** ??P2P WebRTC ?숆린??- **[y-indexeddb](https://github.com/yjs/y-indexeddb)** ???ㅽ봽?쇱씤 ?곸냽??- **[Vite](https://vitejs.dev/)** ??鍮뚮뱶 ?꾧뎄
- **GitHub Pages** ???뺤쟻 ?몄뒪??- **Gemini API** ??AI ?대갚

---

## ?뱞 ?쇱씠?좎뒪

MIT 짤 2024 Antigravity Connect

