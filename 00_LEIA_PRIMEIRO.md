# 00 — Leia primeiro (pacote de repasse para o Heitor)

Convenção em TODOS os documentos: **[FATO]** = visto no código/logs da VPS; **[SUPOSIÇÃO]** = dedução minha; **[NÃO CONFIRMADO]** = não consegui ver. Onde há dúvida, a resposta certa é "não confirmado", não um palpite.

## O que são as duas automações
- **(A) Story com link sticker**: para cada notícia publicada no feed do Instagram do MSConecta, postar um story (imagem 1080×1920) com um *link sticker* apontando para a URL da notícia no site.
- **(B) Link no canal**: postar a URL da notícia no **canal de transmissão (broadcast channel) do Instagram** do MSConecta.

Ambas rodam hoje **no PC servidor do Saulo (Windows, rede Tailscale), no Chrome já logado (perfil `chrome-cms-agent`, CDP porta 9222)**, acionadas por HTTP pela VPS. **Não usam Playwright.** A VPS gera as imagens, decide o horário e publica o feed pela API oficial; **o PC só faz o que a API não faz**.

## Mapa real (FATO, confirmado no PC em 2026-10-26)
```
VPS (cron 1x/min) publicar_instagram.py --processar
   ├─ publica FEED pela Graph API
   ├─ se o feed saiu agora ─► thread: POST <PC>:8765/postar-canal {"url": "..."}   (B)
   └─ depois ─► postar_story_vps.sh:
         1) POST <PC>:8765/receber-story  (corpo = bytes da imagem; headers X-Numero, X-Data)
         2) POST <PC>:8765/postar-story   {"numero","data","url"[,"agendar","horario"]}      (A)
PC: servidor_publicador.js (Node, porta 8765, task MSConectaPublicadorPM2)
   ├─ /postar-story ─► postar_story.ps1 (PowerShell + UI Automation) + navegar_story.js, find_btn_midia.js, link_e_compartilhar.js (CDP) + supervisor_lib.ps1
   └─ /postar-canal ─► postar_canal_instagram.js (Node puro via CDP)
```
Não há fila de mensagens nem banco compartilhado: só HTTP simples sobre Tailscale, **sem autenticação**.

## Story pela API? NÃO
Resolvida a contradição do pacote anterior: o story **não** é publicado pela Graph API em produção (sem fallback API); só por navegador, por causa do link sticker. Detalhes em `02`, seção 7.

## Código do PC: agora completo
A lacuna anterior (código do dispatcher e do canal) foi fechada: `codigo_referencia/` tem `servidor_publicador_dispatcher.js` (só as rotas de story/canal), `postar_canal_instagram.js`, `postar_story.ps1`, os 3 helpers Node e `supervisor_lib.ps1` (sanitizados). `story_poster_windows.py` e `story_listener_novo.ps1` estão em `codigo_referencia/LEGADO/` (sem uso desde 08/06/2026; **não usar**).

## Pontos críticos (ler antes de implementar)
- **Story exige máquina/sessão dedicada**: usa `SendInput`/mouse/teclado reais; o PC **nunca** pode suspender nem bloquear a tela (`05`).
- **Limites**: 29 stories/dia; 44 a 47 posts de canal/dia (`05`).
- **Idempotência do story** = `numero + data`; o marcador do PC só suprime alerta, não evita duplicata (`02`, seção 8).
- **A VPS dispara o story em duplicata** por desencontro de timeout (`02`, seção 9). Não replique isso.

## Ordem de implementação recomendada
1. Ler `04_contrato_dados.md` e `05_seguranca_e_ritmo.md`.
2. Subir o ambiente (`.env.example`, `requirements.txt`: Node 22 + Chrome, sem Playwright) e fazer login **manual** num perfil novo do navegador (nunca copiar sessão).
3. Implementar (A) seguindo `02` (navegador, sem API), só em **conta de teste**, com `MODO_TESTE=true`.
4. Implementar (B) seguindo `03` (código de referência já incluído).
5. Rodar `06_testes_aceitacao.md`.
6. Só então `07_virada.md`.

## Glossário
- **Link sticker**: adesivo de link do story (abre a URL ao toque).
- **Canal (broadcast channel)**: canal de transmissão do Instagram, só o dono posta, seguidores recebem.
- **Pasta da notícia**: `output/AAAA-MM-DD/<slug>/` com `feed.png`, `story.png`, `meta.json`, `legenda.txt`.
- **CG**: horário de Campo Grande = UTC−4. A VPS roda em UTC.
- **estado / agendamentos.json**: lista de itens com `horario`, `status`, `story_ok` etc.; é a fonte de idempotência da VPS.
- **CDP**: Chrome DevTools Protocol, porta 9222; os scripts falam direto com ele (http + WebSocket nativos do Node), sem Playwright.

## Arquivos
`01_PROMPT_MESTRE.md` · `02_story_link_sticker.md` · `03_canal_instagram.md` · `04_contrato_dados.md` · `05_seguranca_e_ritmo.md` · `06_testes_aceitacao.md` · `07_virada.md` · `codigo_referencia/` (+ `LEGADO/`) · `.env.example` · `requirements.txt`
