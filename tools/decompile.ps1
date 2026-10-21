<#
.SYNOPSIS
    Decompila uma copia legal do Desktop Goose v0.31 com ILSpy (ilspycmd).

.DESCRIPTION
    Este script faz parte do repositorio publico de analise. Ele NAO inclui o
    jogo nem o resultado da decompilacao. O resultado e uma obra derivada do
    software original: use apenas para estudo e nao redistribua.

    - baixa o pacote NuGet do ilspycmd para %TEMP%\ilspy;
    - decompila GooseDesktop.exe, GooseModdingAPI.dll, MMQ.dll e Autumn.dll;
    - copia GooseModdingAPI.dll para a pasta de saida e ajusta o HintPath do
      projeto para que o build funcione fora da pasta do jogo.

.PARAMETER GameRoot
    Pasta da instalacao do jogo que contem GooseDesktop.exe.

.PARAMETER OutDir
    Pasta de saida da arvore descompilada. Padrao:
    %TEMP%\goose-decompiled.

.EXAMPLE
    .\tools\decompile.ps1 -GameRoot "C:\Goose\DesktopGoose v0.31"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GameRoot,

    [string]$OutDir = (Join-Path $env:TEMP 'goose-decompiled')
)

$ErrorActionPreference = 'Stop'

$gameRoot = (Resolve-Path $GameRoot).Path
$exe = Join-Path $gameRoot 'GooseDesktop.exe'
if (-not (Test-Path $exe)) {
    throw "GameRoot nao contem GooseDesktop.exe: $gameRoot"
}

$out = $OutDir
$work = Join-Path $env:TEMP 'ilspy'
New-Item -ItemType Directory -Force -Path $work, $out | Out-Null

function Get-DotNet {
    $candidates = @()
    $candidates += (Join-Path $env:TEMP 'dotnet-sdk\dotnet.exe')
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }

    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate)) { continue }
        $runtimes = & $candidate --list-runtimes 2>$null
        if ($LASTEXITCODE -eq 0 -and ($runtimes -match '^Microsoft\.NETCore\.App 10\.')) {
            return $candidate
        }
    }
    return $null
}

$dotnet = Get-DotNet
if (-not $dotnet) {
    Write-Host 'Nenhum dotnet encontrado. Instalando o SDK 10 em %TEMP%\dotnet-sdk...' -ForegroundColor Yellow
    $installDir = Join-Path $env:TEMP 'dotnet-sdk'
    $installScript = Join-Path $env:TEMP 'dotnet-install.ps1'
    if (-not (Test-Path $installScript)) {
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installScript
    }
    & $installScript -Channel '10.0' -InstallDir $installDir -NoPath
    $dotnet = Join-Path $installDir 'dotnet.exe'
    if (-not (Test-Path $dotnet)) { throw 'Falha ao instalar o .NET SDK.' }
}

$env:DOTNET_ROOT = Split-Path -Parent $dotnet
$env:PATH = "$env:DOTNET_ROOT;$env:PATH"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

# 1. Baixar ilspycmd
$index = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/ilspycmd/index.json'
$version = ($index.versions | Where-Object { $_ -notmatch 'preview|beta|alpha|rc' })[-1]
$zip = Join-Path $work 'ilspycmd.zip'
$pkg = Join-Path $work 'pkg'

Write-Host "ilspycmd $version"
Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/ilspycmd/$version/ilspycmd.$version.nupkg" -OutFile $zip -UseBasicParsing
Expand-Archive $zip $pkg -Force

$il = Get-ChildItem $pkg -Recurse -Filter 'ilspycmd.dll' |
      Sort-Object FullName -Descending |
      Select-Object -First 1 -ExpandProperty FullName
if (-not $il) { throw 'ilspycmd.dll nao encontrado no pacote.' }

# 2. Decompilar
$jobs = @(
    @{ Name = 'GooseDesktop';    Args = @('-p', '-o', (Join-Path $out 'GooseDesktop'),    '-r', $gameRoot, $exe) },
    @{ Name = 'GooseModdingAPI'; Args = @('-p', '-o', (Join-Path $out 'GooseModdingAPI'), (Join-Path $gameRoot 'GooseModdingAPI.dll')) },
    @{ Name = 'MMQ';             Args = @('-p', '-o', (Join-Path $out 'MMQ'),             (Join-Path $gameRoot 'MMQ.dll')) }
)

$autumn = Join-Path $gameRoot 'Assets\Mods\Autumn\Autumn.dll'
if (Test-Path $autumn) {
    $jobs += @{ Name = 'Autumn'; Args = @('-p', '-o', (Join-Path $out 'Autumn'), '-r', $gameRoot, $autumn) }
}

foreach ($job in $jobs) {
    Write-Host "== $($job.Name) =="
    & $dotnet $il @($job.Args)
    if ($LASTEXITCODE -ne 0) { Write-Warning "Falhou: $($job.Name) (exit $LASTEXITCODE)" }
}

# 3. Ajustar o HintPath do GooseModdingAPI para a pasta de saida
$apiSrc = Join-Path $gameRoot 'GooseModdingAPI.dll'
$apiDst = Join-Path $out 'GooseModdingAPI.dll'
if (Test-Path $apiSrc) {
    Copy-Item $apiSrc $apiDst -Force
}

$proj = Join-Path $out 'GooseDesktop\GooseDesktop.csproj'
if (Test-Path $proj) {
    $text = [System.IO.File]::ReadAllText($proj)
    $text = $text -replace '<HintPath>[^<]*GooseModdingAPI\.dll</HintPath>', '<HintPath>..\GooseModdingAPI.dll</HintPath>'
    [System.IO.File]::WriteAllText($proj, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "Pronto: $out" -ForegroundColor Green
Write-Host 'Use apenas para estudo; nao redistribua o codigo descompilado.' -ForegroundColor Yellow
