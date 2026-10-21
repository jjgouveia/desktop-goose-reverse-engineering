# Desktop Goose v0.31 — engenharia reversa (análise independente)

> ⚠️ **Este repositório não contém o jogo, os assets, as DLLs nem o código
> descompilado.** Ele traz apenas anotações, medições e ferramentas próprias.
> Obtenha o Desktop Goose na página oficial:
> <https://samperson.itch.io/desktop-goose>. Não redistribua o software.

Estudo independente de engenharia reversa do **Desktop Goose v0.31** para
Windows. O objetivo é entender a arquitetura, o loop de jogo, o render, o
sistema de tarefas, o áudio, o modding e os efeitos colaterais do app — sem
modificar a instalação original.

Análise feita em 2026-10-20 com REA, ILSpy 11.1.0.9782 e Frida 17.24.3.

## O que tem aqui

| Caminho | Conteúdo |
|---|---|
| [`docs/RELATORIO.md`](docs/RELATORIO.md) | Análise estática: PE/CLI, arquitetura, modelo do ganso, tasks, render, input, áudio, config, modding, Twitch/MMQ, segurança |
| [`docs/DINAMICA.md`](docs/DINAMICA.md) | Análise dinâmica: FPS real, decomposição do frame, chamadas GDI+/Win32, dependência MCI/QUARTZ, CPU e handles |
| [`docs/COMPILAR.md`](docs/COMPILAR.md) | Como compilar e executar uma árvore descompilada localmente (inclui o ajuste dos recursos `Pat1..3`) |
| [`tools/decompile.ps1`](tools/decompile.ps1) | Baixa o ILSpy e decompila uma cópia legal do jogo |
| [`tools/compilar_e_rodar.ps1`](tools/compilar_e_rodar.ps1) | Compila a árvore descompilada e executa o jogo numa cópia temporária |
| [`tools/dinamica/`](tools/dinamica/) | Hooks Frida e runners para medir FPS, GDI+, `Sleep`, `BitBlt` e MCI/QUARTZ |
| [`evidence/`](evidence/) | Métricas agregadas e eventos JSONL da execução instrumentada |

## Principais achados

- **Não é Unity.** É WinForms puro + GDI+, com loop em `Application.Idle` e
  `Thread.Sleep(8)`. A janela é fullscreen, `TopMost`, `TransparencyKey =
  Coral` e `WS_EX_LAYERED | WS_EX_TRANSPARENT`.
- **~56–58 FPS, não 120.** O frame leva ~17,5 ms: ~9 ms de `Sleep(8)` + ~8 ms
  de pintura (GDI+ + `BitBlt`). A física usa `1/120 s` fixo por tick, então a
  simulação avança a ~0,47× o tempo real (e ~0,27× sem os MP3).
- **Dependência oculta de áudio.** Abrir os MP3 via MCI MPEGVideo faz o
  `QUARTZ.dll` chamar `timeBeginPeriod(1)`; sem os MP3 (ou sem o codec), o
  `Sleep(8)` passa de ~9 ms para ~21,6 ms e o FPS cai para ~33.
  `SilenceSounds=True` não evita o `open`.
- **Efeitos colaterais por frame.** `ClearCursorClip()` chama `ClipCursor`
  ~56×/s e pode limpar clips de outros apps; `TopMost = true` gera um
  `SetWindowPos` ~56×/s.
- **Mods rodam com confiança total.** `Assembly.UnsafeLoadFrom` carrega
  qualquer DLL em `Assets/Mods`, sem sandbox, assinatura ou allowlist.
- **Twitch está morto nesta build.** `IPCManager.Init`/`ProcessMessages` estão
  vazios, `ConnectedToTwitch` nunca vira `true` e `MMQ.dll` não é referenciado
  pelo executável.
- **Parser de `config.ini` frágil.** Chave desconhecida ou duplicada pode
  apagar e recriar o arquivo; não há `Trim()` e floats usam a cultura atual.
- **DPI-unaware.** Em 2560×1600 @150%, o app renderiza em 1707×1019 e o
  Windows upscala.

Os detalhes, tabelas e ressalvas estão nos dois relatórios.

## Como reproduzir

Pré-requisitos:

- Windows com .NET Framework 4.8 (o jogo) e .NET 10 SDK/runtime (as
  ferramentas). O script de build instala o SDK 10 em `%TEMP%\dotnet-sdk` se
  necessário.
- Uma **cópia legal** do Desktop Goose v0.31.
- Para a parte dinâmica: Python 3.12 e Frida (veja
  [`tools/dinamica/README.md`](tools/dinamica/README.md)).

```powershell
# 1. Decompilar (gera uma árvore local; não é publicada)
.\tools\decompile.ps1 -GameRoot "C:\caminho\DesktopGoose v0.31"

# 2. Compilar e rodar por 6 segundos
.\tools\compilar_e_rodar.ps1 `
  -GameRoot "C:\caminho\DesktopGoose v0.31" `
  -DecompiledRoot "$env:TEMP\goose-decompiled\GooseDesktop" `
  -Seconds 6
```

O guia manual, incluindo a correção do container `Pat1..3`, está em
[`docs/COMPILAR.md`](docs/COMPILAR.md).

> A árvore descompilada é uma obra derivada do software original. Use apenas
> para estudo/uso pessoal e **não a redistribua**.

## Posso reescrever em outra linguagem?

Depende de como a reescrita é feita. **Traduzir o código descompilado para
outra linguagem não remove o direito autoral**: um port linha a linha, ou uma
reestruturação que preserva a estrutura e a expressão do original, continua
sendo uma obra derivada. Trocar C# por Rust, Python ou JavaScript não torna o
código automaticamente original.

O caminho mais defensável é uma **reimplementação limpa (clean-room)**, feita a
partir do comportamento observado e de interfaces públicas, com código, nome,
arte e áudio próprios, sem copiar a estrutura interna do original. Ainda assim,
o nome, o personagem, os assets e a identidade visual do Desktop Goose
continuam protegidos; um clone muito parecido pode gerar problema de marca ou
concorrência desleal, mesmo com código novo. Para um projeto público, o mais
seguro é criar identidade própria ou pedir permissão ao autor. Isto não é
aconselhamento jurídico.

## Licença

- **Scripts e código próprio:** MIT — veja [`LICENSE`](LICENSE).
- **Documentação e relatórios:** Creative Commons Attribution 4.0
  Internacional (CC BY 4.0) — veja [`docs/LICENSE`](docs/LICENSE).
- **Desktop Goose, assets, nome, personagem e demais conteúdos do jogo:**
  pertencem a Sam Chiet e não são licenciados por este repositório. Este
  projeto não é afiliado nem endossado pelo autor.

## Aviso legal

Este é um estudo independente, sem garantias. A engenharia reversa é feita
para fins de estudo, interoperabilidade e pesquisa; as leis variam por país.
Não redistribua o jogo, os assets, as DLLs ou o código descompilado. Se você
quiser usar algo daqui, use uma cópia legal e respeite os termos do autor.
Não há telemetria, malware ou intenção de burlar proteções neste repositório.

## English summary

Independent reverse-engineering notes for **Desktop Goose v0.31** (Windows,
WinForms + GDI+). The app runs at ~56–58 FPS, not 120; its fixed `1/120 s`
timestep makes the simulation run at ~0.47× real time. Opening MP3s through
MCI/MPEGVideo causes `QUARTZ.dll` to call `timeBeginPeriod(1)`, which is why
the frame loop depends on the audio codec. The repo contains only original
analysis, Frida tooling and metrics — no game code, assets or binaries. Get
the game from the official itch.io page and do not redistribute it.

## Créditos

Desktop Goose por **Sam Chiet** — <https://samperson.itch.io/desktop-goose>.
Este repositório é uma análise independente, sem afiliação com o autor.
