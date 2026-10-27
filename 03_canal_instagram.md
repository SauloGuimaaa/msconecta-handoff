# Canal do Instagram — repasse técnico

Pacote de repasse (Heitor), fluxo de publicação no **canal de broadcast do
Instagram Direct** ("Saiu Agora!"). Gerado em 2026-10-26, só leitura do
servidor — nenhum arquivo de produção foi alterado, nenhum serviço foi
reiniciado, nenhum push foi feito.

**Legenda:** 🟢 FATO (confirmado lendo código/log/config no servidor) · 🟡 NÃO CONFIRMADO (inferido, não observado diretamente)

---

## 1. Qual script roda o quê, hoje

🟢 Existem **dois** fluxos de publicação distintos, acionados pelo mesmo
dispatcher Node (`servidor_publicador.js`, porta 8765, Scheduled Task
`MSConectaPublicadorPM2`):

| Endpoint | Script disparado | Linguagem/técnica |
|---|---|---|
| `POST /postar-story` | `postar_story.ps1` | PowerShell + UI Automation (cliques de mouse reais via Win32) + 2 helpers Node via CDP |
| `POST /postar-canal` | `postar_canal_instagram.js` | **Node puro via CDP** (sem Playwright, sem cliques reais) |

🟢 **O story de hoje NÃO roda `story_poster_windows.py`.** Esse script Python
é acionado por um caminho separado e antigo: `story_watcher.ps1` (Scheduled
Task `MSConectaStoryWatcher`), que fica monitorando uma pasta `pending\*.json`
e, quando acha um arquivo, chama `python story_poster_windows.py`. Essa task
**não roda desde 08/06/2026** (mais de 4 meses sem execução registrada) —
tudo indica que foi substituída pelo fluxo atual (`postar_story.ps1` via
`/postar-story`), que é bem mais recente (última modificação em 14/09/2026,
contra 24/05/2026 do script Python).

🟡 Não confirmado: não encontrei um commit/changelog explícito dizendo
"paramos de usar story_poster_windows.py" — essa conclusão é inferida das
datas de execução/modificação, não de uma declaração no código.

🟢 **O canal (objeto deste repasse) roda só código Node** (`postar_canal_instagram.js`),
chamado pelo dispatcher via `spawn('node.exe', ...)`. Não usa Python, não usa
Playwright (apesar de haver um `playwright_cms/` instalado no servidor — ele
não é referenciado em nenhum dos dois scripts de publicação checados).

### Horário agendado: sim, o PC aceita

🟢 O Windows Task Scheduler no servidor já tem tasks do tipo
`MSFT_TaskTimeTrigger` configuradas e funcionando (ex.: `MSConectaListener`,
`PostarStory1`, `StartRender`) — ou seja, agendar por horário fixo é
suportado nativamente, sem necessidade de software adicional.

🟡 Na prática hoje, porém, o disparo real de `/postar-canal` e `/postar-story`
não vem de uma task por horário local: vem de chamadas HTTP de um dispatcher
externo (a VPS) para o servidor na porta 8765, aparentemente nos horários que
a VPS decide. Isso não foi verificado lendo o código do lado da VPS (fora do
escopo deste acesso) — é inferência a partir dos logs (`Postando no canal:`
aparece em intervalos irregulares ao longo do dia, não em horários fixos
redondos).

---

## 2. Fluxo passo a passo (`postar_canal_instagram.js`)

🟢 Confirmado lendo o código-fonte linha a linha:

1. **Entrada**: `node postar_canal_instagram.js <urlNoticia>` — recebe só a
   URL da notícia como argumento.
2. **Localizar aba do canal**: consulta `GET http://localhost:9222/json`
   (lista de abas do Chrome via CDP) e procura uma aba cuja URL contenha o id
   fixo do canal (`CANAL_ID = '10081057791909389'`).
   - Se não achar, cria uma aba nova e dedicada via `PUT /json/new?<url>`.
   - **Nunca** reaproveita "qualquer aba instagram.com" genérica — proteção
     explícita no código contra roubar a aba do fluxo de story.
3. **Conectar via WebSocket** na aba encontrada/criada e mandar
   `Runtime.enable` com timeout curto (6s se a aba já existia, 15s se é
   nova) — serve só para detectar se o *renderer* daquela aba está vivo.
   - Se a aba existente não responder (renderer travado — já aconteceu em
     produção, ver comentário no código datado de 2026-08-30), fecha a aba e
     cria uma de recuperação.
4. **Navegar** (só se a aba for nova/recriada) até a URL do canal e esperar
   5s fixos de carregamento (não é uma espera condicional por elemento).
5. **Localizar o campo de mensagem**: seletor CSS
   `[contenteditable="true"][aria-placeholder]` (editor tipo Lexical do
   Instagram), validando que o elemento está visível (`width/height > 0`,
   `offsetParent != null`).
6. **Clicar e digitar**: clique sintético via CDP
   (`Input.dispatchMouseEvent`) no centro do campo, depois
   `Input.insertText` com a URL da notícia. Espera 2,5s para o Instagram
   gerar o preview do link automaticamente.
7. **Localizar e clicar "Enviar"**: seletor por `aria-label="Enviar"/"Send"`.
   Se não achar o botão, cai para fallback de apertar Enter via
   `Input.dispatchKeyEvent`.
8. **Confirmar envio**: espera 2s e lê o texto atual do campo
   (`el.innerText`). Se voltou vazio, considera enviado com sucesso.
9. **Retry**: repete os passos 5-8 até **3 tentativas** antes de desistir.
10. **Saída**: sempre imprime uma linha JSON `{ok: true|false, erro?: ...}`
    no stdout; exit code 0 em sucesso, 1 em falha.

### Seletores usados (todos por atributo, não por texto/posição fixa)

- Campo de mensagem: `[contenteditable="true"][aria-placeholder]`
- Botão enviar: `div[aria-label="Enviar"], div[aria-label="Send"], button[aria-label="Enviar"], button[aria-label="Send"]`

🟢 Os dois seletores cobrem PT-BR e EN explicitamente — então troca de idioma
da conta não deveria quebrar a automação. 🟡 Não confirmado: não testei com a
conta em outro idioma além do atual.

### Esperas (timing) usadas no código

| Momento | Espera |
|---|---|
| Após navegar para aba nova | 5.000 ms fixo |
| Após clicar no campo, antes de digitar | 300 ms |
| Após digitar URL, antes de procurar botão Enviar | 2.500 ms (geração do preview) |
| Após enviar, antes de confirmar | 2.000 ms |
| Entre tentativas de retry (campo não encontrado) | 1.500 ms |
| Entre tentativas de retry (envio não confirmado) | 1.000 ms |
| Timeout do `Runtime.enable` (aba existente / aba nova) | 6.000 ms / 15.000 ms |
| Timeout do CDP (`cdp()` genérico) | 15.000 ms por chamada |
| Timeout do processo (dispatcher Node, `spawn`) | 60.000 ms |

---

## 3. Tratamento de erro

🟢 **Dentro do script** (`postar_canal_instagram.js`):
- Aba travada → fecha e recria (1 nível de recuperação automática).
- Campo/botão não encontrado → retry (até 3x no total).
- Qualquer exceção não tratada → `catch` final captura, imprime
  `{ok: false, erro: "..."}` no stdout e `ERRO: ...` no stderr, `exit(1)`.

🟢 **No dispatcher** (`servidor_publicador.js`, handler `/postar-canal`):
- `exit code 0` → responde `200 {ok: true}` para quem chamou (a VPS).
- `exit code != 0` → grava log completo (stdout+stderr) em
  `C:\MSConecta\logs\postar_canal.log` **e dispara alerta via Telegram**
  (texto fixo: "falha ao postar no canal do Instagram - noticia NAO
  publicada no canal").
- Erro ao nem conseguir iniciar o processo Node → mesmo alerta Telegram,
  resposta HTTP 500.
- **Diferente do fluxo de story**: o canal não tem lógica de "corrida entre
  disparos duplicados da VPS" — todo `exit != 0` aqui é tratado como falha
  real (no story, por comparação, há um marcador em disco pra suprimir
  alarme falso quando dois disparos concorrentes disputam o mesmo Chrome).

🟡 Não confirmado: não há callback/webhook do Instagram confirmando que a
mensagem chegou de fato no canal — a "confirmação" é 100% heurística (campo
de texto ficou vazio). Se o Instagram aceitar o clique mas falhar
silenciosamente depois (ex.: removido por moderação automática), o script
não teria como saber e reportaria sucesso.

### O que fazer se o canal não aceitar o post

1. Checar `C:\MSConecta\logs\postar_canal.log` pela entrada mais recente —
   tem stdout+stderr completos do processo.
2. Erros já vistos no log histórico (todos técnicos, nenhum indício de
   bloqueio/checkpoint do Instagram — ver seção 5):
   - `Nenhuma aba do Instagram encontrada` → Chrome do CDP (porta 9222) não
     está rodando ou não tem nenhuma aba instagram.com aberta.
   - `CDP timeout: Runtime.enable` / `CDP timeout: Runtime.evaluate` →
     renderer da aba travado; o próprio script já tenta recriar a aba uma vez,
     mas se insistir, reiniciar o Chrome manualmente resolve.
   - `Unexpected token 'U', "Using unsa"... is not valid JSON` → incompatibilidade
     de verbo HTTP numa versão de Chrome mais nova (já corrigido no código
     atual usando PUT em vez de GET pra `/json/new`; se reaparecer, é sinal
     de outra mudança de versão do Chrome quebrando a mesma API).
3. Se o log mostrar `exit=0` mas a mensagem não aparece de fato no Instagram
   → suspeitar de moderação/bloqueio do lado do Instagram (não visto até
   agora, ver seção 5) — nesse caso verificar manualmente a conta e a aba do
   canal no Chrome do servidor.
4. Alerta Telegram já dispara automaticamente em qualquer falha real — não é
   necessário polling manual do log para saber que algo falhou.

---

## 4. Medições (servidor, dados reais de log)

🟢 Calculado a partir de `C:\MSConecta\logs\publicador.log` (timestamps de
início "Postando no canal" até o "exit" do processo filho):

| Métrica (canal) | Valor |
|---|---|
| Amostras medidas | 246 execuções |
| Duração média | **16,2 s** |
| Duração mínima / máxima | 6,0 s / 79,4 s |
| Falhas (`exit != 0`) | 2 de 246 (≈0,8%) |
| Volume por dia (últimos dias completos) | 14 a 41 posts/dia |

🟢 Para contexto, o mesmo cálculo para **story** (não é o foco deste repasse,
mas ajuda a calibrar expectativa de robustez):

| Métrica (story) | Valor |
|---|---|
| Amostras medidas | 267 execuções |
| Duração média | 54,5 s |
| Falhas (`exit != 0`) no log bruto | 71 de 267 (≈27%) |
| Volume por dia (últimos dias completos) | 42 a 122 posts/dia |

🟡 Não confirmado: a taxa de falha de 27% do story é quase certamente
**inflada por falso-positivo** — o próprio código de `postar_story.ps1`
documenta que a VPS às vezes dispara `/postar-story` em duplicata para a
mesma notícia, e o "perdedor" da corrida reporta falha mesmo quando a outra
cópia já publicou com sucesso (há inclusive um marcador em disco pra
suprimir o alerta Telegram nesse caso). Não medi quantas das 71 falhas brutas
são corrida-perdida vs. falha real — ficaria pra uma próxima investigação se
o foco for o fluxo de story.

### Versões e volume sem bloqueio

🟢 **Chrome**: 155.0.8059.85 (instalado em `C:\Program Files\Google\Chrome`).
🟢 **Node**: v22.15.0.
🟢 **Playwright-core** instalado no servidor: 1.59.1 (pasta
`playwright_cms\node_modules\`) — 🟡 não confirmado que seja usado em
produção pelo fluxo de canal/story; não encontrei nenhuma referência a
Playwright dentro de `postar_canal_instagram.js` nem `postar_story.ps1` (os
dois falam direto com CDP via `http`/`WebSocket` nativos do Node, sem lib).

🟢 **Volume histórico sem bloqueio detectado**: o log completo
`postar_canal.log` (desde 2026-08-04) tem **2.052 posts com sucesso
(`exit=0`) e só 93 com falha (`exit != 0`)** em ~3 meses — e nenhuma dessas
falhas, nem em busca por palavras-chave (checkpoint/bloqueado/blocked/rate
limit/challenge/suspend/banned/restricted) no log inteiro, corresponde a um
bloqueio real do Instagram — todas as 7 ocorrências da busca por essas
palavras são falsos positivos (URLs de notícias que contêm a palavra
"suspende" no título, ex. "câmara suspende..."), todas com `exit=0`. **Ou
seja: desde que há registro, não há nenhum indício de bloqueio/checkpoint do
Instagram no canal.**

---

## 5. Observações de segurança para o Heitor

- Os caminhos `C:\MSConecta\chrome-cms-agent` e `C:\MSConecta\chrome_cdp2`
  são **perfis de navegador** usados pela automação — não foram abertos nem
  copiados para este pacote, por instrução explícita deste repasse.
- Existe um arquivo `instagram_cookies.txt` na raiz de `C:\MSConecta` — não
  foi aberto nem lido para a produção deste material.
- Token/chat id do Telegram usado para alertas são lidos **somente** de
  variáveis de ambiente (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) no
  processo do dispatcher — não existem hardcoded em nenhum arquivo lido.
- Um caminho com o usuário Windows do servidor (parâmetro default de
  `postar_story.ps1`) foi mascarado para `<PC_USER>` nas cópias deste pacote.

## Arquivos deste pacote

- `postar_canal_instagram.js` — script principal do canal (sanitizado, 0 segredos encontrados).
- `servidor_publicador_dispatcher.js` — excerpt do dispatcher Node (só rotas `/postar-story` e `/postar-canal`).
- postar_story.ps1 — script de story atualmente ativo, como contexto comparativo (1 caminho mascarado).
- `03_canal_instagram.md` — este documento.

---

## 6. Idempotência e duplicidade no canal (adendo)

🟢 O canal **não tem flag de idempotência** na VPS (`CANAIS_IDEMPOTENTES` só tem story/threads/facebook). Mesmo assim, não duplica: `postar_link_canal_instagram` é disparado **uma única vez**, só se `feed_ok and not ja_publicado_feed and noticia_url`, com 1 chamada `requests.post` (70 s, sem retry). O timeout do Node (60 s) é menor que o da VPS (70 s), então não há reenvio por timeout, ao contrário do story (ver `02_story_link_sticker.md`, seção 9).
🟡 Risco residual: `ja_publicado_feed` depende de a API confirmar o feed; se a VPS reiniciar entre publicar o feed e disparar a thread, o link do canal se perde (a thread é `daemon`, com `join(75)`).
