# Como a VPS dispara (FATO, publicar_instagram.py, publicar_feed_e_story)
1. Cron a cada minuto: `publicar_instagram.py --processar` le agendamentos.json; item com `horario` vencido e status pendente/agendado entra.
2. Publica FEED via Graph API. Se `feed_ok` e o feed NAO estava ja publicado e ha `noticia_url`: dispara thread -> POST <PC>:8765/postar-canal {"url": ...} (timeout 70s). No fim da funcao: `canal_thread.join(timeout=75)`.
3. Depois `sleep(3)` e, se `story` nao esta em `<canal>_ok` do item: `postar_story_vps.sh <numero> <DD.MM> <url> <story.png> [horario_utc]`; sucesso = stdout contem `"ok":true` (SO significa "PC aceitou", nao "story saiu").
4. Idempotencia: CANAIS_IDEMPOTENTES=("story","threads","facebook") gravados como item["story_ok"]=True. O CANAL NAO esta nessa lista (nao ha flag canal_ok).
5. numero da noticia = posicao (1-based) da pasta entre as noticias do dia (cache_noticiasmetadados.json, ordenado por gerado_em); fallback por mtime das pastas; fallback final 1.
