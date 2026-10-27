# 06 — Testes de aceitação (conta de teste)

Pré-requisito: conta de teste do Instagram (e um canal de teste) — nunca a conta oficial do MSConecta. URLs de teste: `https://msconecta.com.br/noticia/teste-aceite-NN` (404 é aceitável; o que importa é o sticker/mensagem).

## Fase 0 — ambiente
- [ ] `.env` preenchido, perfil novo logado manualmente, `MODO_TESTE=true`.
- [ ] Serviço sobe e só atende em localhost/VPN; chamada sem token → 401.

## Fase 1 — contrato
- [ ] JSON válido → 200 `aceito`. 8 JSON inválidos (url fora do domínio, slug com maiúscula, imagem 1080×1080, arquivo inexistente, ação desconhecida, horário inválido, campo faltando, imagem com extensão falsa) → 400 com motivo.

## Fase 2 — story em MODO_TESTE
- [ ] Executa tudo menos publicar; screenshot mostra o sticker com a URL exata; rascunho descartado.
- [ ] Idioma da interface PT-BR e EN: ambos passam, ou falha clara.

## Fase 3 — story real (conta de teste)
- [ ] 1 story: aparece no perfil; sticker abre a URL certa; resposta `publicado` só depois de ver o story.
- [ ] Reenviar o mesmo `id` → `duplicado`, nenhum story novo.
- [ ] Remover o sticker artificialmente (seletor errado de propósito) → `falhou(sticker)`, **nada** publicado.
- [ ] Matar o navegador no meio → `falhou`, sem story parcial; próximo envio recupera.

## Fase 4 — canal real (conta/canal de teste)
- [ ] 1 URL → mensagem aparece no canal; resposta `publicado` só após ver.
- [ ] Reenviar → `duplicado`.
- [ ] Canal inexistente → `falhou(canal_nao_encontrado)`.

## Fase 5 — ritmo
- [ ] 10 notícias seguidas: intervalos ≥ regra (20 min ou o definido), todos na janela 9h–20h CG, 0 duplicados. (Pode simular acelerando o relógio em teste de unidade; ao menos 3 reais.)
- [ ] Sessão deslogada de propósito → alerta e parada; nenhuma tentativa de login automático.

## Fase 6 — segurança
- [ ] `grep -rEi "(token|password|senha|cookie|sessionid|secret)" repo logs` sem valores reais.
- [ ] Nenhum arquivo de perfil/cookie dentro do repositório.

## Critério final
Todas as caixas marcadas, 24 h de operação em teste sem alerta de bloqueio. Só então seguir para `07_virada.md`. Resultado dos testes anexado em um arquivo `RESULTADO_ACEITE.md` com data e quem assinou.
