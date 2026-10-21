<#
.SYNOPSIS
    Compila uma arvore descompilada do Desktop Goose v0.31 e executa o jogo
    em uma copia temporaria, sem alterar a instalacao original.

.DESCRIPTION
    Este script faz parte do repositorio publico de analise. Ele NAO inclui o
    jogo, os assets nem o codigo descompilado: voce precisa apontar para uma
    copia legal do jogo e para a sua propria arvore descompilada.

    Etapas:
    - instala/usa o .NET SDK local em %TEMP%\dotnet-sdk;
    - gera GooseDesktop.Properties.Resources.resources a partir de Pat1..Pat3;
    - restaura e compila o projeto net452 em Release;
    - copia Assets/, config.ini e o exe para %TEMP%\opencode\goose-decompiled-run;
    - executa o jogo a partir dessa copia.

.PARAMETER GameRoot
    Pasta da instalacao do jogo que contem Assets/ e config.ini.

.PARAMETER DecompiledRoot
    Pasta que contem GooseDesktop.csproj, Pat1, Pat2 e Pat3 (arvore gerada
    pelo ILSpy).

.PARAMETER Seconds
    Se maior que zero, executa o jogo por N segundos e encerra o processo.
    Sem esse parametro, o jogo fica aberto ate ser fechado (segure ESC).

.PARAMETER NoBuild
    Pula restore/build e usa o binario ja compilado em bin\Release\net452.

.EXAMPLE
    .\tools\compilar_e_rodar.ps1 `
      -GameRoot "C:\Goose\DesktopGoose v0.31" `
      -DecompiledRoot "C:\Goose\decompilado\GooseDesktop"

.EXAMPLE
    .\tools\compilar_e_rodar.ps1 `
      -GameRoot "C:\Goose\DesktopGoose v0.31" `
      -DecompiledRoot "C:\Goose\decompilado\GooseDesktop" `
      -Seconds 6
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GameRoot,

    [Parameter(Mandatory = $true)]
    [string]$DecompiledRoot,

    [int]$Seconds = 0,

    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$gameRoot = (Resolve-Path $GameRoot).Path
$decompiledRoot = (Resolve-Path $DecompiledRoot).Path
$proj = Join-Path $decompiledRoot 'GooseDesktop.csproj'
$buildDir = Join-Path $decompiledRoot 'bin\Release\net452'
$stage = Join-Path $env:TEMP 'opencode\goose-decompiled-run'

if (-not (Test-Path (Join-Path $gameRoot 'Assets'))) {
    throw "GameRoot nao contem Assets/: $gameRoot"
}
if (-not (Test-Path (Join-Path $gameRoot 'config.ini'))) {
    throw "GameRoot nao contem config.ini: $gameRoot"
}
if (-not (Test-Path $proj)) {
    throw "DecompiledRoot nao contem GooseDesktop.csproj: $decompiledRoot"
}

function Get-DotNetSdk {
    $candidates = @()
    $candidates += (Join-Path $env:TEMP 'dotnet-sdk\dotnet.exe')
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }

    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate)) { continue }
        $sdks = & $candidate --list-sdks 2>$null
        if ($LASTEXITCODE -eq 0 -and ($sdks -match '^10\.')) { return $candidate }
    }
    return $null
}

$dotnet = Get-DotNetSdk
if (-not $dotnet) {
    Write-Host 'Nenhum .NET SDK encontrado. Instalando o SDK 10 em %TEMP%\dotnet-sdk...' -ForegroundColor Yellow
    $installDir = Join-Path $env:TEMP 'dotnet-sdk'
    $installScript = Join-Path $env:TEMP 'dotnet-install.ps1'
    if (-not (Test-Path $installScript)) {
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installScript
    }
    & $installScript -Channel '10.0' -InstallDir $installDir -NoPath
    $dotnet = Join-Path $installDir 'dotnet.exe'
    if (-not (Test-Path $dotnet)) { throw 'Falha ao instalar o .NET SDK.' }
}

Write-Host "dotnet: $dotnet" -ForegroundColor DarkGray
$env:DOTNET_ROOT = Split-Path -Parent $dotnet
$env:PATH = "$env:DOTNET_ROOT;$env:PATH"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

# O ILSpy extrai Pat1..Pat3 como EmbeddedResource cru. O Resources.cs gerado
# usa ResourceManager("GooseDesktop.Properties.Resources").GetStream("Pat1"),
# que exige um container .resources com esses nomes.
$resFile = Join-Path $decompiledRoot 'GooseDesktop.Properties.Resources.resources'
if (-not (Test-Path $resFile)) {
    Write-Host 'Gerando GooseDesktop.Properties.Resources.resources...' -ForegroundColor Yellow
    foreach ($name in @('Pat1', 'Pat2', 'Pat3')) {
        $path = Join-Path $decompiledRoot $name
        if (-not (Test-Path $path)) { throw "Arquivo nao encontrado: $path" }
    }

    $writer = New-Object System.Resources.ResourceWriter($resFile)
    $streams = @()
    try {
        foreach ($name in @('Pat1', 'Pat2', 'Pat3')) {
            $ms = New-Object System.IO.MemoryStream(
                , [System.IO.File]::ReadAllBytes((Join-Path $decompiledRoot $name))
            )
            $streams += $ms
            $writer.AddResource($name, $ms)
        }
    }
    finally {
        $writer.Close()
        $streams | ForEach-Object { $_.Dispose() }
    }
}

# O ILSpy gera <EmbeddedResource Include="Pat1" LogicalName="Pat1" />.
# O Resources.cs espera um container .resources; troque os recursos crus
# pelo container para o ResourceManager encontrar Pat1..Pat3.
$projText = [System.IO.File]::ReadAllText($proj)
$newProjText = $projText -replace '(?m)^\s*<EmbeddedResource Include="Pat[123]" LogicalName="Pat[123]" />\s*\r?\n', ''
$projectChanged = $newProjText -ne $projText
if ($newProjText -notmatch 'GooseDesktop\.Properties\.Resources\.resources') {
    $newProjText = $newProjText -replace '</Project>', "  <ItemGroup>`r`n    <EmbeddedResource Include=`"GooseDesktop.Properties.Resources.resources`" LogicalName=`"GooseDesktop.Properties.Resources.resources`" />`r`n  </ItemGroup>`r`n</Project>"
    $projectChanged = $true
}
if ($projectChanged) {
    Write-Host 'Ajustando o .csproj para embutir GooseDesktop.Properties.Resources.resources...' -ForegroundColor Yellow
    [System.IO.File]::WriteAllText($proj, $newProjText, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not $NoBuild) {
    $assets = Join-Path $decompiledRoot 'obj\project.assets.json'
    $needsRestore = -not (Test-Path $assets)
    if (-not $needsRestore -and (Get-Item $proj).LastWriteTime -gt (Get-Item $assets).LastWriteTime) {
        $needsRestore = $true
    }
    if ($needsRestore) {
        Write-Host 'Restaurando pacotes (NuGet)...' -ForegroundColor Yellow
        & $dotnet restore $proj --source 'https://api.nuget.org/v3/index.json' | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Falha no restore do NuGet.' }
    }

    Write-Host 'Compilando...' -ForegroundColor Yellow
    & $dotnet build $proj -c Release --no-restore -v:minimal | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Falha na compilacao.' }
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item (Join-Path $gameRoot 'Assets') $stage -Recurse
Copy-Item (Join-Path $gameRoot 'config.ini') $stage
foreach ($file in @('Autumn.txt', 'patrons.txt')) {
    $src = Join-Path $gameRoot $file
    if (Test-Path $src) { Copy-Item $src $stage }
}
foreach ($file in @('GooseDesktop.exe', 'GooseModdingAPI.dll')) {
    $src = Join-Path $buildDir $file
    if (-not (Test-Path $src)) { throw "Arquivo de build nao encontrado: $src" }
    Copy-Item $src $stage
}
$config = Join-Path $buildDir 'GooseDesktop.exe.config'
if (Test-Path $config) { Copy-Item $config $stage }

Write-Host "Pasta de execucao: $stage" -ForegroundColor Cyan
$exe = Join-Path $stage 'GooseDesktop.exe'
$process = Start-Process -FilePath $exe -WorkingDirectory $stage -PassThru

if ($Seconds -gt 0) {
    Write-Host "Executando por $Seconds segundos (PID $($process.Id))..." -ForegroundColor Green
    Start-Sleep -Seconds $Seconds
    if ($process.HasExited) {
        Write-Host "O jogo saiu sozinho com codigo $($process.ExitCode)." -ForegroundColor Yellow
    }
    else {
        Stop-Process -Id $process.Id -Force
        Write-Host 'Processo encerrado pelo teste.' -ForegroundColor Green
    }
}
else {
    Write-Host "Goose rodando (PID $($process.Id)). Segure ESC por alguns segundos para sair." -ForegroundColor Green
}
