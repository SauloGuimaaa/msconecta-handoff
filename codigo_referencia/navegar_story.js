'use strict';
// ============================================================================
// CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\navegar_story.js
// Varredura de segredos: 0 ocorrências de token/senha/cookie/api-key/secret/
// chat_id/IP/caminho-com-usuário-Windows neste arquivo. Nada precisou ser
// mascarado.
// ============================================================================
//
// O QUE FAZ: navega a aba do Chrome que já está logada no Meta Business
// Suite até a URL do "story composer", usando CDP (não Playwright, não
// clique de teclado — exceto como ÚLTIMO fallback).
//
// CHAMADO POR: postar_story.ps1 (ver postar_story.ps1), antes de clicar em
// qualquer coisa na tela.
//
// Uso: node navegar_story.js <url>

const http = require('http');

const [,, targetUrl] = process.argv;
if (!targetUrl) { process.stderr.write('Uso: node navegar_story.js <url>\n'); process.exit(1); }

// Aba do canal de broadcast do Instagram - NUNCA deve ser tocada por esta automacao de story
const CANAL_ID = '10081057791909389';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Passo 1: escolher a aba certa. Critério duplo e explícito: tem que ser
  // business.facebook.com E não pode conter o ID do canal do Instagram.
  // Isso existe porque já aconteceu em produção desta automação navegar POR
  // CIMA da aba do canal (que é usada por outra automação concorrente) —
  // ver comentário "BUG DE SEGURANCA" abaixo, que aborta em vez de arriscar.
  const tabs = await httpGet('http://localhost:9222/json');
  const tab = tabs.find(t => t.type === 'page' && t.url && /business\.facebook\.com/i.test(t.url) && !t.url.includes(CANAL_ID));
  if (!tab) throw new Error('Aba do Meta Business Suite (business.facebook.com) nao encontrada - abortando em vez de usar uma aba generica/ambigua');
  if (tab.url.includes(CANAL_ID)) throw new Error('BUG DE SEGURANCA: aba selecionada e a do canal do Instagram - abortando para nao sobrescreve-la');
  process.stdout.write(`Usando aba ID=${tab.id} URL=${tab.url}\n`);

  // Passo 2: abrir WebSocket de debug da aba escolhida.
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', e => rej(new Error('WS: ' + e.message)), { once: true });
  });

  let _id = 0;
  const _pending = new Map();
  let _eventHandlers = [];

  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id !== undefined && _pending.has(msg.id)) {
      _pending.get(msg.id)(msg);
      _pending.delete(msg.id);
    } else if (msg.method) {
      // Mensagens sem "id" são EVENTOS do CDP (não respostas a comandos) —
      // despachadas para quem registrou handler via _eventHandlers.
      _eventHandlers.forEach(h => { try { h(msg); } catch (_) {} });
    }
  });

  function cdp(method, params = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const id = ++_id;
      const t = setTimeout(() => { _pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
      _pending.set(id, msg => { clearTimeout(t); resolve(msg); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Passo 3: habilitar o domínio Page e registrar um handler que ACEITA
  // automaticamente qualquer dialog de "beforeunload" ("Sair do site?") que
  // o navegador mostraria ao sair da página do Business Suite — sem isso, a
  // navegação ficaria travada esperando um clique humano que nunca vem.
  try {
    await cdp('Page.enable', {}, 5000);
    _eventHandlers.push(async (msg) => {
      if (msg.method === 'Page.javascriptDialogOpening') {
        process.stdout.write(`Dialog: type=${msg.params.type} msg="${(msg.params.message || '').slice(0, 50)}"\n`);
        try {
          await cdp('Page.handleJavaScriptDialog', { accept: true }, 5000);
          process.stdout.write('Dialog aceito.\n');
        } catch (e) {
          process.stdout.write('Erro ao aceitar dialog: ' + e.message + '\n');
        }
      }
    });
  } catch (e) {
    process.stdout.write('AVISO: Page.enable falhou (' + e.message + ') - continuando sem interceptar dialogo.\n');
  }

  process.stdout.write(`Navegando para: ${targetUrl.slice(0, 80)}\n`);

  // Passo 4: navegar via CDP (Page.navigate). Se falhar, fallback via JS
  // (window.location.href) — ainda sem tocar teclado/mouse do SO.
  let navOk = false;
  try {
    const navResult = await cdp('Page.navigate', { url: targetUrl }, 10000);
    if (navResult.result && navResult.result.errorText) {
      process.stdout.write('Aviso navegacao: ' + navResult.result.errorText + '\n');
    } else {
      navOk = true;
    }
  } catch (e) {
    process.stdout.write('Aviso Page.navigate: ' + e.message + '\n');
  }

  if (!navOk) {
    process.stdout.write('Fallback: navegando via Runtime.evaluate...\n');
    try {
      await cdp('Runtime.evaluate', {
        expression: `window.location.href = ${JSON.stringify(targetUrl)};`,
        userGesture: true
      }, 5000);
    } catch (e) {
      process.stdout.write('Aviso Runtime.evaluate: ' + e.message + '\n');
    }
  }

  // Espera fixa de carregamento (não condicional) — 20s cobre o pior caso
  // observado de carregamento do Business Suite.
  process.stdout.write('Aguardando carregamento (20s)...\n');
  await sleep(20000);

  process.stdout.write('OK\n');
  ws.close();
  await sleep(200);
}

main().catch(e => { process.stderr.write('ERRO: ' + e.message + '\n'); process.exit(1); });
