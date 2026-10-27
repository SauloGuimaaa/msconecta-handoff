# 07 — Virada: do PC do Saulo para o PC do Heitor, sem postar em dobro

**Nada disto foi executado. Cada mudança em produção depende de aprovação do Saulo.**

## O que a VPS faz hoje [FATO]
O IP do PC está **fixo no código**: `postar_story_vps.sh` (variável `WINDOWS_IP`) e `publicar_instagram.py` (`postar_link_canal_instagram`). Também usado em outros fluxos (render de Reels :3001, scraping :8765 `/fetch-url`, `/fetch-binary`) — **trocar o IP só para story/canal**, sem tocar neles. [NÃO CONFIRMADO] se essas rotas também serão migradas; o escopo deste pacote é só story e canal.
A VPS é produção viva (cron por minuto): mudança sempre em worktree e merge só na ativação (regra do Saulo).

## Pré-condições (todas)
1. `06_testes_aceitacao.md` assinado.
2. PC do Heitor alcançável da VPS (mesma rede privada) e `GET /status` OK.
3. Decisão do Saulo sobre: tornar IP/porta configuráveis por `.env` na VPS (recomendado) e adicionar o token do listener.
4. Contas: ver abaixo "Sessão".

## Plano (janela curta, fora do horário de pico, ex.: 20h30–21h CG, depois do fim da janela 9h–20h)
| Passo | Ação | Verificação |
|---|---|---|
|1| Congelar: Saulo pausa a fila (nenhum item com `horario` vencido nos próximos 30 min) | log da VPS sem "Processando" |
|2| Anotar baseline: último story e última msg de canal já postados; contagem de `story_ok` | print do estado |
|3| **Desligar o lado antigo primeiro**: parar o serviço da 8765 no PC do Saulo (e o robô) | `GET /status` do PC antigo falha |
|4| Ligar o serviço do Heitor em `MODO_TESTE=false`, perfil logado | `GET /status` OK |
|5| VPS: apontar story/canal para o IP do Heitor (variável de ambiente, worktree → ff-merge) | grep do IP novo no código ativo |
|6| Despausar com **1 notícia**; conferir 1 story + 1 post de canal e nada duplicado | perfil/canal reais |
|7| Observar 3 notícias seguidas; depois operação normal por 24 h | alertas, ledger |

Regra de ouro anti-duplicação: **nunca** dois listeners ativos ao mesmo tempo, e **nunca** apontar a VPS para o novo sem antes parar o antigo. O ledger do Heitor começa vazio: por isso o Saulo entrega a lista de URLs já postadas hoje (`agendamentos.json`, itens `publicado` das últimas 48 h) para o Heitor pré-carregar no ledger (campos `story=publicado`, `canal=publicado`). [NÃO CONFIRMADO] que o canal já tem tudo isso: a VPS não guarda `canal_ok`; checar o canal manualmente nas últimas 10 mensagens.

## Sessão e conta
Mesma conta Instagram em dois computadores ao mesmo tempo aumenta o risco de desafio. Logar o Heitor **após** deslogar/encerrar o robô do Saulo; avisar o Saulo que a sessão no PC antigo pode cair. Credenciais nunca trafegam neste pacote.

## Rollback (≤ 5 min)
1. Parar o serviço do Heitor.
2. VPS: voltar a variável/IP anterior (ou `git revert` do merge).
3. Religar o listener do PC do Saulo e checar `GET /status`.
4. Checar se algum item ficou entre os dois (story ou canal sem confirmação) e reenviar **um por vez**, depois de conferir na conta.
5. Rollback automático sugerido: 3 falhas consecutivas em 1 h → alerta ao Saulo (não reverte sozinho).

## Pendências antes da virada (decisões do Saulo)
- Aprovar mudar a VPS (IP configurável + token).
- Quem fica com a conta oficial e a política de 2FA.
- Se o PC antigo continua como reserva (recomendado: desligado, não deletado, por 7 dias).
