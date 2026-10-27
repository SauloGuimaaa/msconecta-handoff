'use strict';
// ============================================================================
// EXCERPT SANITIZADO para repasse (Heitor) — fonte original: C:\MSConecta\servidor_publicador.js
// (598 linhas no total; aqui só as partes relevantes ao fluxo de STORY e CANAL
// do Instagram. O arquivo completo também expõe endpoints de busca/download
// de video via yt-dlp, fora do escopo deste repasse.)
//
// Varredura de segredos no arquivo completo: 12 ocorrências do padrão
// token|senha|cookie|api-key|secret|chat_id — TODAS são nomes de variável/env
// var (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID lidos de process.env; nunca
// hardcoded) ou nomes de caminho de banco de cookies do Chrome usado pelo
// yt-dlp (não copiado aqui, e de qualquer forma não contém o VALOR do cookie,
// só o caminho do arquivo). 1 ocorrência de caminho com o usuário Windows do
// servidor (handler /receber-story, linha do storyDir) — MASCARADA para
// <PC_USER> por regra do repasse.
// ============================================================================
//
// O QUE É: servidor HTTP na porta 8765, roda como Scheduled Task
// "MSConectaPublicadorPM2" (AtLogon, RestartCount=10). Recebe chamadas HTTP
// da VPS (dispatcher na nuvem) e dispara os scripts locais de publicação.
//
// ----------------------------------------------------------------------------
// CONTRATO HTTP esperado da VPS (nomes e formato, SEM valores/credenciais):
// ----------------------------------------------------------------------------
// Porta do dispatcher (este arquivo): 8765/TCP, todas as interfaces (0.0.0.0).
// Porta do Chrome via CDP (uso INTERNO do servidor, a VPS nunca fala com ela
// diretamente): 9222/TCP, localhost apenas.
//
// POST /receber-story
//   Headers:  X-Numero (obrigatório), X-Data (obrigatório)
//   Body:     bytes binários da imagem do story (JPEG) — NÃO é JSON
//   Resposta: { ok: boolean, arquivo?: string, erro?: string }
//
// POST /postar-story
//   Body (JSON): { numero: number|string, data: string, url?: string }
//     - numero e data OBRIGATÓRIOS; url OPCIONAL (se ausente, story sem link sticker)
//   Resposta: { ok: boolean, erro?: string, stderr?: string }
//
// POST /postar-canal
//   Body (JSON): { url: string }
//     - url OBRIGATÓRIA (a URL da notícia a postar no canal)
//   Resposta: { ok: boolean, erro?: string, stderr?: string }
//
// GET /status  (health check, sem body)
//   Resposta: { ok: boolean, uptime: number }
//
// Variáveis de ambiente que o PROCESSO do dispatcher espera (nomes, não
// valores): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — usadas só para alertas de
// falha, não fazem parte do contrato HTTP com a VPS.
// ----------------------------------------------------------------------------

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8765;

// --- Alerta Telegram: token/chat id SEMPRE via variável de ambiente, nunca
// hardcoded no código. Se as env vars não estiverem configuradas no processo,
// a função simplesmente não envia nada (loga localmente) — não é erro fatal.
function enviarAlertaTelegram(mensagem) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(`[${new Date().toISOString()}] Telegram nao configurado - alerta nao enviado: ${mensagem}`);
    return;
  }
  const body = JSON.stringify({ chat_id: chatId, text: mensagem });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 10000,
  }, res => { res.resume(); });
  req.on('error', e => console.log(`[${new Date().toISOString()}] Falha ao enviar alerta Telegram: ${e.message}`));
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

const server = http.createServer((req, res) => {

  // ---- POST /receber-story ----
  // PASSO ANTERIOR ao /postar-story: a VPS manda os BYTES da imagem do story
  // (JPEG já renderizado do lado da VPS) no corpo da requisição — não é
  // JSON, é o arquivo binário puro. Identificação da notícia vai em HEADERS
  // HTTP, não no corpo: X-Numero e X-Data (ambos obrigatórios).
  // O servidor salva o arquivo em disco e é só esse caminho em disco que o
  // /postar-story (via postar_story.ps1) depois vai procurar.
  if (req.method === 'POST' && req.url === '/receber-story') {
    const numero = req.headers['x-numero'];
    const data   = req.headers['x-data'];
    if (!numero || !data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Headers X-Numero e X-Data obrigatorios' }));
      return;
    }
    // Caminho fixo de destino: <BaseDir>\<data>\NOTICIA<numero>-STORY.jpeg
    // (mesmo padrão de nome que postar_story.ps1 espera via $FilePath).
    const storyDir  = path.join('C:\\Users\\<PC_USER>\\Desktop\\Postagens MSConecta', data);
    const storyFile = path.join(storyDir, `NOTICIA${numero}-STORY.jpeg`);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        fs.mkdirSync(storyDir, { recursive: true });
        fs.writeFileSync(storyFile, Buffer.concat(chunks));
        console.log(`[${new Date().toISOString()}] Story salvo: ${storyFile}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, arquivo: storyFile }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
    req.on('error', e => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: e.message }));
    });
    return;
  }

  // ---- POST /postar-story ----
  // Dispara postar_story.ps1 (PowerShell + UI automation, NÃO é o
  // story_poster_windows.py legado — ver postar_story.ps1 neste pacote e
  // a nota no .md sobre qual script roda "hoje" de fato).
  if (req.method === 'POST' && req.url === '/postar-story') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'JSON invalido: ' + e.message }));
        return;
      }
      const { numero, data, url } = payload;
      if (!numero || !data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Campos numero e data obrigatorios' }));
        return;
      }
      const args = [
        '-ExecutionPolicy', 'Bypass',
        '-File', 'C:\\MSConecta\\postar_story.ps1',
        '-Numero', String(numero),
        '-Data', String(data),
      ];
      if (url) args.push('-UrlNoticia', String(url));
      console.log(`[${new Date().toISOString()}] Postando story ${numero} de ${data}`);
      const proc = spawn('powershell.exe', args, { timeout: 120000, windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => {
        console.log(`[${new Date().toISOString()}] postar_story exit ${code}`);
        if (code === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, erro: `Exit ${code}`, stderr: stderr.slice(0, 500) }));
        }
      });
      proc.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Erro ao iniciar postar_story.ps1: ' + err.message }));
      });
    });
    return;
  }

  // ---- POST /postar-canal ----
  // Dispara postar_canal_instagram.js (Node puro via CDP — ver
  // postar_canal_instagram.js neste pacote). Timeout de 60s no spawn:
  // se o processo não terminar em 60s, o Node mata o processo filho.
  if (req.method === 'POST' && req.url === '/postar-canal') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'JSON invalido: ' + e.message }));
        return;
      }
      const { url } = payload;
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Campo url obrigatorio' }));
        return;
      }
      const args = ['C:\\MSConecta\\postar_canal_instagram.js', String(url)];
      console.log(`[${new Date().toISOString()}] Postando no canal: ${url}`);
      const proc = spawn('node.exe', args, { timeout: 60000, windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => {
        // Todo resultado (sucesso ou falha) é gravado em C:\MSConecta\logs\postar_canal.log
        // com stdout/stderr completos do processo filho — é o log usado para
        // medir duração/taxa de falha neste repasse.
        const logLine = `[${new Date().toISOString()}] postar_canal_instagram url=${url} exit=${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n---\n`;
        console.log(`[${new Date().toISOString()}] postar_canal_instagram exit ${code}`);
        try {
          fs.appendFileSync(path.join('C:\\MSConecta\\logs', 'postar_canal.log'), logLine);
        } catch (e) {
          console.log(`[${new Date().toISOString()}] Falha ao gravar log postar_canal.log: ${e.message}`);
        }
        if (code === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          // Falha real (não suprimida) sempre dispara alerta Telegram — diferente
          // do fluxo de story, o canal NÃO tem lógica de corrida/múltiplos
          // disparos concorrentes, então aqui todo exit != 0 é uma falha de verdade.
          enviarAlertaTelegram(`MSConecta: falha ao postar no canal do Instagram - noticia NAO publicada no canal. URL: ${url}. Erro: ${stderr.slice(0, 300) || 'exit ' + code}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, erro: `Exit ${code}`, stderr: stderr.slice(0, 500) }));
        }
      });
      proc.on('error', err => {
        const logLine = `[${new Date().toISOString()}] postar_canal_instagram url=${url} ERRO_AO_INICIAR: ${err.message}\n---\n`;
        try {
          fs.appendFileSync(path.join('C:\\MSConecta\\logs', 'postar_canal.log'), logLine);
        } catch (e) {}
        enviarAlertaTelegram(`MSConecta: falha ao INICIAR postagem no canal do Instagram. URL: ${url}. Erro: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Erro ao iniciar postar_canal_instagram.js: ' + err.message }));
      });
    });
    return;
  }

  // ... (demais rotas do arquivo completo: /status (GET, health check),
  // /publicar-noticia (publica no site, não é Instagram), busca e download
  // de video via yt-dlp — fora do escopo deste repasse, não copiadas)

});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor publicador rodando na porta ${PORT}`);
});
