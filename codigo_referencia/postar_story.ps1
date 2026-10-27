<#
============================================================================
CÓPIA SANITIZADA para repasse (Heitor) — fonte original: C:\MSConecta\postar_story.ps1
Varredura de segredos: 0 ocorrências de token/senha/cookie/api-key/secret/chat_id
neste arquivo. 1 ocorrência de caminho com o usuário Windows do servidor
(parâmetro $BaseDir, linha abaixo) — MASCARADA para <PC_USER> por regra do
repasse. O caminho real está no servidor, não precisa estar neste documento.
============================================================================

O QUE É: NÃO é o story_poster_windows.py (esse está LEGADO, sem uso desde
08/06/2026 — ver 02_story_link_sticker.md). É o script que REALMENTE roda
hoje para postar story, acionado por servidor_publicador.js via
POST /postar-story (powershell.exe -File postar_story.ps1). É PowerShell +
UI Automation (cliques de mouse reais via Win32 SendInput / coordenadas de
tela) combinado com CDP via três helpers Node, todos incluídos neste pacote:
  - navegar_story.js       (navega até a URL do story composer)
  - find_btn_midia.js      (localiza o botão de mídia via CDP)
  - link_e_compartilhar.js (insere o link sticker e clica Compartilhar)
E uma lib compartilhada, dot-sourced no topo deste script:
  - supervisor_lib.ps1     (Send-AlertaTelegram, usada nos alertas abaixo)

Passo a passo completo (UI Automation, link sticker, requisitos de ambiente,
duração, taxa de falha) está em 02_story_link_sticker.md — este arquivo é o
código-fonte comentado bloco a bloco; o .md é a referência de leitura corrida.
#>

param(
    [Parameter(Mandatory=$true)]
    [int]$Numero,
    [string]$Data = (Get-Date -Format "dd.MM"),
    [string]$UrlNoticia = "",
    [string]$BaseDir = "C:\Users\<PC_USER>\Desktop\Postagens MSConecta",
    [string]$BusinessSuiteUrl = "https://business.facebook.com/latest/story_composer/?asset_id=101692131964637&business_id=827179250980492",
    [int]$TimeoutDialogo = 90
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

. "C:\MSConecta\supervisor_lib.ps1"   # funcoes compartilhadas: Send-AlertaTelegram, etc.

$DetailLogFile = "C:\MSConecta\logs\postar_story_detail.log"
try { Start-Transcript -Path $DetailLogFile -Append -IncludeInvocationHeader | Out-Null } catch {}

# O dispatcher da VPS as vezes chama /postar-story mais de uma vez para a MESMA
# noticia (numero+data) quando a primeira chamada demora a responder - isso faz
# 2-3 processos deste script rodarem "ao mesmo tempo" disputando o mesmo Chrome,
# e OS PERDEDORES dessa corrida falham normalmente (dialog nao apareceu / link nao
# confirmado) mesmo quando um dos processos JA publicou a noticia com sucesso.
# Sem essa checagem, cada perdedor dispara um alerta Telegram de "story NAO
# publicado" mesmo a noticia tendo sido publicada por outro processo - alarme
# falso. Marcador simples em disco resolve: quem publica com sucesso grava um
# arquivo; quem falha espera um instante e confere antes de alertar de verdade.
#
# NOTA PARA O REPASSE: isso é a causa mais provável de a taxa de "exit != 0"
# medida no log bruto (ver .md) ser bem mais alta para story do que para canal
# — o canal não tem essa lógica de corrida porque a VPS não dispara /postar-canal
# em duplicata da mesma forma observada para /postar-story.
$MarkerDir = "C:\MSConecta\tmp\story_ok"
if (-not (Test-Path $MarkerDir)) { New-Item -ItemType Directory -Path $MarkerDir -Force | Out-Null }
$MarkerFile = Join-Path $MarkerDir "NOTICIA$($Numero)_$($Data -replace '[^\w.-]','_').ok"
try {
    Get-ChildItem $MarkerDir -Filter "*.ok" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-2) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch {}

function Alertar-SeNaoPublicado {
    param([string]$Mensagem)
    for ($i = 0; $i -lt 18; $i++) {
        if (Test-Path $MarkerFile) {
            Write-Host "Outro processo concorrente ja publicou NOTICIA$Numero de $Data com sucesso - alerta suprimido (falha era so a corrida perdida)." -ForegroundColor Yellow
            return
        }
        Start-Sleep -Seconds 5
    }
    Send-AlertaTelegram -Mensagem $Mensagem -LogFile "C:\MSConecta\logs\postar_story_alertas.log" | Out-Null
}

# P/Invoke minimo para foco de janela e cliques de mouse sinteticos (SO real,
# diferente do CDP usado no canal, que injeta evento direto no renderer).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAuto {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(150);
        mouse_event(0x0002, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(100);
        mouse_event(0x0004, 0, 0, 0, 0);
    }
}
"@

$ChromeDebugPort = 9222
$ChromeUserData  = "C:\MSConecta\chrome-cms-agent"   # perfil Chrome dedicado a automacao (NAO abrir/copiar esta pasta)
$ChromeProfile   = "Default"
$ChromeExe       = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $ChromeExe)) {
    $ChromeExe = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
}

function Take-Screenshot {
    param([string]$Path)
    try {
        $sw = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
        $sh = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
        $bmp = New-Object System.Drawing.Bitmap($sw, $sh)
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen([System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::Empty, [System.Drawing.Size]::new($sw, $sh))
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        $gfx.Dispose(); $bmp.Dispose()
        Write-Host "Screenshot: $Path" -ForegroundColor Cyan
    } catch { Write-Host "Screenshot falhou: $_" -ForegroundColor Red }
}

function Test-CDP {
    try {
        $tabs = Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json" -TimeoutSec 3 -ErrorAction Stop
        return $tabs
    } catch {
        return $null
    }
}

# Garante que o Chrome rodando é o perfil "chrome-cms-agent" com CDP ativo —
# um Chrome com CDP ativo mas perfil ERRADO é tao ruim quanto sem CDP (sessao
# errada = sem login no Meta Business Suite).
function Start-ChromeCorreto {
    Write-Host "Iniciando Chrome com perfil cms-agent e CDP..." -ForegroundColor Yellow
    $argList = "--remote-debugging-port=$ChromeDebugPort --remote-allow-origins=* --user-data-dir=`"$ChromeUserData`" --profile-directory=$ChromeProfile --no-first-run --no-default-browser-check `"$BusinessSuiteUrl`""
    Start-Process $ChromeExe -ArgumentList $argList
    Write-Host "Aguardando Chrome iniciar (15s)..." -ForegroundColor Gray
    Start-Sleep -Seconds 15
    for ($i = 1; $i -le 10; $i++) {
        if ($null -ne (Test-CDP)) {
            Write-Host "CDP ativo! ($i tentativa)" -ForegroundColor Green
            return $true
        }
        Write-Host "  CDP aguardando ($i/10)..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 3
    }
    Write-Host "AVISO: CDP nao ficou disponivel apos reinicio." -ForegroundColor Yellow
    return $false
}

function Garantir-ChromeCorreto {
    $perfilErrado = $false
    try {
        $proc = Get-WmiObject Win32_Process -Filter "Name='chrome.exe'" |
                Where-Object { $_.CommandLine -and $_.CommandLine.Length -gt 50 -and $_.CommandLine -notlike "*chrome-cms-agent*" -and $_.CommandLine -like "*chrome.exe`"*" } |
                Select-Object -First 1
        if ($proc) {
            $perfilErrado = $true
            Write-Host "Chrome rodando com perfil ERRADO (nao e chrome-cms-agent): $($proc.CommandLine.Substring(0,[Math]::Min(120,$proc.CommandLine.Length)))" -ForegroundColor Yellow
        }
    } catch {}

    if (-not $perfilErrado -and $null -ne (Test-CDP)) {
        Write-Host "Chrome com CDP ativo e perfil correto. OK!" -ForegroundColor Green
        return $true
    }

    $chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue
    if ($chromeProcs) {
        if ($perfilErrado) {
            Write-Host "Reiniciando Chrome: substituindo perfil errado por chrome-cms-agent..." -ForegroundColor Yellow
        } else {
            Write-Host "Chrome rodando mas sem CDP. Reiniciando com flags corretos..." -ForegroundColor Yellow
        }
        Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
    }

    return Start-ChromeCorreto
}

# Fecha abas que não são do fluxo MSConecta/Meta — evita que abas "lixo"
# acumuladas confundam os scripts de localizar elemento por CDP.
function Fechar-AbasExtras {
    $tabs = Test-CDP
    if ($null -eq $tabs) { return }
    $fechar = $tabs | Where-Object {
        $_.type -eq "page" -and
        $_.url -notmatch "facebook\.com|instagram\.com|meta\.com|business\.facebook|msconecta\.com\.br|whatsapp\.com" -and
        $_.url -notmatch "^chrome"
    }
    foreach ($tab in $fechar) {
        try {
            Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json/close/$($tab.id)" -EA SilentlyContinue | Out-Null
            Write-Host "Aba fechada via CDP: $($tab.url.Substring(0,[Math]::Min(60,$tab.url.Length)))" -ForegroundColor DarkGray
        } catch {}
    }
}

# Coordenadas de tela FIXAS usadas como fallback quando a localização via CDP
# falha (layout da pagina as vezes muda a posicao real do botao).
$btnAdicionarFotoX  = 732
$btnAdicionarFotoYs = @(527, 523, 531, 520, 535, 515, 540, 545)
$btnAdicionarLink   = @{ X = 953;  Y = 442 }
$campoUrl           = @{ X = 660;  Y = 385 }
$btnAplicar         = @{ X = 1296; Y = 876 }
$btnCompartilhar    = @{ X = 1530; Y = 920 }

$FilePath = "$BaseDir\$Data\NOTICIA$Numero-STORY.jpeg"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host " MSConecta - Postar Story v4 (CDP)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Noticia: $Numero | Data: $Data"
Write-Host "Arquivo: $FilePath" -ForegroundColor Yellow
if ($UrlNoticia) { Write-Host "URL: $UrlNoticia" -ForegroundColor Yellow }
Write-Host ""

if (-not (Test-Path $FilePath)) {
    Write-Host "ERRO: Arquivo nao encontrado: $FilePath" -ForegroundColor Red; exit 1
}
Write-Host "Arquivo encontrado. OK!" -ForegroundColor Green

Write-Host "Verificando Chrome (CDP)..." -ForegroundColor Cyan
Garantir-ChromeCorreto | Out-Null
Fechar-AbasExtras

$root = [System.Windows.Automation.AutomationElement]::RootElement

function Find-ChromeWindow {
    $titulos = @("Meta Business Suite - Google Chrome","Criador de stories - Google Chrome","Story Creator - Google Chrome","business.facebook.com - Google Chrome")
    foreach ($t in $titulos) {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $t)
        $w = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
        if ($w) { Write-Host "Chrome: $t" -ForegroundColor Green; return $w }
    }
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $all) {
        if ($w.Current.Name -like "*Google Chrome*" -or $w.Current.Name -like "*Chrome*") {
            Write-Host "Chrome (busca ampla): $($w.Current.Name)" -ForegroundColor Yellow; return $w
        }
    }
    return $null
}

Write-Host "Procurando Chrome na UI..." -ForegroundColor Cyan
$chromeWin = Find-ChromeWindow
if (-not $chromeWin) {
    Write-Host "Chrome nao encontrado. Aguardando 10s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    $chromeWin = Find-ChromeWindow
}

if (-not $chromeWin) {
    Write-Host "ERRO: Janela do Chrome nao encontrada." -ForegroundColor Red; exit 1
}

$hwndChrome = [IntPtr]$chromeWin.Current.NativeWindowHandle
[WinAuto]::ShowWindow($hwndChrome, 3) | Out-Null
Start-Sleep -Seconds 1
[WinAuto]::SetForegroundWindow($hwndChrome) | Out-Null
Start-Sleep -Seconds 1
Write-Host "Chrome em foco. Navegando para story creator via CDP..." -ForegroundColor Green

# Helper Node (CDP) para navegar sem depender de foco/clique de teclado —
# so cai no fallback de SendKeys se o CDP falhar.
$navOut = & node "C:\MSConecta\navegar_story.js" $BusinessSuiteUrl 2>&1
$navOut | ForEach-Object { Write-Host "  [nav] $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
    Write-Host "AVISO: navegar_story.js falhou - tentando navegacao via teclado como fallback" -ForegroundColor Yellow
    [WinAuto]::SetForegroundWindow($hwndChrome) | Out-Null
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 600
    [System.Windows.Forms.Clipboard]::SetText($BusinessSuiteUrl)
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Seconds 20
}

Write-Host "Pagina carregada. Focando Chrome..." -ForegroundColor Green
[WinAuto]::SetForegroundWindow($hwndChrome) | Out-Null
Start-Sleep -Seconds 2
Take-Screenshot "C:\MSConecta\screenshot_chrome_loaded.png"

# Checagem crítica de SESSAO: se a aba do Meta Business Suite caiu para
# pagina de login/checkpoint, NAO ha como continuar automaticamente — exige
# login manual. Esse e o unico ponto de falha que depende de intervencao humana.
$tabs = Test-CDP
if ($tabs) {
    $tabMeta = $tabs | Where-Object { $_.url -like "*facebook.com*" -or $_.url -like "*meta.com*" } | Select-Object -First 1
    if ($tabMeta -and ($tabMeta.url -like "*login*" -or $tabMeta.url -like "*checkpoint*")) {
        Write-Host "ERRO: Chrome mostrando pagina de LOGIN! Sessao expirada." -ForegroundColor Red
        Write-Host "URL atual: $($tabMeta.url)" -ForegroundColor Yellow
        Write-Host "Acao necessaria: fazer login manualmente no Meta Business Suite." -ForegroundColor Yellow
        Take-Screenshot "C:\MSConecta\screenshot_sessao_expirada.png"
        Send-AlertaTelegram -Mensagem "MSConecta: story NOTICIA$Numero de $Data NAO foi publicado - sessao do Meta Business Suite expirou (pagina de login). E preciso fazer login manualmente no Chrome (perfil chrome-cms-agent) para as proximas stories voltarem a publicar." -LogFile "C:\MSConecta\logs\postar_story_alertas.log" | Out-Null
        try { Stop-Transcript | Out-Null } catch {}
        exit 2
    }
}

# Fechar qualquer dialog de arquivo que esteja aberto (stale de execucao anterior)
$hStale = [WinAuto]::FindWindow("#32770", "Abrir")
if ($hStale -eq [IntPtr]::Zero) { $hStale = [WinAuto]::FindWindow("#32770", "Open") }
if ($hStale -ne [IntPtr]::Zero) {
    Write-Host "Dialog stale detectado - fechando antes de clicar..." -ForegroundColor Yellow
    [WinAuto]::SetForegroundWindow($hStale) | Out-Null
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 800
}

# Descobrir posicao atual do botao "Adicionar foto/video" via CDP (posicao muda conforme estado da pagina)
Write-Host "Localizando botao de midia via CDP..." -ForegroundColor Cyan
$btnPosJson = (& node "C:\MSConecta\find_btn_midia.js" 2>$null) -join ""

$btnScreenX = $btnAdicionarFotoX
$btnScreenY = $btnAdicionarFotoYs[0]
if ($btnPosJson -and $btnPosJson -ne "null") {
    try {
        $btnPos = $btnPosJson | ConvertFrom-Json
        $btnScreenX = $btnPos.vpX
        $btnScreenY = $btnPos.vpY + 87
        Write-Host "Botao midia encontrado via CDP: VP($($btnPos.vpX),$($btnPos.vpY)) -> Screen($btnScreenX,$btnScreenY)" -ForegroundColor Green
    } catch {
        Write-Host "Usando coordenadas fallback: Screen($btnScreenX,$btnScreenY)" -ForegroundColor Yellow
    }
} else {
    Write-Host "CDP nao encontrou botao - usando coordenadas fixas: Screen($btnScreenX,$btnScreenY)" -ForegroundColor Yellow
}

# Clicar no botao de adicionar midia e aguardar dialog de arquivo
Write-Host "Clicando botao de midia ($btnScreenX, $btnScreenY)..." -ForegroundColor Cyan
[WinAuto]::SetForegroundWindow($hwndChrome) | Out-Null
Start-Sleep -Milliseconds 800
[WinAuto]::Click($btnScreenX, $btnScreenY)

# Aguardar dialog NOVO nativo Windows (ate 30s) — ignora dialog que aparece em menos de 500ms (pode ser stale)
Write-Host "Aguardando dialog de arquivo (30s max)..." -ForegroundColor Cyan
$hwndDialog = [IntPtr]::Zero
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 30) {
    Start-Sleep -Milliseconds 300
    $h = [WinAuto]::FindWindow("#32770", "Abrir")
    if ($h -eq [IntPtr]::Zero) { $h = [WinAuto]::FindWindow("#32770", "Open") }
    if ($h -ne [IntPtr]::Zero) { $hwndDialog = $h; break }
    if ([int]($sw.Elapsed.TotalSeconds) % 5 -eq 0 -and $sw.Elapsed.TotalMilliseconds -gt 1000) {
        Write-Host "  Aguardando... $([int]$sw.Elapsed.TotalSeconds)s" -ForegroundColor DarkGray
    }
}

if ($hwndDialog -eq [IntPtr]::Zero) {
    Write-Host "ERRO: Dialog de arquivo nao apareceu em 30s." -ForegroundColor Red
    Take-Screenshot "C:\MSConecta\screenshot_nodialog.png"
    Alertar-SeNaoPublicado "MSConecta: falha ao postar story NOTICIA$Numero de $Data - dialogo de upload de arquivo nao apareceu. Story NAO foi publicado. Verificar Chrome/Meta Business Suite manualmente."
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

Write-Host "Dialog encontrado em $([int]$sw.Elapsed.TotalSeconds)s!" -ForegroundColor Green
Start-Sleep -Milliseconds 800
[WinAuto]::ShowWindow($hwndDialog, 9) | Out-Null
Start-Sleep -Milliseconds 500
[WinAuto]::SetForegroundWindow($hwndDialog) | Out-Null
Start-Sleep -Milliseconds 800

# Cola o caminho completo do arquivo no campo "Nome" do dialog de upload
# (via clipboard, nao digitando char a char) e confirma com Enter.
$dialogEl = [System.Windows.Automation.AutomationElement]::FromHandle($hwndDialog)
$condEdit = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$edits = $dialogEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condEdit)
$nameEdit = $null
foreach ($e in $edits) { if ($e.Current.AutomationId -eq "1148") { $nameEdit = $e; break } }
if (-not $nameEdit -and $edits.Count -gt 0) { $nameEdit = $edits[0] }
if ($nameEdit) {
    try { $nameEdit.SetFocus() } catch {}
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.Clipboard]::SetText($FilePath)
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 400
}
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Host "Arquivo selecionado. Aguardando preview (12s)..." -ForegroundColor Cyan
Start-Sleep -Seconds 12
Take-Screenshot "C:\MSConecta\screenshot_pos_upload.png"
Take-Screenshot "C:\MSConecta\screenshot_antes_link_compartilhar.png"

# Etapa final: adicionar o sticker de link (se $UrlNoticia foi passado) e
# clicar "Compartilhar" — delegado a outro helper Node via CDP, que localiza
# os elementos por texto/atributo (fora deste pacote, especifico de story).
Write-Host "Executando link_e_compartilhar.js via CDP..." -ForegroundColor Cyan
[WinAuto]::SetForegroundWindow($hwndChrome) | Out-Null
Start-Sleep -Milliseconds 500

$nodeArgs = @("C:\MSConecta\link_e_compartilhar.js")
if ($UrlNoticia) { $nodeArgs += $UrlNoticia }

$nodeOut = & node @nodeArgs 2>&1
$nodeOut | ForEach-Object { Write-Host "  [node] $_" -ForegroundColor DarkCyan }

$nodeExitCode = $LASTEXITCODE
Take-Screenshot "C:\MSConecta\screenshot_pos_compartilhar.png"

if ($nodeExitCode -ne 0) {
    Write-Host "ERRO: link_e_compartilhar.js falhou (exit $nodeExitCode)" -ForegroundColor Red
    $motivo = if ($UrlNoticia) { "o link sticker nao pode ser confirmado apos varias tentativas" } else { "o botao Compartilhar nao foi encontrado" }
    Alertar-SeNaoPublicado "MSConecta: story NOTICIA$Numero de $Data NAO foi publicado - $motivo. Publicar manualmente no Instagram."
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# So grava o marcador de sucesso (usado pela checagem anti-alarme-falso acima) depois de confirmado.
try { Set-Content -Path $MarkerFile -Value (Get-Date -Format "o") -Force } catch {}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host " Story publicado! NOTICIA$Numero de $Data" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
try { Stop-Transcript | Out-Null } catch {}
