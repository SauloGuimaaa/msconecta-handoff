# 05 — Segurança e ritmo

## Login e sessão
- [REGRA] O Heitor faz o login **ele mesmo, manualmente**, num perfil de navegador novo, dedicado ao robô, no computador dele. Nunca copiar o perfil/cookies do PC do Saulo (vincula a sessão a outro dispositivo/IP e é vazamento de credencial).
- Ativar 2FA da conta. Códigos 2FA são digitados por humano. O robô **não** guarda senha.
- Se o Instagram pedir verificação/desafio: parar, alertar, esperar humano. Não resolver CAPTCHA automaticamente.
- [FATO] O original usa o perfil dedicado `chrome-cms-agent` (Chrome com `--remote-debugging-port=9222`); sessão expirada = `exit 2` + alerta Telegram, login manual. O seu deve ser um perfil novo, login manual, nunca copiado.
- Listener sem autenticação no original [FATO]; no seu: bind em `127.0.0.1`/VPN + token `LISTENER_TOKEN` em header.
- Sem screenshots/logs com dados pessoais; sem segredos em log.

## Ritmo que usamos (da VPS, API de feed) [FATO]
| Parâmetro | Valor | Origem |
|---|---|---|
| Intervalo mínimo entre publicações | **20 min** | `.env` atual (`INTERVALO_MIN_PUBLICACAO_MINUTOS=20`) |
| Jitter | **0 min** hoje | `.env` (`INTERVALO_JITTER_MAX_MINUTOS=0`); default no código 25+0–5; já foi 15 min (27/09) |
| Janela de publicação | 9h–20h CG (default do gate); auto-slot calcula 7h–22h CG | código |
| Backoff de rate limit | 10, 20, 40, 80 min | `BACKOFF_RATE_LIMIT_MINUTOS` |
| Retry HTTP VPS→PC | 3× com 5 s | `postar_story_vps.sh` |
| Teto diário de segurança | 60 posts/dia (default) | `TETO_DIARIO_POSTS` |
| Cota efetiva por 24 h (feed) | 48 (default; vazio = 48) | `COTA_EFETIVA_24H` |
| Volume real | ~30 notícias/dia | documentação interna |

Esses números governam o **feed pela API**. O story e o canal vão a reboque do feed, ou seja, ≤ 1 story + 1 post de canal por notícia, com o mesmo espaçamento. Existe uma checagem da cota oficial (`content_publishing_limit`) na VPS; o limite oficial da Meta (100/24 h) tem divergência de documentação interna (50 vs 100) [NÃO CONFIRMADO qual vale].

## Limites diários das ações de navegador [FATO operacional informado pelo Saulo/PC]
| Ação | Limite diário | Observação |
|---|---|---|
| Story (link sticker) | **29 por dia** | 1 por notícia |
| Canal (broadcast) | **44 a 47 por dia** | 1 por notícia |

- Os volumes brutos do log completo do PC (story 42–122/dia, inclui testes; canal 14–41/dia) **não são o alvo**; a duplicação de story é real: **73% das notícias tiveram mais de uma execução em 7 dias** e **2 stories foram publicados em dobro (24/10 e 25/10)**; tratamento em `02_story_link_sticker.md`, seção 9. O número a respeitar é 1 story + 1 post de canal por notícia, dentro dos limites acima.
- Mesmo espaçamento mínimo do feed (20 min) e janela 9h–20h CG continuam valendo. Sem rajadas; parar no primeiro desafio/"ação bloqueada".
- [NÃO CONFIRMADO] a origem exata desses limites (medição própria vs. política do Instagram). Tratar como teto rígido.

## Requisito de máquina/sessão dedicada (story) [FATO]
O story usa `SendInput`/`mouse_event` e `SendKeys` (Win32) + UI Automation para o diálogo nativo "Abrir arquivo". Isso **controla o mouse e o teclado reais** da sessão:
- A máquina (ou sessão Windows) deve ser **dedicada ao robô**. Uso humano ao mesmo tempo (mexer no mouse, trocar de janela, abrir popup) rouba o foco e quebra o clique.
- Exige **desktop interativo ativo** (`WinSta0\Default`). Em tela bloqueada o Windows troca para o desktop seguro e os cliques não têm efeito (falha "dialog de arquivo não apareceu em 30s", 64 ocorrências no histórico).
- Resolução fixa **1920×1080**: os fallbacks de coordenada de tela foram calibrados para ela.
- O canal (CDP puro, sem clique de SO) não tem essa exigência, mas roda no mesmo Chrome (`chrome-cms-agent`, porta 9222).

## O PC nunca pode suspender nem bloquear a tela [REGRA]
- Desativar suspensão, hibernação e desligamento do monitor (`powercfg /change standby-timeout-ac 0`, idem hibernate e monitor-timeout).
- **Também** desativar bloqueio automático: proteção de tela com "exibir tela de logon", bloqueio por inatividade (política de segurança) e bloqueio ao fechar a tampa/trocar de usuário. Nunca usar Win+L, nem deixar RDP/"alternar usuário" tirar a sessão do console.
- Se for acessar por RDP, fechar a sessão devolvendo o console (`tscon`), não só desconectar, ou a sessão fica sem desktop interativo.
- [NÃO CONFIRMADO] se a política de bloqueio por inatividade está desabilitada no PC atual (`never_sleep.ps1` cobre só suspensão/hibernação/monitor).

## Jitter nas ações do navegador
O original usa pausas fixas (`sleep` 0,5–6 s) [FATO]. Para o seu: pausas 0,8–2,5 s aleatórias entre cliques, digitação 30–90 ms/tecla, e +0–5 min aleatórios no intervalo entre notícias. [SUPOSIÇÃO]

## O que evita bloqueio (boas práticas; não é garantia)
- Um dispositivo/IP estável; não trocar de rede durante o dia; não logar de dois lugares ao mesmo tempo (ver `07`).
- Sem rajadas: nunca postar 2 notícias seguidas sem o intervalo.
- Parar no primeiro sinal de desafio, "ação bloqueada" ou erro de rate limit; esperar horas, não retentar em loop.
- Conteúdo igual ao que já funciona (mesma imagem, mesmo formato).
- Automação de navegador pode violar os termos do Instagram [SUPOSIÇÃO]; decisão de risco é do Saulo.
- Guardar um alerta (Telegram opcional) para falha, sessão expirada, desafio, disjuntor aberto.

## Incidente histórico relevante
Em 21/09/2026 o handler de story do PC travou aceitando conexão sem responder; a VPS deu "acionado" mas nada saiu. Faça timeout e watchdog no seu serviço.
