# 01 — Prompt mestre (cole isto na sua IA, junto com o resto da pasta)

---

Você vai reimplementar duas automações de navegador para o Instagram do portal de notícias MSConecta. Você não conhece o projeto; leia todos os arquivos da pasta `handoff_heitor/` antes de escrever código, começando por `00_LEIA_PRIMEIRO.md`.

## Objetivo
Dado um JSON por notícia (formato em `04_contrato_dados.md`), no computador do Heitor:
- **(A)** postar um story com a imagem `story_imagem` e um **link sticker** com `url`;
- **(B)** postar `url` no **canal de transmissão** do Instagram do MSConecta.

## Como o sistema original funciona (resumo, detalhes nos arquivos)
Um servidor HTTP local (porta configurável) recebe `POST /receber-story` (bytes da imagem), `POST /postar-story` (JSON) e `POST /postar-canal` (JSON `{"url":...}`) e dispara a automação (story: PowerShell + UI Automation + helpers Node via CDP; canal: Node puro via CDP, sem Playwright) no Chrome já logado. Resposta `{"ok":true}` do original só significa "pedido aceito", **não** "publicado". Você deve fazer melhor (ver critérios).

## Restrições (inegociáveis)
1. **Nunca** pedir, ler, gravar ou copiar senha, token, cookie ou perfil de navegador de outra pessoa. O login no Instagram é feito pelo Heitor, manualmente, num perfil de navegador novo e dedicado.
2. Segredos só em `.env` (modelo: `.env.example`); nunca em código, log ou commit.
3. Não contornar CAPTCHA, desafio de segurança ou aviso de bloqueio: **parar e alertar**.
4. Respeitar `05_seguranca_e_ritmo.md` (intervalos, janela, limite diário). Sem paralelismo: **uma ação de navegador por vez**.
5. Começar em **conta de teste**, com `MODO_TESTE=true` (executa tudo menos o clique final de publicar).
6. Não inventar seletores: os do original estão em `codigo_referencia/` e podem estar defasados; valide com a interface atual do Instagram e registre o que mudou. Tudo marcado "NÃO CONFIRMADO" nos arquivos deve ser verificado, não presumido.
7. Idempotência: a mesma `url` nunca pode gerar dois stories nem duas postagens no canal (ledger local, ver `04`).
8. Escutar só em `127.0.0.1` ou na interface da VPN privada, com token compartilhado obrigatório.

## Entregáveis
- Serviço com 3 rotas (ou um CLI equivalente) + ledger de idempotência + logs sem segredos.
- Resposta distinguindo `aceito`, `publicado`, `falhou(motivo)`; só `publicado` após confirmação visual no navegador (ver `02`/`03`).
- Screenshot em cada falha (sem dados pessoais) na pasta de erros.
- Script de teste de aceitação conforme `06`.

## Critérios de aceite
- Em conta de teste: 10 notícias seguidas → 10 stories com sticker clicável apontando para a URL exata e 10 posts de canal, 0 duplicados, intervalos dentro da regra.
- Reenviar o mesmo JSON → resposta `duplicado`, nada postado.
- Sticker não aparece → falha explícita com screenshot, **nada** publicado sem o link (um story sem link é falha, não sucesso).
- Sessão expirada/desafio → para, alerta, não tenta logar sozinho.
- `grep` por tokens/senhas no repositório e nos logs → 0 ocorrências.

Antes de codar, responda com: (1) o que entendeu, (2) lista de itens "NÃO CONFIRMADO" que vai verificar primeiro, (3) plano em passos.
