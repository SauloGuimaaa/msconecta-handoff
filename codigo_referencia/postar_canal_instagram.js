'use strict';
// ============================================================================
// CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\postar_canal_instagram.js
// Varredura de segredos: 0 ocorrências de token/senha/cookie/api-key/secret/chat_id
// neste arquivo (confirmado via grep antes de copiar). Nenhum dado sensível
// precisou ser mascarado aqui.
// ============================================================================
//
// O QUE FAZ: posta o link de uma noticia no canal de broadcast "Saiu Agora!"
// do Instagram Direct (um "canal" do Instagram = grupo de broadcast, não é
// story nem feed). Digita a URL no campo de mensagem do chat do canal; o
// Instagram gera o preview do link automaticamente. Depois clica "Enviar".
//
// COMO É CHAMADO: node postar_canal_instagram.js <urlNoticia>
// Quem chama: servidor_publicador.js, no handler POST /postar-canal
// (ver servidor_publicador_dispatcher.js neste mesmo pacote).
//
// TRANSPORTE: CDP (Chrome DevTools Protocol) puro via HTTP+WebSocket — NÃO
// usa Playwright. Depende de um Chrome já aberto com
// --remote-debugging-port=9222 (porta fixa, ver CANAL_ID/CANAL_URL abaixo).

const http = require('http');

const [,, urlNoticia] = process.argv;
const CANAL_ID = '10081057791909389'; // id do thread do canal de broadcast no Instagram Direct
const CANAL_URL = `https://www.instagram.com/direct/t/${CANAL_ID}/`;

if (!urlNoticia) {
  process.stderr.write('ERRO: URL da noticia nao informada. Uso: node postar_canal_instagram.js <urlNoticia>\n');
  process.exit(1);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Chrome >= ~152 passou a exigir o verbo PUT para /json/new (antes aceitava GET).
// Ver: resposta 405 "Using unsafe HTTP verb GET to invoke /json/new. This action supports only PUT verb."
function httpPut(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Conecta via CDP a uma aba e tenta Runtime.enable com timeout curto, so para
// diagnosticar se o RENDERER daquela aba ainda responde. Um Chrome vivo (processo
// browser) pode ter uma aba com renderer travado/morto - o WS abre normal e
// comandos de nivel "target" (ex: Target.getTargetInfo) respondem, mas qualquer
// coisa que dependa de JS (Runtime.*, Page.*) trava para sempre. Isso ja aconteceu
// de verdade: aba do canal ficou travada desde 2026-08-30 e toda automacao
// subsequente bateu na mesma aba morta, sempre com o mesmo timeout.
async function tentarConectar(tab, timeoutMs) {
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

  function cdp(method, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++_id;
      const t = setTimeout(() => { _pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeout);
      _pending.set(id, msg => { clearTimeout(t); resolve(msg); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await cdp('Runtime.enable', {}, timeoutMs);
  return { ws, cdp };
}

async function main() {
  // Passo 1: localizar (ou criar) a aba do Chrome que já está no canal correto.
  // NUNCA reusa "qualquer aba instagram.com" genérica — isso poderia roubar a
  // aba de outra automação (ex: o fluxo de story usa o mesmo Chrome/CDP).
  const tabs = await httpGet('http://localhost:9222/json');
  let tab = tabs.find(t => t.type === 'page' && t.url && t.url.includes(CANAL_ID));
  let precisaNavegar = false;

  if (!tab) {
    process.stdout.write(`AVISO: aba do canal (contendo ${CANAL_ID}) nao encontrada. Criando aba dedicada...\n`);
    tab = await httpPut(`http://localhost:9222/json/new?${encodeURIComponent(CANAL_URL)}`);
    if (!tab || !tab.id) throw new Error('Falha ao criar aba dedicada para o canal via /json/new');
    precisaNavegar = true; // aba nova precisa do tempo de carregamento antes de interagir
  }
  if (!tab) throw new Error('Nenhuma aba do canal do Instagram disponivel');
  process.stdout.write(`Usando aba ID=${tab.id} URL=${tab.url}\n`);

  // Passo 2: conectar no WebSocket de debug da aba. Se a aba existente estiver
  // com o renderer morto (sintoma real já visto em produção), fecha e recria.
  let ws, cdp;
  try {
    ({ ws, cdp } = await tentarConectar(tab, precisaNavegar ? 15000 : 6000));
  } catch (e) {
    if (precisaNavegar) throw e; // aba recem-criada e ja falhou - nao ha mais fallback
    process.stdout.write(`AVISO: aba existente do canal nao respondeu (${e.message}) - provavel renderer travado. Fechando e recriando...\n`);
    try { await httpGet(`http://localhost:9222/json/close/${tab.id}`); } catch (_) {}
    tab = await httpPut(`http://localhost:9222/json/new?${encodeURIComponent(CANAL_URL)}`);
    if (!tab || !tab.id) throw new Error('Falha ao criar aba de recuperacao para o canal via /json/new');
    precisaNavegar = true;
    process.stdout.write(`Aba de recuperacao criada: ID=${tab.id}\n`);
    ({ ws, cdp } = await tentarConectar(tab, 15000));
  }

  await cdp('Page.enable');

  if (precisaNavegar) {
    process.stdout.write(`Aba do canal nao estava aberta/saudavel. Navegando ate ${CANAL_URL}...\n`);
    await cdp('Page.navigate', { url: CANAL_URL });
    await sleep(5000); // tempo fixo de carregamento da página, sem espera condicional por elemento
  } else {
    process.stdout.write('Aba do canal ja estava aberta e saudavel.\n');
  }

  // Clique sintético via CDP (Input.dispatchMouseEvent) em coordenadas de viewport —
  // não é um clique de verdade do SO, é injetado direto no renderer da aba.
  async function cdpClick(vpX, vpY) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vpX, y: vpY, button: 'none', clickCount: 0 });
    await sleep(150);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: vpX, y: vpY, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(100);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vpX, y: vpY, button: 'left', buttons: 0, clickCount: 1 });
  }

  // Campo de mensagem: div contenteditable (editor Lexical) com aria-placeholder="Mensagem..."
  // Seletor por atributo, não por texto fixo — sobrevive à troca de idioma da conta.
  async function findCampoMensagem() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"][aria-placeholder]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || el.offsetParent === null) return null;
        return JSON.stringify({vpX: Math.round(r.left + r.width/2), vpY: Math.round(r.top + r.height/2)});
      })()`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return null;
    return JSON.parse(res.result.result.value);
  }

  // Botao "Enviar"/"Send": so aparece depois que ha texto no campo
  async function findBotaoEnviar() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('div[aria-label="Enviar"], div[aria-label="Send"], button[aria-label="Enviar"], button[aria-label="Send"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || el.offsetParent === null) return null;
        return JSON.stringify({vpX: Math.round(r.left + r.width/2), vpY: Math.round(r.top + r.height/2)});
      })()`
    });
    if (!res.result || !res.result.result || !res.result.result.value) return null;
    return JSON.parse(res.result.result.value);
  }

  // Usado só para CONFIRMAR o envio: o campo volta a ficar vazio quando a
  // mensagem efetivamente sai. Não há callback/webhook do Instagram — a
  // confirmação é inteiramente heurística (ver seção "Tratamento de erro" no .md).
  async function getTextoCampo() {
    const res = await cdp('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('[contenteditable="true"][aria-placeholder]');
        return el ? el.innerText : null;
      })()`
    });
    return res.result && res.result.result ? res.result.result.value : null;
  }

  const MAX_TENTATIVAS = 3;
  let enviadoComSucesso = false;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    process.stdout.write(`--- Tentativa ${tentativa}/${MAX_TENTATIVAS} ---\n`);

    process.stdout.write('Procurando campo de mensagem...\n');
    const campo = await findCampoMensagem();
    if (!campo) {
      process.stdout.write('AVISO: campo de mensagem nao encontrado. Aguardando e tentando de novo...\n');
      await sleep(1500);
      continue;
    }
    process.stdout.write(`Campo de mensagem: VP(${campo.vpX},${campo.vpY})\n`);

    await cdpClick(campo.vpX, campo.vpY);
    await sleep(300);

    process.stdout.write('Digitando URL da noticia...\n');
    await cdp('Input.insertText', { text: urlNoticia });

    process.stdout.write('Aguardando geracao do preview (2.5s)...\n');
    await sleep(2500);

    process.stdout.write('Procurando botao "Enviar"...\n');
    let botaoEnviar = await findBotaoEnviar();
    if (!botaoEnviar) {
      process.stdout.write('AVISO: botao "Enviar" nao encontrado. Tentando Enter...\n');
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(100);
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      process.stdout.write(`Botao Enviar: VP(${botaoEnviar.vpX},${botaoEnviar.vpY})\n`);
      await cdpClick(botaoEnviar.vpX, botaoEnviar.vpY);
    }

    process.stdout.write('Enviado! Aguardando confirmacao (2s)...\n');
    await sleep(2000);

    const textoApos = await getTextoCampo();
    if (textoApos !== null && textoApos.trim() === '') {
      process.stdout.write(`Confirmado: campo voltou a ficar vazio na tentativa ${tentativa}.\n`);
      enviadoComSucesso = true;
      break;
    } else {
      process.stdout.write(`AVISO: campo nao ficou vazio apos tentativa ${tentativa} (conteudo: "${textoApos}").${tentativa < MAX_TENTATIVAS ? ' Tentando novamente...' : ''}\n`);
      await sleep(1000);
    }
  }

  if (!enviadoComSucesso) {
    throw new Error(`Envio nao foi confirmado apos ${MAX_TENTATIVAS} tentativas`);
  }

  process.stdout.write('OK\n');
  ws.close();
  await sleep(200);
}

// Contrato de saída usado pelo servidor_publicador.js: stdout sempre termina
// com uma linha JSON {ok: bool, ...}. exit code != 0 em caso de falha.
main()
  .then(() => {
    process.stdout.write(JSON.stringify({ ok: true }) + '\n');
  })
  .catch(e => {
    process.stderr.write('ERRO: ' + e.message + '\n');
    process.stdout.write(JSON.stringify({ ok: false, erro: e.message }) + '\n');
    process.exit(1);
  });
