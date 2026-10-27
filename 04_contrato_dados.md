# 04 — Contrato de dados

## O que existe hoje [FATO]
O original **não usa um JSON único por notícia**. Os dados vêm de:
- `output/AAAA-MM-DD/<pasta>/meta.json`: chaves `titulo, editoria, img_url, img_path, paragrafos, url, focal_x, focal_y, zoom, offset_x, offset_y` (a `url` tem a forma `https://msconecta.com.br/noticia/<slug>`).
- `story.png` na mesma pasta: PNG 1080×1920. `feed.png`: 1080×1350.
- Item em `agendamentos.json`: `pasta, horario (ISO, UTC, sem fuso), status (publicado|erro|cancelado|publicado_parcial|pendente|agendado), noticia_url, story_ok, threads_ok, facebook_ok, feed_only, publicado_em, ...`.
- Para o PC, só viajam: `numero`, `data` (DD.MM), `url`, bytes da imagem; e para o canal, só `url`.

## Contrato proposto para a reimplementação (SUPOSIÇÃO de desenho, derivada do acima)
Um JSON por notícia, enviado ao seu serviço:

```json
{
  "id": "exemplo-slug-da-noticia",
  "titulo": "Título de exemplo da notícia",
  "url": "https://msconecta.com.br/noticia/exemplo-slug-da-noticia",
  "slug": "exemplo-slug-da-noticia",
  "story_imagem": "story.png",
  "story_imagem_base64": null,
  "horario_utc": "2026-10-26T15:30:00",
  "acoes": ["story", "canal"]
}
```
- `id`: igual a `slug`; chave de idempotência.
- `url`: obrigatória.
- `story_imagem`: caminho local **ou** `story_imagem_base64` (um dos dois, se `acoes` contém `story`).
- `horario_utc`: opcional; vazio = postar assim que a fila liberar. Sem fuso, interpretar como UTC; CG = UTC−4.
- `acoes`: subconjunto de `["story","canal"]`.
- `titulo`: só para log/alerta; não é postado.

## Validação (obrigatória)
| Campo | Regra |
|---|---|
| `url` | `^https://msconecta\.com\.br/noticia/[a-z0-9-]+$`, ≤ 300 caracteres, sem espaço |
| `slug` | `^[a-z0-9-]+$` e igual ao último trecho da `url` |
| `id` | igual a `slug` |
| `story_imagem` | arquivo existe, PNG/JPEG de fato (verificar magic bytes, não a extensão), 1080×1920, ≤ 8 MB |
| `horario_utc` | ISO 8601 válido, não mais de 24 h no passado |
| `acoes` | não vazio, só valores permitidos |

[NÃO CONFIRMADO] se todo slug real cumpre `[a-z0-9-]` (os vistos sim; acentos já saem removidos).
Rejeitar com `400` + motivo. Nunca registrar o corpo inteiro nos logs.

## Ledger (idempotência)
`estado.json` do Heitor: `{"<id>": {"story": "publicado|falhou", "canal": "publicado|falhou", "ts": "..."}}`. Gravar **antes** de tentar uma segunda vez e depois do sucesso. Reenvio de `id` com ação já `publicado` → `duplicado`, sem abrir navegador. O original faz isso para story/Threads/Facebook com `story_ok` etc. e **não** faz para o canal [FATO].

## Dados que NÃO devem ir no pacote nem nos JSON
Tokens, cookies, chat ids, URLs com credencial, `.env`.
