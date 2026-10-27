# REFERENCIA. FATO: listener existente na VPS; NAO tem a rota /postar-canal (existe no PC, codigo ausente).
# Sem autenticacao: so e seguro dentro da rede privada (Tailscale).
# story_listener_novo.ps1
# Servidor HTTP no Windows — recebe e posta stories no Instagram
# Salvar em: <CAMINHO>
# Executar: powershell -ExecutionPolicy Bypass -File <CAMINHO>\story_listener_novo.ps1
# Manter rodando em segundo plano com: Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File <CAMINHO>\story_listener_novo.ps1" -WindowStyle Hidden

$ErrorActionPreference = "Continue"
$PORTA  = 8765
$BASE   = "<PASTA_BASE>"
$SCRIPT = "<CAMINHO>\story_poster_windows.py"
$LOG    = "<CAMINHO>\listener.log"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Tee-Object -FilePath $LOG -Append | Write-Host
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$PORTA/")
$listener.Start()
Write-Log "Listener ativo em http://+:$PORTA/"

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response
    $resp.ContentType = "application/json"

    $path   = $req.Url.AbsolutePath
    $method = $req.HttpMethod
    Write-Log "$method $path"

    # ── /status ──────────────────────────────────────────────────────
    if ($path -eq "/status") {
        $body = '{"ok":true,"status":"listener ativo"}'

    # ── /receber-story ───────────────────────────────────────────────
    } elseif ($path -eq "/receber-story" -and $method -eq "POST") {
        $num  = $req.Headers["X-Numero"]
        $data = $req.Headers["X-Data"]
        if (-not $num -or -not $data) {
            $resp.StatusCode = 400
            $body = '{"ok":false,"erro":"Headers X-Numero e X-Data obrigatorios"}'
        } else {
            $pasta = "$BASE\$data"
            if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta | Out-Null }
            $arquivo = "$pasta\NOTICIA$num-STORY.jpeg"
            $buf = [System.IO.MemoryStream]::new()
            $req.InputStream.CopyTo($buf)
            [System.IO.File]::WriteAllBytes($arquivo, $buf.ToArray())
            Write-Log "Arquivo salvo: $arquivo ($($buf.Length) bytes)"
            $body = "{`"ok`":true,`"arquivo`":`"$arquivo`"}"
        }

    # ── /postar-story ────────────────────────────────────────────────
    } elseif ($path -eq "/postar-story" -and $method -eq "POST") {
        $buf = [System.IO.StreamReader]::new($req.InputStream)
        $json = $buf.ReadToEnd() | ConvertFrom-Json

        $num  = $json.numero
        $data = $json.data
        $url  = $json.url

        if (-not $num) {
            $resp.StatusCode = 400
            $body = '{"ok":false,"erro":"Campo numero obrigatorio"}'
        } else {
            $storyPath = "$BASE\$data\NOTICIA$num-STORY.jpeg"
            Write-Log "Acionando story NOTICIA$num — arquivo: $storyPath"
            Write-Log "Link: $url"

            if (-not (Test-Path $storyPath)) {
                Write-Log "ERRO: arquivo nao encontrado em $storyPath"
                $body = "{`"ok`":false,`"erro`":`"Arquivo nao encontrado: $storyPath`"}"
            } elseif (-not (Test-Path $SCRIPT)) {
                Write-Log "ERRO: script Python nao encontrado em $SCRIPT"
                $body = "{`"ok`":false,`"erro`":`"Script Python nao encontrado: $SCRIPT`"}"
            } else {
                # Disparar automação em processo separado (não bloqueia o servidor)
                $args = "--numero $num --data $data --link `"$url`" --story `"$storyPath`""
                $proc = Start-Process -FilePath "python" `
                    -ArgumentList "$SCRIPT $args" `
                    -NoNewWindow -PassThru `
                    -RedirectStandardOutput "$BASE\$data\story_log_$num.txt" `
                    -RedirectStandardError  "$BASE\$data\story_err_$num.txt"
                Write-Log "Processo iniciado PID=$($proc.Id)"
                $body = "{`"ok`":true,`"mensagem`":`"Story NOTICIA$num iniciado PID=$($proc.Id)`"}"
            }
        }

    # ── rota desconhecida ─────────────────────────────────────────────
    } else {
        $resp.StatusCode = 404
        $body = '{"ok":false,"erro":"Rota nao encontrada"}'
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    $resp.OutputStream.Close()
}
