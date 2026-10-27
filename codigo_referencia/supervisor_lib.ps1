<#
============================================================================
CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\supervisor_lib.ps1
Varredura de segredos: 10 ocorrências do padrão token/chat_id neste arquivo —
TODAS são nomes de variável/parâmetro ou leitura de env var
($env:TELEGRAM_BOT_TOKEN, $env:TELEGRAM_CHAT_ID), nunca um valor hardcoded.
Nenhum dado sensível precisou ser mascarado.
============================================================================

O QUE É: biblioteca compartilhada, dot-sourced (". caminho\supervisor_lib.ps1")
por postar_story.ps1 e por outros scripts do projeto. Só a função
Send-AlertaTelegram é usada pelo fluxo de story; as outras (watchdog de
processo/porta) não são chamadas por postar_story.ps1, mas estão aqui porque
fazem parte do mesmo arquivo de origem.
#>

function Write-LogEstruturado {
    # Grava uma linha "timestamp [NIVEL] mensagem" no arquivo de log indicado,
    # criando o diretório se não existir.
    param(
        [Parameter(Mandatory = $true)][string]$Arquivo,
        [Parameter(Mandatory = $true)][ValidateSet("INFO", "AVISO", "TIMEOUT", "ERRO", "RESOLVIDO")]
        [string]$Nivel,
        [Parameter(Mandatory = $true)][string]$Mensagem
    )
    $dir = Split-Path -Path $Arquivo -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $Arquivo -Value "$timestamp [$Nivel] $Mensagem"
}

function Invoke-ComTimeout {
    # Executa qualquer scriptblock com timeout via Start-Job + Wait-Job, para
    # NUNCA ficar pendurado indefinidamente — é o mecanismo que garante que
    # Send-AlertaTelegram (abaixo) não trava o script chamador se a API do
    # Telegram não responder.
    param(
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock,
        [int]$TimeoutSegundos = 20,
        [string]$NomeOperacao = "operacao",
        [object[]]$ArgumentList = @(),
        [string]$LogFile
    )

    $job = Start-Job -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList
    $concluiuNoPrazo = Wait-Job -Job $job -Timeout $TimeoutSegundos

    if ($null -eq $concluiuNoPrazo) {
        if ($LogFile) {
            Write-LogEstruturado -Arquivo $LogFile -Nivel "TIMEOUT" -Mensagem "'$NomeOperacao' nao respondeu em $TimeoutSegundos segundos - job abortado."
        }
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        return [PSCustomObject]@{ Sucesso = $false; TimedOut = $true; Saida = $null }
    }

    $saida = Receive-Job -Job $job -ErrorAction SilentlyContinue
    $teveErro = ($job.State -eq 'Failed')
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

    if ($LogFile) {
        $nivel = if ($teveErro) { "ERRO" } else { "INFO" }
        Write-LogEstruturado -Arquivo $LogFile -Nivel $nivel -Mensagem "'$NomeOperacao' concluido dentro do timeout de $TimeoutSegundos s (Falhou=$teveErro)."
    }
    return [PSCustomObject]@{ Sucesso = (-not $teveErro); TimedOut = $false; Saida = $saida }
}

# (Test-IdentidadeProcesso omitida neste excerpt — usada por
# process_watchdog.ps1/boot_reconciliation.ps1 para supervisão de portas,
# não é chamada pelo fluxo de story/canal. Ver arquivo original se precisar.)

function Send-AlertaTelegram {
    # Envia uma mensagem de alerta via Bot do Telegram. Token e chat id SEMPRE
    # lidos de variável de ambiente — se não estiverem configurados no
    # processo que chama esta função, retorna $false silenciosamente (não é
    # erro fatal, só significa que ninguém será notificado).
    # A chamada HTTP roda dentro de Invoke-ComTimeout (acima), então nunca
    # trava o script chamador (postar_story.ps1) indefinidamente.
    param(
        [Parameter(Mandatory = $true)][string]$Mensagem,
        [int]$TimeoutSegundos = 15,
        [string]$LogFile
    )

    $token = $env:TELEGRAM_BOT_TOKEN
    $chatId = $env:TELEGRAM_CHAT_ID

    if (-not $token -or -not $chatId) {
        if ($LogFile) {
            Write-LogEstruturado -Arquivo $LogFile -Nivel "AVISO" -Mensagem "Send-AlertaTelegram: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID nao configurados - alerta nao enviado."
        }
        return $false
    }

    $resultado = Invoke-ComTimeout -TimeoutSegundos $TimeoutSegundos -NomeOperacao "Send-AlertaTelegram" -LogFile $LogFile -ArgumentList @($token, $chatId, $Mensagem) -ScriptBlock {
        param($Token, $ChatId, $Texto)
        $uri = "https://api.telegram.org/bot$Token/sendMessage"
        Invoke-RestMethod -Uri $uri -Method Post -Body @{ chat_id = $ChatId; text = $Texto } -TimeoutSec 10 | Out-Null
    }

    return ($resultado.Sucesso -and (-not $resultado.TimedOut))
}
