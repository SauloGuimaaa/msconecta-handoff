'use strict';
// ============================================================================
// CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\find_btn_midia.js
// Varredura de segredos: 0 ocorrências de token/senha/cookie/api-key/secret/
// chat_id/IP/caminho-com-usuário-Windows neste arquivo.
// ============================================================================
//
// O QUE FAZ: localiza via CDP o botão "Adicionar foto/video" (ou "Add
// photo") na página do story composer e devolve as coordenadas de viewport
// (vpX, vpY) do CENTRO do botão, como uma linha JSON no stdout (ou "null" se
// não achar). Não clica em nada — só descobre ONDE clicar.
//
// POR QUE EXISTE: a posição do botão muda dependendo do estado da página
// (ex.: se já tem alguma mídia carregada, se o layout mudou), então
// coordenadas de tela fixas quebram com frequência. Este script resolve
// a posição on-demand, lendo o DOM real a cada chamada.
//
// CHAMADO POR: postar_story.ps1 (ver postar_story.ps1) — o PowerShell
// recebe o JSON e soma um offset fixo (+87px) pra converter de coordenada
// de viewport (dentro da página) para coordenada de tela (incluindo a barra
// de título/abas do Chrome), porque o clique final é feito via SO
// (mouse_event), não via CDP.
//
// Uso: node find_btn_midia.js   (sem argumentos)

const http = require('http');
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Mesmo critério de seleção de aba dos outros scripts do fluxo de story:
// precisa ser business.facebook.com e NUNCA a aba do canal de broadcast.
const CANAL_ID = '10081057791909389';

async function main() {
  const tabs = await httpGet('http://localhost:9222/json');
  const tab = tabs.find(t => t.type === 'page' && t.url && /business\.facebook\.com/i.test(t.url) && !t.url.includes(CANAL_ID));
  if (!tab) { process.stdout.write('null\n'); return; } // sem aba valida -> "null", quem chama trata como "nao encontrado" e usa fallback

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', e => rej(e), { once: true });
  });
  let _id = 0; const _p = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.id !== undefined && _p.has(m.id)) { _p.get(m.id)(m); _p.delete(m.id); }
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++_id;
      const t = setTimeout(() => { _p.delete(id); reject(new Error('timeout')); }, 8000);
      _p.set(id, m => { clearTimeout(t); resolve(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  // Busca no DOM por qualquer button/[role=button] cujo texto/aria-label
  // bata com "Adicionar foto" (PT) ou "Add photo" (EN), visível na tela
  // (width/height > 0). Retorna o centro do bounding box.
  const r = await cdp('Runtime.evaluate', { expression: `(function(){
    const els = document.querySelectorAll('button,[role="button"]');
    for (const el of els) {
      const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim();
      if (/Adicionar foto|Add photo/i.test(txt)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return JSON.stringify({vpX:Math.round(r.left+r.width/2),vpY:Math.round(r.top+r.height/2)});
      }
    }
    return null;
  })()` });
  const val = r.result && r.result.result && r.result.result.value;
  process.stdout.write((val || 'null') + '\n');
  ws.close();
}
main().catch(() => process.stdout.write('null\n')); // qualquer erro -> "null", nunca deixa o PowerShell sem resposta
