'use strict';
// ============================================================================
// CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\link_e_compartilhar.js
// Varredura de segredos: 0 ocorrências de token/senha/cookie/api-key/secret/
// chat_id/IP/caminho-com-usuário-Windows neste arquivo.
// ============================================================================
//
// O QUE FAZ (última etapa do fluxo de story): com o story já carregado no
// composer (imagem já selecionada pelo postar_story.ps1), este script:
//   1. Clica "Adicionar link" (se foi passada uma URL de notícia)
//   2. Preenche o campo de URL do link sticker
//   3. Clica "Aplicar" e CONFIRMA de verdade que o sticker foi aplicado
//   4. Clica "Compartilhar" para publicar o story
// Tudo via CDP (Input.dispatchMouseEvent / Runtime.evaluate) — não usa
// cliques de SO nem Playwright.
//
// CHAMADO POR: postar_story.ps1 (ver postar_story.ps1), como ÚLTIMO passo,
// depois do dialog de upload de arquivo já ter sido resolvido via UI
// Automation do Windows.
//
// Uso: node link_e_compartilhar.js [urlNoticia]
// Se urlNoticia for omitida, pula os passos 1-3 e só clica "Compartilhar".

const http = require('http');

const [,, urlNoticia] = process.argv;

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
  const tabs = await httpGet('http://localhost:9222/json');
  const tab = tabs.find(t => t.type === 'page' && t.url && /business\.facebook\.com/i.test(t.url) && !t.url.includes(CANAL_ID));
  if (!tab) throw new Error('Aba do Meta Business Suite (business.facebook.com) nao encontrada');
  if (tab.url.includes(CANAL_ID)) throw new Error('BUG DE SEGURANCA: aba selecionada e a do canal do Instagram - abortando');
  process.stdout.write(`Usando aba ID=${tab.id} URL=${tab.url}\n`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', e => rej(new Error('WS: ' + e.message)), { once: true });
  });

  let _id = 0;
  const _pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id !== undefined && _pending.has(msg.id)) {
      _pending.get(msg.id)(msg);
      _pending.delete(msg.id);
    }
  });

  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++_id;
      const t = setTimeout(() => { _pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      _pending.set(id, msg => { clearTimeout(t); resolve(msg); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await cdp('Runtime.enable');

  // Calcula a altura da "moldura" do Chrome (barra de titulo + abas) a partir
  // da diferenca entre a resolucao real da tela (window.screen.height) e a
  // altura util da pagina (window.innerHeight). Usado só para logar a
  // coordenada equivalente em tela (debug) — o clique em si é todo via CDP
  // em coordenada de viewport, não depende desse cálculo.
  const vmRes = await cdp('Runtime.evaluate', {
    expression: 'JSON.stringify({ih:window.innerHeight,sh:window.screen.height})'
  });
  const vm = JSON.parse(vmRes.result.result.value);
  const chromeUIH = vm.sh - vm.ih - 40;
  process.stdout.write(`ChromeUIH=${chromeUIH}px\n`);

  // Clique sintético via CDP — injeta o evento direto no renderer da aba,
  // não é um clique de verdade do SO (diferente do que postar_story.ps1 faz
  // para o botão de mídia e o dialog de upload, que SÃO cliques reais).
  async function cdpClick(vpX, vpY) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vpX, y: vpY, button: 'none', clickCount: 0 });
    await sleep(150);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: vpX, y: vpY, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(100);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vpX, y: vpY, button: 'left', buttons: 0, clickCount: 1 });
  }

  // Localiza um button/[role=button]/[role=menuitem] cujo texto bata
  // EXATAMENTE (ignorando espaços extras) com o padrão regex dado.
  async function findButton(pattern) {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function(pat) {
        const re = new RegExp('^\\s*(?:' + pat + ')\\s*$', 'i');
        const els = document.querySelectorAll('button,[role="button"],[role="menuitem"]');
        for (const el of els) {
          const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim();
          if (re.test(txt)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight)
              return JSON.stringify({vpX: Math.round(r.left+r.width/2), vpY: Math.round(r.top+r.height/2), txt: txt.slice(0,60)});
          }
        }
        return null;
      })(${JSON.stringify(pattern)})`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return null;
    return JSON.parse(res.result.result.value);
  }

  // Lista todos os botões visíveis — usado só para diagnóstico quando algo
  // esperado não é encontrado (aparece nos logs pra facilitar debug manual).
  async function dumpButtons() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function(){
        const out=[];
        document.querySelectorAll('button,[role="button"],[role="menuitem"]').forEach(el=>{
          const r=el.getBoundingClientRect();
          if(r.width>0&&r.height>0&&r.top>=0&&r.top<window.innerHeight){
            const txt=(el.getAttribute('aria-label')||el.textContent||'').replace(/\\s+/g,' ').trim();
            out.push('BTN|'+Math.round(r.left+r.width/2)+'|'+Math.round(r.top+r.height/2)+'|'+txt.slice(0,60));
          }
        });
        return JSON.stringify(out);
      })()`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return;
    const items = JSON.parse(res.result.result.value);
    items.forEach(i => process.stdout.write('  ' + i + '\n'));
  }

  // Procura o campo de texto do link sticker, tentando seletores mais
  // específicos primeiro (input[type=url], placeholder com "link"/"url"/
  // "http") e só caindo para "qualquer <input> grande visível" por último.
  async function findUrlInput() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const sels = ['input[type="url"]','input[placeholder*="url" i]','input[placeholder*="link" i]','input[placeholder*="http" i]','input[type="text"]'];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 0 && r.top > 0 && r.top < window.innerHeight)
              return JSON.stringify({vpX: Math.round(r.left+r.width/2), vpY: Math.round(r.top+r.height/2), placeholder: el.placeholder, type: el.type});
          }
        }
        for (const el of document.querySelectorAll('input')) {
          const r = el.getBoundingClientRect();
          if (r.width > 100 && r.height > 0 && r.top > 0 && r.top < window.innerHeight)
            return JSON.stringify({vpX: Math.round(r.left+r.width/2), vpY: Math.round(r.top+r.height/2), placeholder: el.placeholder, type: el.type});
        }
        return null;
      })()`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return null;
    return JSON.parse(res.result.result.value);
  }

  // Preenche o <input> usando o setter nativo do React (não
  // "value = x" direto, que o React ignora) e dispara os eventos
  // 'input'/'change' que o React escuta para atualizar seu estado interno.
  async function fillInput(urlValue) {
    await cdp('Runtime.evaluate', { expression: `window.__fillUrl = ${JSON.stringify(urlValue)};` });
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const sels = ['input[type="url"]','input[placeholder*="url" i]','input[placeholder*="link" i]','input[placeholder*="http" i]','input[type="text"]'];
        let el = null;
        for (const sel of sels) {
          el = document.querySelector(sel);
          if (el) { const r = el.getBoundingClientRect(); if (r.width > 50 && r.top > 0) break; el = null; }
        }
        if (!el) {
          for (const inp of document.querySelectorAll('input')) {
            const r = inp.getBoundingClientRect();
            if (r.width > 100 && r.top > 0 && r.top < window.innerHeight) { el = inp; break; }
          }
        }
        if (!el) return 'not-found';
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, window.__fillUrl);
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        return 'filled:' + (el.placeholder || el.type);
      })()`,
      userGesture: true
    });
    return res.result?.result?.value || 'unknown';
  }

  // Verifica se o link sticker FOI REALMENTE aplicado. Importante: a
  // verificação NUNCA usa "o botão Adicionar link desapareceu" como sinal
  // de sucesso sozinho — isso daria falso positivo (DOM lento, página ainda
  // carregando, mudança de UI do Meta) e o story saíria sem o link,
  // silenciosamente. Só conta como sucesso se encontrar um sinal POSITIVO
  // real: o botão virou "Editar link" OU um elemento de sticker de link
  // apareceu no DOM.
  async function verificarLinkAplicado() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const allBtns = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"]'));
        const btnAdicionar = allBtns.find(el => {
          const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim();
          return /^\\s*(adicionar link|add link)\\s*$/i.test(txt);
        });
        const btnEditar = allBtns.find(el => {
          const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim();
          return /editar link|edit link|alterar link|change link/i.test(txt);
        });
        const stickerEl = document.querySelector('[aria-label*="link sticker" i],[data-testid*="link-sticker" i],[aria-label="Link sticker" i]');
        return JSON.stringify({
          btnAdicionarExiste: !!btnAdicionar,
          btnEditarExiste: !!btnEditar,
          stickerElExiste: !!stickerEl
        });
      })()`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return false;
    const r = JSON.parse(res.result.result.value);
    process.stdout.write('Verificacao link: ' + JSON.stringify(r) + '\n');
    return r.btnEditarExiste || r.stickerElExiste;
  }

  // ---------- PASSO 1-3: Adicionar link com retry e verificacao real ----------
  if (urlNoticia) {
    let linkAplicadoComSucesso = false;
    const MAX_TENTATIVAS = 3;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      process.stdout.write(`--- Tentativa ${tentativa}/${MAX_TENTATIVAS} de adicionar link ---\n`);

      process.stdout.write('Procurando botao "Adicionar link"...\n');
      const addLink = await findButton('Adicionar link|Add link');
      if (!addLink) {
        process.stdout.write('Botao "Adicionar link" nao encontrado — verificando se ja esta aplicado...\n');
        if (await verificarLinkAplicado()) {
          process.stdout.write('Link ja detectado como aplicado.\n');
          linkAplicadoComSucesso = true;
          break;
        }
        process.stdout.write(`AVISO: botao "Adicionar link" nao encontrado na tentativa ${tentativa} e link nao confirmado.${tentativa < MAX_TENTATIVAS ? ' Tentando novamente...' : ''}\n`);
        await sleep(1500);
        continue;
      }
      process.stdout.write(`Adicionar link: VP(${addLink.vpX},${addLink.vpY}) SCREEN(${addLink.vpX},${addLink.vpY + chromeUIH}) txt="${addLink.txt}"\n`);
      await cdpClick(addLink.vpX, addLink.vpY);
      process.stdout.write('Clicado! Aguardando modal (4s)...\n');
      await sleep(4000);

      process.stdout.write('Botoes visiveis apos Adicionar link:\n');
      await dumpButtons();

      // PASSO 2: Preencher URL
      process.stdout.write('Procurando campo de URL...\n');
      const inp = await findUrlInput();
      if (!inp) {
        process.stdout.write(`AVISO: Campo de URL nao encontrado na tentativa ${tentativa}.\n`);
        await sleep(1500);
        continue;
      }
      process.stdout.write(`Campo URL: VP(${inp.vpX},${inp.vpY}) placeholder="${inp.placeholder}" type=${inp.type}\n`);

      await cdpClick(inp.vpX, inp.vpY);
      await sleep(400);

      const fillResult = await fillInput(urlNoticia);
      process.stdout.write(`Preenchimento: ${fillResult}\n`);
      await sleep(1500); // tempo para o React processar o evento antes de clicar Aplicar

      // PASSO 3: Aplicar
      process.stdout.write('Procurando botao "Aplicar"...\n');
      let aplicar = await findButton('Aplicar|Apply|Concluir|Adicionar|Done|Confirmar|OK');
      if (!aplicar) {
        process.stdout.write('AVISO: Botao Aplicar nao encontrado por texto. Tentando Enter...\n');
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Return', code: 'Enter', windowsVirtualKeyCode: 13 });
        await sleep(100);
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Return', code: 'Enter', windowsVirtualKeyCode: 13 });
      } else {
        process.stdout.write(`Aplicar: VP(${aplicar.vpX},${aplicar.vpY}) txt="${aplicar.txt}"\n`);
        await cdpClick(aplicar.vpX, aplicar.vpY);
      }
      process.stdout.write('Aplicar executado! Aguardando (3s)...\n');
      await sleep(3000);

      // VERIFICACAO REAL antes de prosseguir para "Compartilhar"
      if (await verificarLinkAplicado()) {
        process.stdout.write(`Link confirmado como aplicado na tentativa ${tentativa}!\n`);
        linkAplicadoComSucesso = true;
        break;
      } else {
        process.stdout.write(`AVISO: link NAO confirmado apos tentativa ${tentativa}.${tentativa < MAX_TENTATIVAS ? ' Tentando novamente...' : ''}\n`);
        await sleep(1000);
      }
    }

    if (!linkAplicadoComSucesso) {
      throw new Error(`Link nao foi confirmado como aplicado apos ${MAX_TENTATIVAS} tentativas`);
    }
  }

  // ---------- PASSO 4: Compartilhar ----------
  process.stdout.write('Procurando botao "Compartilhar"...\n');
  // Busca exata "Compartilhar" primeiro (o botão azul final de publicar) —
  // "Compartilhar agora"/"Share now" são variantes de outro contexto de UI,
  // só usadas como fallback.
  let share = await findButton('Compartilhar');
  if (!share) {
    share = await findButton('Compartilhar agora|Share now|Publish now|Publicar agora');
  }
  if (!share) {
    process.stdout.write('Botoes visiveis no momento:\n');
    await dumpButtons();
    throw new Error('Botao "Compartilhar" nao encontrado');
  }
  process.stdout.write(`Compartilhar: VP(${share.vpX},${share.vpY}) SCREEN(${share.vpX},${share.vpY + chromeUIH}) txt="${share.txt}"\n`);
  await cdpClick(share.vpX, share.vpY);
  process.stdout.write('Compartilhar clicado! Aguardando confirmacao (5s)...\n');
  await sleep(5000);

  process.stdout.write('OK\n');
  ws.close();
  await sleep(200);
}

main().catch(e => { process.stderr.write('ERRO: ' + e.message + '\n'); process.exit(1); });
