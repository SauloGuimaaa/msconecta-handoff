# REFERENCIA: disparo lado VPS (upload do arquivo + POST /postar-story, 3 tentativas, 5s entre elas).
#!/bin/bash
# postar_story_vps.sh
# Uso (publicacao imediata):
#   bash /root/msconecta/postar_story_vps.sh <numero> <data> <url> <caminho_story>
# Uso (agendado via 'at' no Windows):
#   bash /root/msconecta/postar_story_vps.sh <numero> <data> <url> <caminho_story> <horario_utc>

NUMERO=$1
DATA=${2:-$(date +"%d.%m")}
URL_NOTICIA=${3:-""}
STORY_PATH=${4:-""}
HORARIO_UTC=${5:-""}
WINDOWS_IP="<IP_DO_PC_SERVIDOR>"
PORT=8765

if [ -z "$NUMERO" ]; then
    echo "Uso: $0 <numero> [data] [url] [caminho_story] [horario_utc]"
    exit 1
fi

# PASSO 1: Enviar o arquivo JPEG para o Windows (com retry)
if [ -n "$STORY_PATH" ] && [ -f "$STORY_PATH" ]; then
    echo "Enviando arquivo para o Windows..."
    RESPONSE_FILE=""
    for TENTATIVA in 1 2 3; do
        RESPONSE_FILE=$(curl -s -X POST "http://$WINDOWS_IP:$PORT/receber-story"             -H "X-Numero: $NUMERO"             -H "X-Data: $DATA"             -H "Content-Type: image/jpeg"             --data-binary "@$STORY_PATH"             --connect-timeout 15             --max-time 30)
        if echo "$RESPONSE_FILE" | grep -q '"ok":true'; then
            echo "Arquivo enviado (tentativa $TENTATIVA)!"
            echo "$RESPONSE_FILE"
            break
        fi
        if [ $TENTATIVA -lt 3 ]; then
            echo "Tentativa $TENTATIVA falhou ($RESPONSE_FILE) — aguardando 5s..."
            sleep 5
        fi
    done
    if ! echo "$RESPONSE_FILE" | grep -q '"ok":true'; then
        echo "ERRO ao enviar arquivo apos 3 tentativas: $RESPONSE_FILE"
        exit 1
    fi
    sleep 1
else
    if [ -n "$STORY_PATH" ]; then
        echo "AVISO: Arquivo nao encontrado em $STORY_PATH — pulando envio."
    else
        echo "Sem caminho de arquivo — assumindo que ja esta no Windows."
    fi
fi

# PASSO 2: Acionar/agendar o script de publicacao no Windows (com retry)
PAYLOAD="{\"numero\": $NUMERO, \"data\": \"$DATA\", \"url\": \"$URL_NOTICIA\"}"

if [ -n "$HORARIO_UTC" ]; then
    HORA_CG=$(python3 -c "
from datetime import datetime, timedelta
h = datetime.fromisoformat('${HORARIO_UTC}'.replace('Z',''))
h_cg = h - timedelta(hours=4)
print(f'{h_cg.hour:02d}:{h_cg.minute:02d}')
")
    echo "Agendando story para $HORA_CG (Campo Grande) via 'at' no Windows..."
    PAYLOAD_AGENDADO="{\"numero\": $NUMERO, \"data\": \"$DATA\", \"url\": \"$URL_NOTICIA\", \"agendar\": true, \"horario\": \"$HORA_CG\"}"

    RESPONSE=""
    for TENTATIVA in 1 2 3; do
        RESPONSE=$(curl -s -X POST "http://$WINDOWS_IP:$PORT/postar-story"             -H "Content-Type: application/json"             -d "$PAYLOAD_AGENDADO"             --connect-timeout 10             --max-time 20)
        if echo "$RESPONSE" | grep -q '"ok":true'; then
            echo "Story AGENDADO com sucesso para $HORA_CG via Windows!"
            echo "$RESPONSE"
            break
        fi
        if [ $TENTATIVA -lt 3 ]; then
            echo "Tentativa $TENTATIVA falhou ($RESPONSE) — aguardando 5s..."
            sleep 5
        fi
    done
    if ! echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "ERRO: Windows nao respondeu apos 3 tentativas ($RESPONSE). Story NAO agendado!"
        exit 1
    fi
else
    echo "Publicando story imediatamente no Windows..."
    RESPONSE=""
    for TENTATIVA in 1 2 3; do
        RESPONSE=$(curl -s -X POST "http://$WINDOWS_IP:$PORT/postar-story"             -H "Content-Type: application/json"             -d "$PAYLOAD"             --connect-timeout 10             --max-time 20)
        if echo "$RESPONSE" | grep -q '"ok":true'; then
            echo "Story acionado com sucesso (tentativa $TENTATIVA)!"
            echo "$RESPONSE"
            break
        fi
        if [ $TENTATIVA -lt 3 ]; then
            echo "Tentativa $TENTATIVA falhou ($RESPONSE) — aguardando 5s..."
            sleep 5
        fi
    done
    if ! echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "ERRO ao acionar story apos 3 tentativas: $RESPONSE"
        exit 1
    fi
fi
