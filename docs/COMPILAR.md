# Compilar e executar o código descompilado

> **Este repositório não inclui o jogo, os assets nem o código descompilado.**
> Para seguir este guia, use uma cópia legal do Desktop Goose v0.31 e gere a
> sua própria árvore descompilada. Não redistribua o resultado.

O código descompilado é um projeto SDK-style `net452` (o jogo roda no .NET
Framework 4.8 já instalado no Windows). O build foi testado com o SDK 10.0.402.

## Atalho: script de build + execução

O script [`tools/compilar_e_rodar.ps1`](../tools/compilar_e_rodar.ps1) faz
todo o processo: gera o container de recursos, compila, monta uma cópia
temporária com `Assets/` e `config.ini` e executa o jogo.

```powershell
.\tools\compilar_e_rodar.ps1 `
  -GameRoot "C:\caminho\DesktopGoose v0.31" `
  -DecompiledRoot "C:\caminho\decompilado\GooseDesktop"
```

- `-GameRoot`: pasta que contém `Assets/` e `config.ini` (a instalação
  original ou uma cópia).
- `-DecompiledRoot`: pasta que contém `GooseDesktop.csproj`, `Pat1`, `Pat2` e
  `Pat3` (gerada pelo ILSpy).
- `-Seconds 6`: executa por 6 segundos e encerra (útil para testar).
- `-NoBuild`: usa o binário já compilado em `bin\Release\net452`.

O script instala o SDK 10 em `%TEMP%\dotnet-sdk` se não encontrar um SDK.

## Passo a passo manual

### 1. Gerar a árvore descompilada

Use o ILSpy sobre uma cópia legal do jogo. O script
[`tools/decompile.ps1`](../tools/decompile.ps1) automatiza o download do
`ilspycmd` e a decompilação:

```powershell
.\tools\decompile.ps1 -GameRoot "C:\caminho\DesktopGoose v0.31" `
  -OutDir "C:\caminho\decompilado"
```

O projeto principal fica em `decompilado\GooseDesktop\GooseDesktop.csproj`.

### 2. Corrigir os recursos `Pat1..3`

O ILSpy extrai `Pat1`, `Pat2` e `Pat3` como `EmbeddedResource` cru
(`LogicalName="Pat1"` etc.), mas o `Resources.cs` gerado usa:

```csharp
new ResourceManager("GooseDesktop.Properties.Resources", ...)
ResourceManager.GetStream("Pat1", ...)
```

Ou seja, ele espera um container `.resources` com o nome
`GooseDesktop.Properties.Resources.resources`. Sem esse container, o jogo
falha no startup em `Sound..cctor()` com `MissingManifestResourceException`
(ou `InvalidOperationException` se os bytes forem embutidos como `byte[]`).

Gere o container com entradas do tipo `Stream`:

```powershell
$projDir = "C:\caminho\decompilado\GooseDesktop"
$resFile = Join-Path $projDir "GooseDesktop.Properties.Resources.resources"

$writer = New-Object System.Resources.ResourceWriter($resFile)
$streams = @()
foreach ($name in @("Pat1", "Pat2", "Pat3")) {
    $ms = New-Object System.IO.MemoryStream(
        , [System.IO.File]::ReadAllBytes((Join-Path $projDir $name))
    )
    $streams += $ms
    $writer.AddResource($name, $ms)
}
$writer.Close()
$streams | ForEach-Object { $_.Dispose() }
```

Depois, no `.csproj`, substitua os três `EmbeddedResource` crus por:

```xml
<EmbeddedResource Include="GooseDesktop.Properties.Resources.resources"
                  LogicalName="GooseDesktop.Properties.Resources.resources" />
```

O script [`tools/compilar_e_rodar.ps1`](../tools/compilar_e_rodar.ps1) faz
essa geração automaticamente e também troca os `EmbeddedResource` crus pelo
container no `.csproj`.

### 3. Restore e build

```powershell
$dotnet = "$env:TEMP\dotnet-sdk\dotnet.exe"
$proj = "C:\caminho\decompilado\GooseDesktop\GooseDesktop.csproj"

& $dotnet restore $proj --source "https://api.nuget.org/v3/index.json"
& $dotnet build $proj -c Release --no-restore
```

O `--source` explícito é necessário quando o SDK local não tem uma fonte
NuGet configurada. O build usa `Microsoft.NETFramework.ReferenceAssemblies`
para o alvo `net452`.

O executável sai em:

```text
C:\caminho\decompilado\GooseDesktop\bin\Release\net452\GooseDesktop.exe
```

### 4. Montar a pasta de execução

O jogo resolve `Assets/` e `config.ini` relativos ao executável. Ele **não
roda sozinho** a partir de `bin\Release\net452`. Copie o exe para uma pasta de
teste junto com os assets:

```powershell
$gameRoot = "C:\caminho\DesktopGoose v0.31"
$build = "C:\caminho\decompilado\GooseDesktop\bin\Release\net452"
$stage = "$env:TEMP\opencode\goose-decompiled-run"

New-Item -ItemType Directory $stage -Force | Out-Null
Copy-Item "$gameRoot\Assets" $stage -Recurse -Force
Copy-Item "$gameRoot\config.ini" $stage -Force
Copy-Item "$build\GooseDesktop.exe" $stage -Force
Copy-Item "$build\GooseDesktop.exe.config" $stage -Force
Copy-Item "$build\GooseModdingAPI.dll" $stage -Force

Start-Process "$stage\GooseDesktop.exe" -WorkingDirectory $stage
```

Para sair do jogo, segure `ESC` por alguns segundos.

## Observações

- A instalação original não é modificada: o build acontece na árvore
  descompilada e a execução em `%TEMP%\opencode\goose-decompiled-run`.
- O jogo é WinForms + GDI+, não Unity. O loop fica em `Application.Idle` e
  chama `Thread.Sleep(8)`; o FPS efetivo depende do custo do paint e do timer
  de 1 ms ativado pelo MCI/QUARTZ.
- Para testar uma alteração, edite os `.cs` na sua árvore descompilada e rode
  o script de novo (sem `-NoBuild`).
- Se o jogo abrir e o ganso não aparecer, verifique se a pasta de execução
  contém `Assets/` e `config.ini`, e se o processo não morreu com
  `0xE0434352` (exceção .NET não tratada). Nesse caso, veja o Visualizador de
  Eventos em `Logs do Windows > Aplicativo`.
