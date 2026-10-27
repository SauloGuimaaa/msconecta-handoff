# Story + link sticker — repasse técnico

Complemento ao pacote de repasse (Heitor): o fluxo de **story** que faltava no
pacote anterior. Gerado em 2026-10-26 (atualizado), só leitura do servidor —
nenhum arquivo de produção foi alterado, nenhum serviço reiniciado, nenhum
push feito.

**Legenda:** 🟢 FATO (confirmado lendo código/log/config no servidor) · 🟡 NÃO CONFIRMADO (inferido, não testado/observado diretamente)

---

## 0. Nota sobre `story_poster_windows.py` — LEGADO

🟢 **`story_poster_windows.py` está LEGADO, sem uso desde 08/06/2026.** Não
foi copiado para este pacote como referência ativa (por pedido explícito).
Ele é acionado por um caminho separado (`story_watcher.ps1`, Scheduled Task
`MSConectaStoryWatcher`) que monitora uma pasta `pending\*.json` — essa task
não tem execução registrada desde 08/06/2026, mais de 4 meses atrás, e o
script `postar_story.ps1` (ativo, descrito abaixo) foi modificado por último
em 14/09/2026, bem depois. Se alguém reativar `story_watcher.ps1` por engano,
ele chamaria o Python legado em paralelo ao fluxo atual — **não recomendado**
sem antes confirmar com o Heitor se há algum motivo para isso.

---

## 1. Passo a passo da UI Automation (`postar_story.ps1`)

🟢 Confirmado lendo o código-fonte (ver postar_story.ps1 neste pacote):

1. **Validação de entrada**: recebe `-Numero`, `-Data` (obrigatórios) e
   `-UrlNoticia` (opcional — se ausente, o story sai sem link sticker).
   Monta `$FilePath = "$BaseDir\$Data\NOTICIA$Numero-STORY.jpeg"` e aborta
   (`exit 1`) se o arquivo não existir no disco.
2. **Garantir Chrome correto** (`Garantir-ChromeCorreto`): verifica, via WMI
   (`Win32_Process`), se já existe um `chrome.exe` rodando que **não** seja
   o perfil `chrome-cms-agent` — se houver, considera "perfil errado" mesmo
   que o CDP (porta 9222) esteja respondendo, porque CDP ativo com perfil
   errado = sessão errada (sem login no Meta Business Suite). Se o Chrome
   certo com CDP não estiver de pé, mata qualquer `chrome.exe` existente e
   abre um novo com `--remote-debugging-port=9222 --user-data-dir=<perfil
   cms-agent>`.
3. **Fechar abas extras** (`Fechar-AbasExtras`): via CDP, fecha qualquer aba
   que não seja Facebook/Instagram/Meta/WhatsApp/msconecta.com.br/chrome
   interno — evita que abas "lixo" confundam os scripts de localizar
   elemento.
4. **Localizar a janela do Chrome na UI do Windows** (`Find-ChromeWindow`,
   via `System.Windows.Automation`) pelo título (ex.: "Meta Business Suite -
   Google Chrome"); se não achar por título exato, faz busca ampla por
   `*Chrome*` no nome da janela.
5. **Dar foco na janela** (`SetForegroundWindow` via P/Invoke) e **navegar**
   até a URL do story composer usando o helper CDP `navegar_story.js`
   (sem cliques de SO); se esse helper falhar, cai no fallback de
   `SendKeys` (Ctrl+L, colar URL, Enter) — **este fallback, sim, depende de
   foco/janela ativa de verdade**.
6. **Checagem de sessão**: via CDP, olha a URL da aba do Meta/Facebook — se
   contiver `login` ou `checkpoint`, interpreta como sessão expirada,
   manda alerta Telegram e **aborta com `exit 2`** (único ponto que exige
   intervenção humana: login manual no Chrome do perfil `chrome-cms-agent`).
7. **Fechar dialog de upload "preso"** de uma execução anterior, se houver
   (`#32770` com título "Abrir"/"Open").
8. **Localizar o botão "Adicionar foto/vídeo"** via CDP
   (`find_btn_midia.js`, retorna coordenada de viewport) e converter para
   coordenada de **tela** somando um offset fixo (+87px, altura estimada da
   moldura do Chrome) — se o CDP não achar, usa uma lista de coordenadas de
   tela fixas como fallback (`$btnAdicionarFotoYs`, 8 valores diferentes de Y
   testados historicamente).
9. **Clicar o botão** com `mouse_event` real (Win32, não CDP) e **esperar o
   dialog nativo do Windows "Abrir arquivo"** aparecer (até 30s,
   polling a cada 300ms, ignora dialog que aparecer em menos de 500ms por
   poder ser um dialog "fantasma" de execução anterior).
10. **Preencher o caminho do arquivo** no dialog: localiza o campo de texto
    via UI Automation (`AutomationId="1148"`, ou o primeiro `Edit` encontrado
    como fallback), cola o caminho completo via **clipboard** (`Ctrl+A`,
    `Ctrl+V`) — não digita char a char — e confirma com `Enter`.
11. **Esperar 12s fixos** o preview da imagem carregar no composer.
12. **Inserir o link sticker e compartilhar**: delega tudo isso ao helper
    CDP `link_e_compartilhar.js` (detalhado na seção 2).
13. Se o helper retornar código de saída ≠ 0, dispara
    `Alertar-SeNaoPublicado` (ver seção 5) e aborta com `exit 1`. Se tudo deu
    certo, grava um marcador em disco (`tmp\story_ok\NOTICIA<n>_<data>.ok`) —
    usado só para suprimir alarme falso de processos concorrentes — e
    termina com sucesso.

### Screenshots tirados em cada execução (debug, não é parte do fluxo em si)

🟢 `Take-Screenshot` é chamado em 6 pontos fixos do script (Chrome carregado,
sessão expirada se detectada, dialog não apareceu se der erro, pós-upload,
antes e depois de link+compartilhar) — sempre sobrescrevendo os MESMOS
arquivos (`C:\MSConecta\screenshot_*.png`), então cada execução apaga as
evidências visuais da execução anterior.

---

## 2. Como o link sticker é inserido (`link_e_compartilhar.js`)

🟢 Tudo via CDP (CDP = Chrome DevTools Protocol, injeta eventos direto no
*renderer* da aba — **não** é clique real do sistema operacional, diferente
do passo 9-10 acima):

1. Seleciona a aba correta: precisa conter `business.facebook.com` na URL E
   **nunca** pode ser a aba do canal do Instagram (checagem explícita no
   código — "BUG DE SEGURANCA" se bater com o ID do canal).
2. Procura um botão/elemento cujo texto bata com `Adicionar link|Add link`
   (regex sobre `aria-label` ou texto do elemento). Clica via
   `Input.dispatchMouseEvent` sintético.
3. Espera 4s o modal abrir, procura um `<input>` de URL (tenta seletores
   específicos — `input[type="url"]`, placeholder contendo "url"/"link"/
   "http" — antes de cair para "qualquer input grande visível").
4. **Preenche o campo usando o *setter* nativo do React**
   (`Object.getOwnPropertyDescriptor(...).set`), não `el.value = x` direto
   — porque o React ignora atribuição direta de `value` e não dispara seu
   próprio estado interno. Depois dispara manualmente os eventos `input` e
   `change` que o React escuta.
5. Procura e clica o botão "Aplicar/Apply/Concluir/..." (ou aperta Enter via
   CDP se não achar o botão por texto).
6. **Verificação real de sucesso** (`verificarLinkAplicado`): só considera
   aplicado se encontrar um sinal POSITIVO — o botão virou "Editar
   link"/"Edit link" OU um elemento com `aria-label`/`data-testid` contendo
   "link sticker" apareceu no DOM. **Nunca** usa "o botão Adicionar link
   desapareceu" como sinal de sucesso sozinho — o comentário no código é
   explícito sobre isso ser um falso-positivo conhecido (DOM lento, página
   carregando, mudança de UI do Meta).
7. Repete os passos 2-6 até 3 tentativas antes de desistir.
8. **Só depois** disso, procura e clica o botão final "Compartilhar" (texto
   exato — não "Compartilhar agora"/"Share now", que são variantes de outro
   contexto de UI, usadas só como fallback).

🟡 Não confirmado: não há verificação equivalente de sucesso para o clique em
"Compartilhar" em si — o script espera 5s fixos e assume que funcionou se
não lançar exceção. Diferente do link sticker, não há um sinal positivo
específico checado para "o story foi mesmo publicado" além do que o
`postar_story.ps1` já faz (gravar o marcador em disco).

---

## 3. Requisitos de ambiente

🟢 **Confirmado por configuração/código encontrados no servidor:**

- **Resolução de tela atual**: 1920x1080 (medido agora,
  `System.Windows.Forms.Screen.PrimaryScreen.Bounds`). As coordenadas de
  tela fixas usadas como fallback (`$btnAdicionarFotoX/Ys`,
  `$btnAdicionarLink`, `$campoUrl`, `$btnAplicar`, `$btnCompartilhar` em
  postar_story.ps1) foram calibradas para essa resolução — **mudar a
  resolução do servidor quebra os fallbacks de coordenada fixa** (o caminho
  via CDP, quando funciona, não depende da resolução).
- **PC configurado para nunca suspender/hibernar** (`never_sleep.ps1`:
  `powercfg /change standby-timeout-ac 0`, idem hibernate e monitor-timeout
  AC) — isso evita que o monitor desligue ou o PC hiberne, mas **não** é a
  mesma coisa que impedir a tela de bloquear por política de tela de
  proteção/inatividade.
- **Sessão Windows precisa estar aberta e com desktop interativo ativo**: o
  script usa `mouse_event`/`SendKeys` (Win32 `SendInput`, via
  `System.Windows.Forms`) e UI Automation
  (`System.Windows.Automation`) para o dialog nativo de upload — essas APIs
  do Windows **exigem acesso ao desktop interativo (`WinSta0\Default`)**;
  quando a sessão está bloqueada, o sistema troca para o desktop seguro do
  Winlogon e essas chamadas tipicamente não têm efeito (clique "no lugar
  errado"/sem efeito, não geram excecão).
- **Chrome precisa estar em primeiro plano** para os passos que usam clique
  de SO (botão de mídia, dialog de upload) — o script chama
  `SetForegroundWindow` antes de cada um desses cliques, mas isso só
  funciona se nada estiver "roubando" o foco ao mesmo tempo (outro processo,
  um popup do Windows, etc.).

🟡 **Não confirmado neste levantamento (seriam necessários teste/observação
direta ou sessão elevada):**

- Não testei bloquear a tela (Win+L) durante uma execução real para
  observar o efeito exato — a afirmação acima sobre `SendInput`/desktop
  seguro é comportamento documentado do Windows em geral, não algo
  observado nos logs deste servidor.
- Não confirmei se a política de tela de proteção/bloqueio por inatividade
  está desabilitada neste PC — `never_sleep.ps1` só cobre suspensão/
  hibernação/monitor, não blocklock por `screen saver timeout`.
- Não consegui ler o log de Segurança do Windows (eventos 4800/4801 de
  bloqueio/desbloqueio de sessão) para cruzar com os horários de falha —
  requer sessão elevada, que esta conta (`msconecta`) não tem (confirmado em
  investigação anterior, ver memória do projeto).
- A conta usada pela sessão interativa (que mantém a UI de automação válida)
  não foi confirmada como sendo exatamente a mesma conta de serviço do
  dispatcher Node — só confirmei que ambos os processos esperam o mesmo
  perfil de Chrome (`chrome-cms-agent`).

### O que acontece se a tela bloquear ou a janela perder o foco

🟢 Pelo fluxo de erro do próprio código (consequência lógica, não teste
direto): se o clique no botão de mídia (passo 9) não registrar porque a tela
está bloqueada ou o foco mudou, o dialog nativo de upload nunca abre →
`ERRO: Dialog de arquivo nao apareceu em 30s` → tira screenshot
(`screenshot_nodialog.png`) → chama `Alertar-SeNaoPublicado` (que ainda pode
suprimir o alerta se outra execução concorrente já tiver publicado a mesma
notícia) → `exit 1`. **64 ocorrências** desse erro específico foram
encontradas no histórico completo do log de detalhe (`postar_story_detail.log`,
desde 27/08) — 🟡 não confirmado quantas são de fato tela bloqueada/foco
perdido vs. outras causas (Chrome lento, dialog com delay maior que 30s,
etc.), já que o log não registra o estado da sessão Windows no momento do
erro.

Se, em vez disso, o foco for perdido DEPOIS que o dialog de upload já abriu
(passo 10) ou durante os cliques do `link_e_compartilhar.js` — este
último é via CDP, então **não depende do foco do SO**: continuaria
funcionando mesmo com a janela em segundo plano ou a tela bloqueada, **desde
que o Chrome em si continue processando mensagens** (🟡 não confirmado o que
acontece com o *renderer* do Chrome quando o monitor é desligado via
suspensão — mas isso já está coberto por `never_sleep.ps1`, que impede o
monitor de suspender).

---

## 4. Duração média e taxa de falha

🟢 **Janela recente e mais confiável** — últimos ~9 dias
(`C:\MSConecta\logs\publicador.log`, desde o último restart do dispatcher em
2026-10-18, cobre só disparos reais via `/postar-story` vindos da VPS, sem
mistura com testes manuais de desenvolvimento):

| Métrica (story) | Valor |
|---|---|
| Execuções medidas | 267 |
| Duração média | 54,5 s |
| Duração mínima / máxima | 2 s / 95,1 s |
| `exit != 0` no log bruto | 71 de 267 (≈27%) |

🟡 **Não confirmado**: essa taxa de ≈27% está quase certamente **inflada por
falso-positivo de corrida** — o próprio postar_story.ps1 documenta que a
VPS às vezes dispara `/postar-story` em duplicata para a mesma notícia, e o
processo "perdedor" dessa corrida reporta falha mesmo quando o outro já
publicou com sucesso (por isso existe o marcador em disco que suprime o
alerta Telegram nesse caso). Não medi exatamente quantas das 71 falhas brutas
são corrida-perdida vs. falha real.

🟡 **Histórico completo desde 27/08/2026** (`postar_story_detail.log`, 2.918
execuções) **NÃO é um indicador confiável de taxa de falha em produção**: a
maioria quase certa dessas execuções inclui testes manuais do
desenvolvimento do script (há múltiplas versões `.bak` de `postar_story.ps1`
ao longo de meses, e 2.413 das 2.918 execuções — ≈83% — terminaram com "ERRO:
link_e_compartilhar.js falhou", um número bem mais alto que o da janela
recente, consistente com mistura de testes/depuração). Uso esse período só
para a seção 5 (sucessos confirmados por dia), não para taxa de falha.

---

## 5. Tratamento de erro

🟢 Camadas de tratamento, da mais interna para a mais externa:

1. **Dentro de `link_e_compartilhar.js`**: retry de até 3 tentativas por
   sub-etapa (adicionar link, preencher URL, aplicar) com verificação real
   de sucesso antes de avançar (nunca assume sucesso por ausência de erro).
2. **Dentro de postar_story.ps1**: cada etapa crítica (Chrome certo,
   sessão válida, dialog de upload, helper de link+compartilhar) tem seu
   próprio ponto de saída com código de exit específico:
   - `exit 1` — arquivo de imagem não encontrado, janela do Chrome não
     encontrada, dialog de upload não apareceu, ou `link_e_compartilhar.js`
     falhou.
   - `exit 2` — sessão do Meta Business Suite expirada (página de login
     detectada) — **único caso que precisa de ação humana** (login manual).
3. **Alerta anti-falso-positivo** (`Alertar-SeNaoPublicado`): antes de
   mandar o alerta Telegram de falha, espera até 90s (18 tentativas de 5s)
   verificando se outro processo concorrente já publicou a mesma notícia
   com sucesso — se sim, suprime o alerta (loga só um aviso local).
4. **No dispatcher** (`servidor_publicador.js` / `servidor_publicador_dispatcher.js`):
   `exit code 0` → `200 {ok:true}`; `exit code != 0` → `200 {ok:false, erro,
   stderr}` (não é 500 — a chamada HTTP em si teve sucesso, só o resultado é
   negativo); erro ao nem iniciar o processo PowerShell → `500`.
5. Todo o transcript completo de cada execução vai para
   `C:\MSConecta\logs\postar_story_detail.log` (`Start-Transcript -Append`) —
   é o arquivo mais detalhado para investigar uma falha específica.

---

## 6. Variáveis de ambiente usadas (nomes, sem valores)

🟢 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — lidas por `supervisor_lib.ps1`
(`Send-AlertaTelegram`) e pelo dispatcher Node. Nenhum valor hardcoded em
nenhum arquivo deste pacote.

## Arquivos deste pacote relacionados ao story

- `02_story_link_sticker.md` — este documento.
- postar_story.ps1 — script principal (sanitizado).
- `navegar_story.js`, `find_btn_midia.js`, `link_e_compartilhar.js` — helpers CDP chamados por postar_story.ps1.
- `supervisor_lib.ps1` — lib compartilhada (`Send-AlertaTelegram`).
- Ver também `servidor_publicador_dispatcher.js` (atualizado com `/receber-story`) e `03_canal_instagram.md` (pacote anterior, canal).

---

## 7. Story pela API? Contradição resolvida

Pacote anterior dizia, ao mesmo tempo, "sem fallback API" (comentário no código da VPS) e "tenta API primeiro" (manual). **Resolução, com base no que o PC confirmou e no código da VPS:**

- 🟢 **Em produção o story NÃO é publicado pela Graph API.** `publicar_feed_e_story()` (VPS) só chama `postar_story_vps.sh`; se falhar, loga "Story Windows falhou — story não publicado (sem fallback API)". O PC executa `postar_story.ps1` (browser).
- 🟢 O motivo é o **link sticker**: o fluxo atual depende da UI do Meta Business Suite para inserir o sticker. Não existe, no código ativo, nenhum caminho de API para story.
- 🟡 Existe `story_url` enviado ao Cloudinary na VPS, mas nunca usado depois (upload desperdiçado). Não é um caminho de API.
- **Para o Heitor:** implementar o story **só por navegador**; não construir fallback por API sem decisão explícita do Saulo.

---

## 8. Idempotência do story (numero + data)

🟢 **Chave de identidade: `NOTICIA<numero>` + `<data>`**, nos dois lados:

| Lado | Mecanismo | O que garante |
|---|---|---|
| VPS | `item["story_ok"]=True` em `agendamentos.json`, gravado após o `"ok":true`; em retry, `canais_ja_publicados` pula o story (`CANAIS_IDEMPOTENTES = story, threads, facebook`) | não reenviar um story já aceito pelo PC **em ciclos seguintes do cron** |
| PC | arquivo `C:\MSConecta\tmp\story_ok\NOTICIA<numero>_<data>.ok`, gravado só após sucesso; apagado após 2 h | **apenas suprimir o alerta Telegram** de processos "perdedores" (espera até 90 s) |

⚠️ **O marcador do PC NÃO é uma trava de idempotência.** Ele não impede um segundo processo de rodar o fluxo inteiro e postar de novo: só evita o alarme falso. Quem for reimplementar deve **checar o marcador/ledger ANTES de agir** (e usar uma trava por `numero+data`, p.ex. mutex/lockfile ou fila de 1 worker) em vez de só depois.

🟢 **Como `numero` e `data` são montados (VPS):**
- `numero` = posição (1-based) da pasta entre as notícias do dia da **pasta** (`cache_noticiasmetadados.json` ordenado por `gerado_em`); fallback por mtime; fallback final `1`.
- `data` = `datetime.now().strftime("%d.%m")` — **data de agora (UTC), não a data da pasta**.
- 🟡 Risco: pasta de um dia publicada depois da meia-noite UTC (20h em Campo Grande) leva `data` do dia seguinte com `numero` do dia anterior → chave/arquivo `NOTICIA<n>-STORY.jpeg` pode colidir com outra notícia. Não observado em log; inferido do código.
- O arquivo-alvo no PC é `<BaseDir>\<data>\NOTICIA<numero>-STORY.jpeg`; a extensão é `.jpeg` embora a VPS envie `story.png` (🟡 não confirmado se o Instagram aceita sem problema — vem funcionando).

---

## 9. Disparos duplicados VPS → PC (investigação só por leitura de código)

🟢 **Causa provável (alta confiança), desencontro de timeouts:**
1. `/postar-story` no PC é **síncrono**: só responde quando o `postar_story.ps1` termina (média 54,5 s, máx 95 s).
2. `postar_story_vps.sh` chama esse endpoint com `curl --max-time 20` e **até 3 tentativas, 5 s de intervalo**, e só aceita `"ok":true`.
3. Resultado: a 1ª chamada estoura aos 20 s (o PC continua rodando o script — fechar a conexão não mata o `spawn`), o `sleep 5` passa, a 2ª chamada **inicia um segundo `postar_story.ps1`** para o mesmo `numero+data`, e depois uma 3ª. O dispatcher não tem trava por notícia → 2–3 processos disputam o mesmo Chrome. É exatamente o comportamento descrito no cabeçalho do `postar_story.ps1`.
4. 🟢 Evidência quantitativa (STORY-DUP, 26/10, medida): **73% das notícias tiveram mais de uma execução de story em 7 dias**, e **2 stories foram publicados em dobro (24/10 e 25/10)**. A duplicação é real e frequente; a estimativa anterior (≈1,14 execução por notícia, ~14% de extras, a partir de 267 execuções vs. 234 notícias) **está superada** e não deve ser usada. A cifra "story 42–122/dia" do log completo do PC inclui testes e continua sem valor como medida de duplicação. O canal usa uma única chamada (`requests.post`, 70 s, sem retry).

🟢 **Causas secundárias possíveis:**
- Se todas as 3 tentativas estourarem, o `.sh` sai com erro, `story_ok` fica `False` e o item vira `publicado_parcial`; o ciclo seguinte pode reenviar (o PC pode já ter publicado).
- `publicar_santos.sh` (one-off de 12/05, fora do cron, sem referências) chamava `postar_story_vps.sh` por conta própria, fora do controle `story_ok`. Não é fonte ativa de duplicatas.

🟡 Observação: a maioria das execuções repetidas **não** virou post em dobro (2 publicações duplicadas contra 73% das notícias com repetição); o que impede o resto é o marcador `story_ok`, que age só *depois* do robô e por isso não é trava. Os logs da VPS não guardam a tentativa que teve sucesso.

**Correções (propostas, NÃO ativadas; produção intocada):** pacote pronto em `story_dup_pc/` (trava por `numero+data` no PC + `curl` sem retry após timeout, `--max-time` 150 s). Opções originais: (a) o PC responder `202 {ok:true,aceito:true}` imediatamente e executar em background com fila de 1 worker; (b) trava/checagem por `numero+data` **antes** de executar; (c) se mantiver síncrono, `--max-time` ≥ 120 s e sem retry após timeout; (d) endpoint de status por `numero+data` para confirmar publicação.
