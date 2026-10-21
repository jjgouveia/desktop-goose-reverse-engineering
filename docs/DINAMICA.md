# Análise dinâmica — Desktop Goose v0.31

> **Versão pública sanitizada.** Este documento descreve medições feitas em uma
> cópia local; não contém o jogo, os assets nem o código descompilado. Obtenha
> o jogo na página oficial: <https://samperson.itch.io/desktop-goose>.
>
> Complemento do [`RELATORIO.md`](RELATORIO.md). Ali a análise foi estática
> (ILSpy); aqui o app foi executado numa cópia de teste e instrumentado com
> Frida, sem alterar a instalação original.

## TL;DR

- O jogo **não roda a 120 FPS**. Nesta máquina ele rodou a **~56–58 FPS** em regime, com frame de **~17,5 ms**.
- O frame se divide em **~9 ms de `Thread.Sleep(8)`** + **~8 ms de pintura** (GDI+ + `BitBlt` do double buffer). O `Sleep` e o paint se somam; não há compensação.
- Como a física usa **`1/120 s` fixo por tick**, a simulação avança **~0,47 s por segundo real** na instalação normal (e **~0,27 s/s** se os MP3 não abrirem).
- Por frame: **10 `GdipDrawLineI`**, **5 `GdipFillEllipseI`**, **1 `Graphics`** criado/deletado, **1 `BitBlt`**, **5 `DeleteObject`** GDI. Bate exatamente com o `RenderGoose`.
- O FPS depende de um efeito colateral bizarro: abrir os MP3 via **MCI MPEGVideo** faz o **`QUARTZ.dll`** chamar `timeBeginPeriod(1)`. Sem os MP3 (ou sem o codec), o timer volta ao grão grosso, o `Sleep(8)` passa de ~9 ms para ~21 ms e o jogo cai para **~33 FPS**. O jogo **não chama `timeBeginPeriod` diretamente**.
- `SetWindowPos` (por causa de `TopMost = true`) e `ClipCursor` (por causa de `ClearCursorClip`) são chamados **a cada frame**.
- CPU: **~47% de um núcleo** a ~58 FPS. Handles GDI/USER estáveis em 13 s (25–28 GDI, 24 USER): **sem vazamento visível** nessa janela.

---

## 1. Método

- **Alvo:** `GooseDesktop.exe` (PE32, .NET Framework 4.5.2, WinForms/GDI+), executado a partir de uma cópia em `%TEMP%\opencode\goose-dyn`.
- **Config da cópia:** `SilenceSounds=True`, `Task_CanAttackMouse=False`, `AttackRandomly=False`, `EnableMods=False`. Isso evita honks, roubo de mouse e o diálogo de mods; o original não foi tocado.
- **Ferramenta:** Frida 17.24.3, instalado num venv Python 3.12 em `%TEMP%\frida312`.
- **Medições:**
  1. 12 s em regime, contando chamadas nativas por segundo (`events.jsonl`) + screenshot.
  2. 13 s com A/B de `timeBeginPeriod(1)`/`timeEndPeriod(1)` (`events_ab.jsonl`).
  3. 8 s com tempos detalhados de `BeginPaint`/`EndPaint`, `SleepEx` e `BitBlt` (`events_timing.jsonl`).
  4. 6 s com a pasta `Assets/Sound/NotEmbedded` renomeada, para testar a dependência de áudio (`events_nosound.jsonl`).
  5. Spawn com Frida desde o entrypoint para capturar MCI e resolução de timer no startup (`events_startup*.jsonl`).
- **Limites:** `Date.now()` tem resolução de 1 ms; uma máquina/um display; sem troca forçada de task (só `Wander` foi observado); sem teste de mods/Twitch; soak de 13 s é curto para detectar vazamento lento; não separei os ~8 ms de paint entre clear do buffer, rasterização GDI+ e flush do WinForms (o `BitBlt` é ~1,3 ms). Os hooks do Frida adicionam uma sobrecarga pequena, então os tempos de paint/CPU são ligeiramente superestimados; a diferença entre ~33 e ~57 FPS é muito maior do que essa sobrecarga.

### Ambiente

| Item | Valor |
|---|---|
| OS | Windows 11 (sessão local) |
| Processo | 32-bit (`arch: ia32`, `pointerSize: 4`) |
| Display ativo | 2560×1600 @ **240 Hz**, escala 150% |
| Área lógica vista pelo app | 1707×1067 (janela 1707×1019) |
| DPI-aware | **Não** — o app renderiza em 1707×1019 e o Windows upscala para 2560×1600 |
| GPU | GPU híbrida (NVIDIA + Intel), display ativo na NVIDIA |

O display de 240 Hz é importante: os ~58 FPS **não são vsync**. O período de ~17,5 ms é explicado por sleep + paint, não por um limite de 60 Hz.

---

## 2. Resultado principal: ~57 FPS, não 120

Medição de regime (`events_timing.jsonl`, 7 relatórios de 1 s):

| Métrica | Valor |
|---|---|
| FPS | **56,4** (faixa 55–59; primeira execução: 57,6) |
| Intervalo entre `BeginPaint` | **~17,7 ms** |
| `SleepEx(8)` | **9,09 ms** |
| Paint (`BeginPaint` → `EndPaint`) | **8,30 ms** |
| Gap (`EndPaint` → próximo `BeginPaint`) | **9,61 ms** |
| `BitBlt` (dentro do paint) | **1,34 ms** |
| CPU | **46,9% de um núcleo** (7,16 s de CPU / 15,26 s de parede) |
| Handles GDI / USER | 25–28 / 24 (estáveis) |

O intervalo de ~17,7 ms dá **~56,4 FPS**. A soma `sleep + paint` (9,09 + 8,30 = 17,39 ms) e a soma `gap + paint` (9,61 + 8,30 = 17,91 ms) batem com o intervalo medido.

O CPU também bate: `8,30 ms × 56,4 FPS = 468 ms/s ≈ 46,8%` de um núcleo; medido 46,9%. Ou seja, o paint é **trabalho de CPU**, não espera de compositor/vsync.

### Impacto na simulação

`GooseFunctions.TickGoose` usa `1f/120f` fixo em dois pontos:

```csharp
g.velocity += Vector2.Normalize(g.targetPos - g.position) * g.currentAcceleration * (1f / 120f);
g.position += g.velocity * (1f / 120f);
```

`MainGame.TickGame` é chamado **uma vez por paint** (via `canvas.Paint += Render`). Logo, na instalação normal:

```
56,4 ticks/s × (1/120 s por tick) = 0,470 s simulados por segundo real
```

A simulação roda a **~47% da velocidade prevista**. Sem os MP3, a ~33 FPS, fica em **~27%**.

Ao mesmo tempo, `SamEngine.Time.TickTime()` usa um `Stopwatch` real:

```csharp
time = (float)timeStopwatch.Elapsed.TotalSeconds;
```

Então os **timers de task, o fade das pegadas e o `Time.time`** avançam em tempo real, enquanto o **movimento** avança em tempo simulado. Exemplo: `TrackMud` termina depois de 8,5 s reais, mas o ganso andou aproximadamente metade da distância que andaria a 120 FPS. É uma inconsistência real, não só estética.

---

## 3. Decomposição do frame

```
BeginPaint
  └─ TickGame
       ├─ Time.TickTime()                 (Stopwatch real)
       ├─ OSFunctions.ClearCursorClip()   → ClipCursor
       ├─ OSFunctions.RefreshInput()      → Control.MouseButtons/Cursor.Position
       ├─ goose.tick / updateRig          (física com dt = 1/120)
       ├─ goose.render                    (10 DrawLine + 5 FillEllipse)
       └─ EscToQuitOverlay.UpdateAndDraw  → GetAsyncKeyState(VK_ESCAPE)
  └─ BufferedGraphics.Render              → BitBlt (~1,3 ms)
EndPaint                                  (~8,3 ms no total, incluindo o BitBlt)
  └─ volta ao idle
       ├─ mainForm.TopMost = true         → SetWindowPos
       ├─ canvas.BringToFront()
       ├─ canvas.Invalidate()             → InvalidateRect
       └─ Thread.Sleep(8)                 → SleepEx(8) (~9,1 ms)
```

O `gap` de 9,61 ms é quase todo `SleepEx` (9,09 ms); sobram ~0,5 ms para `SetWindowPos`, `BringToFront`, `Invalidate` e o message loop.

Observação: o `BitBlt` acontece **dentro** da janela `BeginPaint`→`EndPaint`; se estivesse fora, o gap de 9,61 ms não comportaria os 1,34 ms dele junto com os 9,09 ms de sleep. O paint de 8,30 ms inclui, portanto, ~1,34 ms de blit e ~6,96 ms de GDI+/WinForms.

---

## 4. Chamadas GDI+ e Win32 por frame

Contagem limpa da segunda execução (hooks só nas versões `I`, para evitar duplicação de wrapper):

| Chamada | Por frame | Por segundo (~56,4 FPS) | Origem no código |
|---|---:|---:|---|
| `GdipCreateFromHDC` | 1 | 56 | WinForms cria o `Graphics` do double buffer |
| `GdipDeleteGraphics` | 1 | 56 | dispose do `Graphics` |
| `GdipDrawLineI` | **10** | **564** | 10 `gfx.DrawLine` em `RenderGoose` |
| `GdipFillEllipseI` | **5** | **282** | 2 pés + 1 sombra + 2 olhos |
| `BitBlt` | 1 | 56 | blit do `BufferedPanel` (double buffer) |
| `GdipDrawImage*` | 0 | 0 | o blit é GDI (`BitBlt`), não GDI+ |
| `GdipGraphicsClear` | 0 | 0 | não observado |
| `GdipFillRectangleI` | 0 | 0 | não observado |
| `SetWindowPos` | 1 | 56 | `mainForm.TopMost = true` no idle |
| `ClipCursor` | 1 | 56 | `OSFunctions.ClearCursorClip()` |
| `GetAsyncKeyState` | 1 | 56 | `EscToQuitOverlay` |
| `PeekMessageW` | 3 | 169 | `IsApplicationIdle` + message loop |
| `InvalidateRect` | 1 | 56 | `canvas.Invalidate()` |
| `EndPaint` | 1 | 56 | WinForms |
| `SleepEx(8)` | 1 | 56 | `Thread.Sleep(8)` |
| `DeleteObject` (GDI) | 5 | 282 | limpeza de objetos GDI do double buffer |

### Por que 10 linhas e 5 elipses?

O `RenderGoose` tem exatamente:

- **10 `DrawLine`**: 4 do contorno (corpo, pescoço, cabeça 1, cabeça 2) + 1 do underbody + 4 do branco (corpo, pescoço, cabeça 1, cabeça 2) + 1 do bico.
- **5 `FillEllipse`**: 2 pés + 1 sombra + 2 olhos.

A contagem dinâmica bate 1:1 com o código decompilado. Isso é uma validação forte da decompilação.

Na primeira execução, os exports sem sufixo `I` (`GdipDrawLine`, `GdipFillEllipse`) também marcaram 10/5 por frame. Eles são acionados em conjunto com as versões `I` (provavelmente um thunk interno); o número **lógico** de chamadas é 10/5, confirmado pelo fonte. Não são 20 linhas/10 elipses.

### `DeleteObject` e handles

São 5 objetos GDI deletados por frame (~282/s), mas o número de handles GDI ficou entre 25 e 28 e o de USER em 24 durante 13 s. Não há vazamento visível nessa janela. Um soak mais longo seria necessário para descartar um vazamento lento.

---

## 5. O achado mais estranho: o FPS depende do MCI/DirectShow

### 5.1. O que o startup mostra

Capturando desde o entrypoint (`startup.js` + `run_spawn.py`):

```
mci: open ".../Assets/Sound/NotEmbedded/Honk1.mp3" type MPEGVideo alias honkPlayer
timer_api: timeBeginPeriod(1)   caller: QUARTZ.dll+0x79231
ntSetTimerResolution_enter: desired_100ns=10000, set=1
ntSetTimerResolution_leave: status=0, actual_100ns=10000
mci_ret: 0

mci: open ".../Assets/Sound/NotEmbedded/MudSquith.mp3" type MPEGVideo alias assortedEnvironment
timer_api: timeBeginPeriod(1)   caller: QUARTZ.dll+0x79231
mci_ret: 0

mci: stop honkPlayer
mci: close honkPlayer
timer_api: timeEndPeriod(1)     caller: QUARTZ.dll+0x792da
mci: open ".../Assets/Sound/NotEmbedded/Honk2.mp3" type MPEGVideo alias honkPlayer
timer_api: timeBeginPeriod(1)   caller: QUARTZ.dll+0x79231
mci: setaudio honkPlayer volume to 800
```

Ou seja: **quem chama `timeBeginPeriod(1)` é o `QUARTZ.dll`** (a camada DirectShow usada pelo driver MCI MPEGVideo), não o código do ganso. Cada `open` de MP3 eleva a resolução do timer para 1 ms; cada `close` libera. O `HONCC()` fecha o honk atual e abre outro, então o pedido de 1 ms é liberado e re-adquirido.

### 5.2. Controle em PowerShell

`[Threading.Thread]::Sleep(8)` medido em 15 iterações:

| Situação | Duração média |
|---|---:|
| Antes de abrir MCI | **16,08 ms** |
| Com um MP3 aberto via `mciSendString(..., "type MPEGVideo")` | **9,42 ms** |
| Depois de fechar o MCI | **14,99 ms** |

### 5.3. A/B sem os MP3

Renomeando `Assets/Sound/NotEmbedded` na cópia de teste:

| Fase | FPS | `SleepEx(8)` | Paint | Gap | `BitBlt` |
|---|---:|---:|---:|---:|---:|
| Sem som (baseline) | **32,7** (32–33) | **21,66 ms** | 8,52 ms | 22,47 ms | 1,63 ms |
| Sem som + `timeBeginPeriod(1)` | **57,0** | 9,17 ms | 8,12 ms | 9,62 ms | 1,43 ms |

E, na instalação normal (com som), o A/B de `timeBeginPeriod(1)` **não muda nada**:

| Fase | FPS |
|---|---:|
| Baseline | 58,25 |
| Com `timeBeginPeriod(1)` | 57,75 |
| Depois de `timeEndPeriod(1)` | 58,50 |

Isso confirma a causa: na instalação normal o MCI/QUARTZ **já** deixou o timer em 1 ms; forçar de novo não altera. Sem os MP3, o timer fica no grão grosso (o tick clássico do Windows é 15,6 ms; no goose o `SleepEx(8)` mediu ~21,6 ms) e o FPS cai para ~33. Chamar `timeBeginPeriod(1)` manualmente restaura os ~57 FPS.

### 5.4. Cadeia causal

```
Sound.Init()
  └─ new Mp3Player(...) → mciSendString("open ... type MPEGVideo")
       └─ MCI MPEGVideo → QUARTZ.dll (DirectShow)
            └─ timeBeginPeriod(1) / NtSetTimerResolution(10000, 1)
                 └─ Thread.Sleep(8) passa a dormir ~9 ms em vez de ~16–22 ms
                      └─ loop sobe de ~33 FPS para ~57 FPS
```

Consequências práticas:

- `SilenceSounds=True` **não** evita o problema: ele só pula o `play`, não o `open`. Os MP3 precisam existir e o codec MPEGVideo precisa funcionar para o jogo rodar a ~57 FPS.
- Apagar/mover a pasta de sons, usar uma edição do Windows sem Media Feature Pack, ou ter o codec MCI quebrado derruba o jogo para ~33 FPS.
- O jogo **não chama `timeBeginPeriod` diretamente** e não checa o retorno de `mciSendString`. A dependência é totalmente acidental e silenciosa.

---

## 6. Bugs e impactos confirmados

1. **Simulação em câmera lenta:** ~0,47× na instalação normal e ~0,27× sem os MP3. O `1/120` fixo por tick não corresponde à taxa real de ticks.
2. **Tempo real vs. tempo simulado:** `Time.time` é `Stopwatch` real; timers de task, fade de pegadas e duração de `TrackMud` andam em tempo real, enquanto o movimento anda em tempo simulado. Isso pode fazer a tarefa terminar antes de o ganso percorrer a distância prevista.
3. **`ClipCursor` a cada frame:** `OSFunctions.ClearCursorClip()` seta `Cursor.Clip = Rectangle.Empty` no início de **todo** `TickGame`. São ~56 chamadas/s de `ClipCursor`, que **limpam qualquer clip de cursor** definido por outro aplicativo (jogos, remote desktop, VMs). É um efeito colateral de sistema, não só do ganso.
4. **`TopMost` a cada frame:** `mainForm.TopMost = true` no `HandleApplicationIdle` gera um `SetWindowPos` por frame (~56/s). É desnecessário e pode causar churn de z-order (e competir com outras janelas topmost).
5. **CPU alta para o que faz:** ~47% de um núcleo a ~58 FPS para desenhar 15 primitivas num buffer full-screen. O custo está no paint de ~8 ms, não no `Sleep`.
6. **DPI-unaware:** em 2560×1600 @150%, o app renderiza em 1707×1019 e o Windows upscala. O ganso fica menos nítido e o custo de paint é o da resolução lógica, não da física. Num 4K a 100% (3840×2160) o custo de paint deve crescer bastante; não medi.
7. **Sem vazamento de handles em 13 s:** GDI 25–28, USER 24. Soak mais longo necessário para confirmar.
8. **`NabMouse` não foi exercitado** (`Task_CanAttackMouse=False`); o `ClipCursor` observado é do `ClearCursorClip`, não do `NabMouse`. `TrackMud`, `CollectMeme` e `CollectNotepad` também não foram forçados; as contagens GDI+ acima são do `Wander`.

---

## 7. O que isso muda no relatório estático

- A seção 14 do `RELATORIO.md` dizia “nada foi executado”. Isso não vale mais: a análise dinâmica foi feita e está aqui.
- A constante `Time.framerate = 120` e o `deltaTime = 1/120` são **intenção**, não a taxa real. O loop entrega ~57 FPS nesta máquina.
- O `GooseDesktop.Refactor.MainGame.TickGame` é chamado **uma vez por paint**; não há accumulator/catch-up. A simulação não compensa os ticks perdidos.
- O `ClearCursorClip` merece entrar na lista de efeitos colaterais: ele não é inofensivo, chama `ClipCursor` ~56 vezes/s.
- O `Sound.Init` não é só áudio: ele muda a resolução do timer do processo via MCI/QUARTZ e, por tabela, o FPS. É uma dependência oculta relevante para qualquer recompilação/porte.

---

## 8. Como reproduzir

Os scripts estão em [`../tools/dinamica/`](../tools/dinamica/).

### 8.1. Instalar o Frida

```powershell
py -3.12 -m venv $env:TEMP\frida312
& $env:TEMP\frida312\Scripts\python.exe -m pip install frida frida-tools
```

### 8.2. Preparar a cópia de teste

```powershell
$src = "C:\caminho\DesktopGoose v0.31"
$dst = "$env:TEMP\opencode\goose-dyn"
Copy-Item "$src\*" $dst -Recurse -Force
# editar $dst\config.ini:
#   SilenceSounds=True
#   Task_CanAttackMouse=False
#   AttackRandomly=False
#   EnableMods=False
```

### 8.3. Rodar

```powershell
$p = Start-Process "$dst\GooseDesktop.exe" -WorkingDirectory $dst -PassThru
Start-Sleep -Milliseconds 1500
& "$env:TEMP\frida312\Scripts\python.exe" .\run_generic.py $p.Id 8 .\dyn_timing.js .\events_timing.jsonl
Stop-Process -Id $p.Id -Force
```

Para o teste sem som:

```powershell
Rename-Item "$dst\Assets\Sound\NotEmbedded" "NotEmbedded.bak"
# rodar de novo; depois restaurar
Rename-Item "$dst\Assets\Sound\NotEmbedded.bak" "NotEmbedded"
```

Para capturar o startup (MCI + timer):

```powershell
& "$env:TEMP\frida312\Scripts\python.exe" .\run_spawn.py "$dst\GooseDesktop.exe" 6 .\events_startup.jsonl
```

Atenção: `timeBeginPeriod(1)` afeta o sistema enquanto estiver ativo; os scripts chamam `timeEndPeriod(1)` no fim, e o Windows libera o pedido quando o processo termina.

---

## 9. Evidências

| Arquivo | Conteúdo |
|---|---|
| `../evidence/events.jsonl` | Contagens por segundo da execução normal de 12 s |
| `../evidence/events_ab.jsonl` | A/B de `timeBeginPeriod(1)` com som presente |
| `../evidence/events_timing.jsonl` | Tempos detalhados de sleep/paint/gap/BitBlt |
| `../evidence/events_nosound.jsonl` | A/B sem a pasta de sons |
| `../evidence/events_startup.jsonl` | MCI + timer no startup |
| `../evidence/events_startup_callers2.jsonl` | O mesmo, com o caller `QUARTZ.dll+0x79231` |
| `../evidence/resumo_dinamica.json` | Números agregados em JSON |
| `../tools/dinamica/*.js` | Hooks Frida |
| `../tools/dinamica/*.py` | Runners (attach, A/B, spawn) |

As capturas de tela originais foram omitidas da versão pública por mostrarem
a arte do jogo. Os números medidos estão nos arquivos JSONL; as capturas eram
de 1707×1067 porque o processo que capturou é DPI-unaware, igual ao ganso, e o
framebuffer real é 2560×1600.
