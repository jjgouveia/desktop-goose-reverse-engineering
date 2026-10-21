# Ferramentas de análise dinâmica — Desktop Goose v0.31

> **Versão pública sanitizada.** O repositório não inclui o jogo nem os
> assets. Use uma cópia legal do Desktop Goose para rodar estes scripts.

Scripts usados para medir FPS, chamadas GDI+/Win32, tempos de `Sleep`/paint e a dependência MCI/QUARTZ. Foram escritos para Frida 17.24.3 e Python 3.12.

## Pré-requisitos

```powershell
py -3.12 -m venv $env:TEMP\frida312
& $env:TEMP\frida312\Scripts\python.exe -m pip install frida frida-tools
```

Copie o jogo para uma pasta de teste e edite o `config.ini`:

```ini
SilenceSounds=True
Task_CanAttackMouse=False
AttackRandomly=False
EnableMods=False
```

## Scripts

| Script | Runner | O que faz |
|---|---|---|
| `dyn.js` | `run_dyn.py` | Conta `BeginPaint`, GDI+, `BitBlt`, `ClipCursor`, `SetWindowPos`, etc. por segundo. |
| `dyn_ab.js` | `run_dyn_ab.py` | A/B de `timeBeginPeriod(1)`/`timeEndPeriod(1)` + amostras de handles GDI/USER. |
| `dyn_timing.js` | `run_generic.py` | Mede duração de `SleepEx(8)`, paint, gap e `BitBlt`; A/B de timer. |
| `startup.js` | `run_spawn.py` | Spawna o processo e captura `mciSendStringW`, `timeBeginPeriod`/`timeEndPeriod`, `NtSetTimerResolution` e o módulo chamador. |

## Uso

Sempre rode a partir desta pasta (os runners abrem o `.js` pelo nome relativo).

```powershell
$dst = "$env:TEMP\opencode\goose-dyn"
$p = Start-Process "$dst\GooseDesktop.exe" -WorkingDirectory $dst -PassThru
Start-Sleep -Milliseconds 1500

# Contagem por segundo
& "$env:TEMP\frida312\Scripts\python.exe" .\run_dyn.py $p.Id 12 .\events.jsonl

# Timing detalhado
& "$env:TEMP\frida312\Scripts\python.exe" .\run_generic.py $p.Id 8 .\dyn_timing.js .\events_timing.jsonl

# Startup (MCI + timer)
& "$env:TEMP\frida312\Scripts\python.exe" .\run_spawn.py "$dst\GooseDesktop.exe" 6 .\events_startup.jsonl

Stop-Process -Id $p.Id -Force
```

Teste sem som:

```powershell
Rename-Item "$dst\Assets\Sound\NotEmbedded" "NotEmbedded.bak"
# rodar o timing de novo
Rename-Item "$dst\Assets\Sound\NotEmbedded.bak" "NotEmbedded"
```

## Aviso

`timeBeginPeriod(1)` altera a resolução do timer do sistema enquanto estiver ativo. Os scripts chamam `timeEndPeriod(1)` no fim; o Windows também libera o pedido quando o processo termina. Não deixe o app instrumentado rodando indefinidamente com o timer em 1 ms se isso for um problema no seu ambiente.

## Resultado esperado (esta máquina)

- Normal: ~56–58 FPS; `SleepEx(8)` ~9 ms; paint ~8 ms; ~47% de um núcleo.
- Sem os MP3: ~33 FPS; `SleepEx(8)` ~21,6 ms; paint ~8,5 ms.
- Sem som + `timeBeginPeriod(1)`: ~57 FPS; `SleepEx(8)` ~9,2 ms.

Detalhes em [`../../docs/DINAMICA.md`](../../docs/DINAMICA.md).
