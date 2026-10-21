# Engenharia reversa — Desktop Goose v0.31

> **Versão pública sanitizada.** Este repositório contém apenas a análise
> independente. Não inclui o jogo, os assets, as DLLs nem o código
> descompilado. Obtenha o Desktop Goose na página oficial:
> <https://samperson.itch.io/desktop-goose>. Não redistribua o software.

Análise estática do binário distribuído, complementada por análise dinâmica
(seção 16 e [`DINAMICA.md`](DINAMICA.md)). O binário não foi modificado.

- Ferramenta de inspeção: REA (`inspect_managed_artifact`, `inspect_managed_members`)
- Ferramenta de decompilação: ILSpy `ilspycmd` 11.1.0.9782 (ICSharpCode.Decompiler 11.1.0.9782), rodando sobre .NET 10
- Fontes descompiladas localmente para análise; **não incluídas neste repositório**
- Data da análise: 2026-10-20

---

## 1. Identidade dos artefatos

| Arquivo | Tamanho | SHA-256 |
|---|---:|---|
| `GooseDesktop.exe` | 226.304 | `943FD1EA44266C5D7FA02F2B292DB095A4E6BA8027A1F6C73FD60D1165E63AFF` |
| `GooseModdingAPI.dll` | 16.384 | `EFA31DF7AB1394092395365805F913DD023CDCD21796603F133641524FB9AD79` |
| `MMQ.dll` | 10.752 | `B06945029A9A667C9B19653C5D789DD825EFCDA959FD1DD57F341385EB99DC72` |
| `Assets/Mods/Autumn/Autumn.dll` | 11.264 | `5C0024FD7CB4FE2424C3C04C6036A2C67BB460F67A04B652AFEEB5D4C757B70F` |

Dados do PE/CLI de `GooseDesktop.exe`:

| Campo | Valor |
|---|---|
| Formato | PE32 (x86), 3 seções |
| Runtime | .NET Framework 4.5.2 (`v4.0.30319`) |
| CLI flags | `IL-only`, `32-bit-required`, `32-bit-preferred` |
| Entry point | `0x06000052` (`Program.Main`) |
| MVID | `28648bc5-958a-41ea-b036-bd56ddfb664d` |
| Assinatura forte | nenhuma |
| Versão do assembly | `1.0.0.0` |
| Tabelas | 77 tipos, 250 métodos, 361 campos, 109 strings de usuário |
| Referências | `mscorlib`, `System`, `System.Core`, `System.Drawing`, `System.Windows.Forms`, **`GooseModdingAPI`** |

Observação importante: **`MMQ.dll` não é referenciado pelo executável**. Não aparece em `AssemblyRef`. É resto de build (ver §10).

Evidência REA: `ev_51c1ec635023f960a25dd8cc1dca6964654f1cf33e46fbfd858efc0dbbb9a1ae` (artefato) e `ev_a569d11279f66fafe5ccf45d92ce241195c0a1536a54dfecbce2c543c995db0d` (membros).

---

## 2. Arquitetura em uma página

Não é Unity, não é MonoGame, não tem engine. É um **WinForms puro, .NET Framework 4.5.2**, desenhado com **GDI+**, rodando um loop de jogo em cima do evento `Application.Idle`.

```
Program.Main
 ├─ cria Form fullscreen, borderless, TopMost, TransparencyKey = Coral
 ├─ aplica WS_EX_LAYERED | WS_EX_TRANSPARENT  (clique atravessa)
 ├─ adiciona BufferedPanel (canvas)
 ├─ IPCManager.Init()            // vazio nesta versão
 ├─ Refactor.MainGame.Init()
 │   ├─ valida pasta de assets
 │   ├─ GooseConfig.LoadConfig()
 │   ├─ registra 5 tasks
 │   ├─ [se EnableMods] aviso + ModSupport.LoadMods()
 │   ├─ GooseTaskDatabase.LockDatabase()
 │   ├─ Sound.Init()
 │   └─ GooseFunctions.InitGoose()
 ├─ Application.Idle += HandleApplicationIdle
 └─ Application.Run(mainForm)

HandleApplicationIdle:
  while (não há mensagem na fila):
      mainForm.TopMost = true
      canvas.BringToFront()
      canvas.Invalidate()      // dispara Paint
      Thread.Sleep(8)

Paint → Refactor.MainGame.TickGame(g):
  Time.TickTime()
  ClearCursorClip()
  RefreshInput()
  PreTick  → goose.tick      → PostTick
  PreUpdateRig → updateRig   → PostUpdateRig
  PreRender → goose.render   → PostRender
  EscToQuitOverlay.UpdateAndDraw(g)
```

Consequências dessa arquitetura:

- **Timestep fixo de 1/120 s** hard-coded em toda a física (`Time.deltaTime` e vários `1f / 120f`). O loop tenta ~125 Hz com `Sleep(8)`, mas se a máquina não acompanhar, o jogo fica mais lento em tempo real (não há compensação por delta real).
- O formulário cobre só a **working area do monitor primário** (`Screen.PrimaryScreen.WorkingArea`), então a taskbar não é coberta e multi-monitor não é suportado.
- A janela é `WS_EX_TRANSPARENT`: cliques atravessam para o desktop. O jogo lê o mouse globalmente (`Cursor.Position` e `Control.MouseButtons`), não por eventos de janela.
- A renderização é feita a cada `Paint` em um `BufferedPanel` com `DoubleBuffered = true`.

---

## 3. Modelo do ganso

`GooseShared.GooseEntity` (definido em `GooseModdingAPI.dll`, recompilado dentro do exe via API):

| Campo | Papel |
|---|---|
| `position`, `velocity`, `direction` | estado no espaço de tela (px, graus) |
| `targetPos`, `targetDirection` | alvo atual; a locomoção é sempre "vá até este ponto" |
| `currentSpeed`, `currentAcceleration`, `stepInterval` | derivados do tier (`Walk` 80, `Run` 200, `Charge` 400 px/s) |
| `parameters` | tabela de tuning (`AccelerationNormal` 1300, `AccelerationCharged` 2300, `StopRadius` -10, `DurationToTrackMud` 15 s) |
| `rig` | posições calculadas dos membros (corpo, pescoço, cabeça, pés) |
| `footMarks[64]`, `footMarkIndex` | pegadas de lama; começam a encolher em 8,5 s e somem em ~9,5 s |
| `currentTask`, `currentTaskData` | task atual e estado persistente dela |
| `taskIndexQueue` | fila declarada, mas nunca usada no código desta versão |

`InitGoose()` começa em `(-20, 120)` mirando `(100, 150)`, no tier `Walk`, task `Wander`.

### Movimento (`GooseFunctions.TickGoose`)

1. Se `Task_CanAttackMouse` e o botão esquerdo foi clicado a menos de 30 px do corpo → troca para `NabMouse`.
2. `targetDirection = normalize(position - targetPos)` (repare: vetor **para trás**, usado para orientar o bico).
3. Roda a task atual (`RunAI`).
4. Gira a direção com lerp de -0.25 entre a direção atual e `targetDirection`.
5. Limita a velocidade ao `currentSpeed`.
6. Se está perto o suficiente e `canDecelerateImmediately`, desacelera proporcionalmente; senão acelera na direção do alvo.
7. Integra posição com `1/120`.
8. Resolve os pés procedurais e o lerp do pescoço (`extendingNeck` ou velocidade ≥ `RunSpeed`).

### Rig e desenho

O ganso **não usa sprite**. É desenhado com linhas GDI+ de pontas arredondadas:

- contorno em `LightGray` com espessura +2, depois o mesmo trajeto em branco por cima;
- corpo: linha de 22 px de espessura e 22 px de comprimento;
- pescoço: 13 px; cabeça: 15 px; bico: 10 px; bico laranja: 9 px;
- olhos: dois círculos pretos de raio 2, deslocados por `IPD`/`EyesForward`;
- sombra: elipse com um `TextureBrush` 2×2 (3 pixels transparentes + 1 cinza-escuro) para dar granulado;
- pés: dois círculos laranja de raio 4.

Cores padrão: branco `#ffffff`, laranja `#ffa500`, contorno `#d3d3d3` (configuráveis).

### Pés e pegadas

`ProceduralFeetFuncs.SolveFeets` move um pé por vez quando ele está a mais de 5 px do "home"; a passada dura `stepInterval` (0.2 s normal, 0.1 s em charge) com easing cúbico e 40% de overshoot. Cada passo toca um "pat" (WAV embutido). Se `trackMudEndTime` ainda não passou, cada passo grava uma `FootMark`, que começa a encolher em 8,5 s e desaparece em ~9,5 s.

---

## 4. Sistema de tarefas (a "IA")

`GooseDesktop.Refactor.GooseTasks.GooseTaskDatabase`:

- `List<GooseTaskInfo> tasksDatabase`
- `Dictionary<string,int> idToIndex`
- `List<int> randomlyPickableTaskIndices`
- `Deck taskDeck` — um "baralho" embaralhado que garante que todas as tasks aleatórias sejam sorteadas antes de repetir (`SamEngine.Deck`).

Regras:

- Só é possível registrar tasks **antes** de `LockDatabase()`. Depois disso, `RegisterTask` mostra MessageBox de erro.
- Task com `taskID == ""` é rejeitada.
- `canBePickedRandomly` decide se entra no deck.
- `GetNextRandomTask()` retorna `Wander` se o deck estiver vazio.

Tasks registradas em `MainGame.Init()` (nesta ordem):

| # | ID | Classe | Aleatória? | O que faz |
|---|---|---|---|---|
| 0 | `Wander` | `Wander` | não | estado padrão: anda até um ponto, pausa 1–2 s, repete; troca de task após 20–40 s |
| 1 | `TrackMud` | `TrackMud` | sim | sai da tela, volta correndo e deixa pegadas por 15 s |
| 2 | `CollectMeme` | `CollectMeme` | sim | sai da tela, volta arrastando uma janela com meme |
| 3 | `CollectNotepad` | `CollectNotepad` | sim | idem, com um "Goose Not-epad" |
| 4 | `NabMouse` | `NabMouse` | **só se `AttackRandomly=True`** | persegue, prende e arrasta o cursor |

Tasks **presentes no binário mas nunca registradas** (código morto nesta versão):

- `CollectDonateWindow` (`SimpleDonateForm` com botões para Patreon/PayPal/Twitter/Discord);
- `DemoTask` (a task de exemplo da API).

### `Wander`

`GetNewTaskData` ajusta a velocidade para `Walk`, sorteia duração (primeira vez usa `FirstWanderTimeSeconds`; depois `Min/MaxWanderingTimeSeconds`). No `RunTask`:

- se `!IPCManager.ConnectedToTwitch` e o tempo acabou → escolhe uma task aleatória;
- se está pausando → zera a velocidade até o fim da pausa;
- se chegou a menos de 20 px do alvo → inicia pausa de 1–2 s e, ao terminar, sorteia um novo alvo limitado por `GetRandomWalkTime() * currentSpeed` (1–6 s de caminhada).

O teste `!ConnectedToTwitch` é _**sempre verdadeiro**_ nesta build (ver §10).

### `TrackMud`

Três estágios:

1. `DecideToRun`: escolhe uma borda via `SetTargetOffscreen`, tier `Run`.
2. `RunningOffscreen`: ao chegar, sorteia um ponto na tela, define `trackMudEndTime = agora + 15 s`, toca `MudSquith` e vai para o estágio 3.
3. `RunningWandering`: corre para pontos aleatórios por 2 s (o intervalo de troca de direção é `GetDirChangeInterval() = 100 s`, valor que parece placeholder), depois vai para um ponto perto de si, clampado longe das bordas, e volta para `Wander`.

### `NabMouse`

Máquina de estados com constantes reveladoras:

- `MouseGrabDistance = 15`, `MouseDropDistance = 30`, `MouseSuccTime = 0.06`, `GiveUpTime = 9`, `StruggleRange = (3,3)`.

Fluxo:

1. `SeekingMouse`: tier `Charge`, alvo = posição do cursor menos o offset do bico. Se o bico chega a 15 px do cursor, escolhe um ponto de arraste a mais de 1,2 s de distância na velocidade de charge, traz a janela para foreground, toca `CHOMP` e passa a arrastar.
2. `DraggingMouseAway`: **prende o cursor** com `Cursor.Clip` num retângulo de 3×3 px que interpola do offset original até `StruggleRange`, criando o efeito de "luta". Solta quando chega a 30 px do alvo.
3. `Decelerating`: freia até menos de 80 px/s e volta para `Wander`.
4. Se 9 s passarem sem pegar o cursor, desiste.

Esse é o comportamento mais "hostil" do app: ele realmente sequestra o cursor. `EscToQuitOverlay` limpa o clip antes de sair, e `TickGame` limpa o clip no início de cada frame; a task o reaplica enquanto estiver arrastando.

### `RunCollectWindow` (base de meme/notepad/donate)

- `SetupScreenTargetAndBeakOffset`: escolhe a borda mais próxima e calcula o offset do bico em relação à janela.
- `WalkingOffscreen`: espera chegar ao alvo.
- `WaitingToBringWindowBack`: espera 2–3,5 s e então abre a janela em **outra thread** (`new Thread(() => form.ShowDialog()).Start()`), calcula um ponto de retorno clampado e passa a arrastar.
- `DraggingWindowBack`: a cada frame posiciona a janela em `head2EndPoint - offset`, esticando o pescoço; ao chegar, vira `Wander`.
- `OnGiftClosed`: se `Task_CanAttackMouse`, troca para `NabMouse`; senão volta para `Wander`.

Bug observado: `CollectMeme.GetNewTaskData` assina `FormClosing` **e** `RunCollectWindow.RunTask` assina de novo antes do `ShowDialog`. O handler roda duas vezes ao fechar a janela de meme (dois honks, dois `SetTaskByID`). `CollectNotepad` assina só uma vez.

### Janelas coletadas

- **Meme** (`SimpleImageForm`): 400×400, `PictureBox` com `Zoom`, imagem aleatória de `Assets/Images/Memes/`. Se a pasta falhar/estiver vazia, mostra um MessageBox e cai para **5 URLs do Reddit** via `LoadAsync` (única saída de rede do app).
- **Notepad** (`SimpleTextForm`): 200×150, título `Goose "Not-epad"`, texto de um `.txt` aleatório de `Assets/Text/NotepadMessages/`, fonte 10, ícone extraído de `%SystemRoot%\System32\notepad.exe`.
- **Donate** (`SimpleDonateForm`): 312×375 (250×300 × escala 1.25), fundo `DonatePage.png`, quatro botões invisíveis sobre as áreas clicáveis que abrem Patreon, PayPal, Twitter e Discord no navegador. Task não registrada.

---

## 5. Janela, input e saída

`Program.Main`:

- `Form` sem borda, `TopMost`, `ShowInTaskbar=false`, `TransparencyKey = Color.Coral`, tamanho da working area, posição `(0,0)`.
- `GetWindowLong(GWL_EXSTYLE)` guarda o estilo original; o estilo "passthrough" é `original | WS_EX_LAYERED (0x80000) | WS_EX_TRANSPARENT (0x20)`.
- `SetWindowPassthru(true)` é aplicado antes de tudo. `SetLayeredWindowAttributes` é declarado mas **nunca chamado**.

`EscToQuitOverlay`:

- segurar ESC soma `0.0021666668` por frame (≈ 0,26/s a 120 fps → ~3,8 s para 1,0);
- soltar subtrai `1/60` por frame;
- acima de 0,05 desenha a barra "Continue Holding ESC to evict goose" com easing exponencial;
- acima de 0,99 limpa o clip do cursor e chama `Application.Exit()`.

Input:

- `OSFunctions.RefreshInput` lê `Control.MouseButtons` e `Cursor.Position` para `SamEngine.Input`;
- `Program.GetAsyncKeyState(Keys.Escape)` é usado só para sair;
- o clique perto do ganso é detectado por distância (`< 30 px`), não por hit-testing de janela.

---

## 6. Áudio

`Sound` usa dois caminhos:

1. **MCI (`winmm.dll`)** para MP3:
   - `honkPlayer` → `Honk1..4.mp3`, volume 0.8;
   - `assortedEnvironment` → `MudSquith.mp3`;
   - `musicPlayer` → `Assets/Sound/Music/Music.mp3`, loop, volume 0.5 — só inicializa se o arquivo existir (o arquivo distribuído se chama `Rename me to just Music.mp3`, então **a música não toca por padrão**).
2. **`System.Media.SoundPlayer`** para os WAVs embutidos `Pat1`, `Pat2`, `Pat3` (recursos do assembly, ~133 KB no total).

`HONCC()` reutiliza o mesmo alias MCI: pausa, fecha, reabre com outro arquivo, ajusta volume e toca. `CHOMP()` faz o mesmo com `BITE.mp3` a volume 0.07. `SilenceSounds=True` bloqueia `Mp3Player.Play` e `PlayPat`, mas não impede a inicialização dos players.

---

## 7. Configuração (`config.ini`)

`GooseConfig.ConfigSettings` é lido por **reflexão**:

| Campo | Default |
|---|---|
| `Version_DoNotEdit` | `1` |
| `EnableMods` | `False` |
| `SilenceSounds` | `False` |
| `Task_CanAttackMouse` | `True` |
| `AttackRandomly` | `False` |
| `UseCustomColors` | `False` |
| `GooseDefaultWhite` | `#ffffff` |
| `GooseDefaultOrange` | `#ffa500` |
| `GooseDefaultOutline` | `#d3d3d3` |
| `MinWanderingTimeSeconds` | `20` |
| `MaxWanderingTimeSeconds` | `40` |
| `FirstWanderTimeSeconds` | `20` |

Parser:

- lê linha a linha, faz `Split('=')` e **só aceita exatamente 2 partes**;
- `Version_DoNotEdit != 1` → apaga e recria o arquivo;
- cada chave vira `FieldInfo` + `Convert.ChangeType`;
- `EnableMods=True` dispara um MessageBox de aviso; só carrega mods se o usuário clicar **Yes**.

Problemas reais observados no código:

- **Chave desconhecida apaga sua config.** `GetField` retorna `null`, o `SetValue` lança `NullReferenceException`, o `catch` interno tenta acessar `field.Name` e lança de novo; o `catch` externo interpreta como "config.ini corrupt!" e **deleta o arquivo**, recriando os defaults.
- Valor com `=` é ignorado (não entra no dicionário).
- Não há `Trim()`: `EnableMods = True` (com espaços) vira chave/valor inválidos.
- `float` usa a cultura atual: em pt-BR, `20.5` não converte (espera `20,5`); os defaults inteiros funcionam.
- Chave duplicada lança em `Dictionary.Add` → cai no catch externo → apaga a config.

---

## 8. Modding API

Contrato (`GooseModdingAPI.dll`, código-fonte também fornecido em `FOR MOD-MAKERS/`):

- interface `IMod { void Init(); }`;
- classe abstrata `GooseTaskInfo` com `taskID`, `shortName`, `description`, `canBePickedRandomly`, `GetNewTaskData`, `RunTask`;
- `InjectionPoints` com 7 eventos estáticos:
  - `PostModsLoaded`
  - `PreTick` / `PostTick`
  - `PreUpdateRig` / `PostUpdateRig`
  - `PreRender` / `PostRender`
- `API.Goose` (function pointers): `setSpeed`, `setTargetOffscreen`, `isGooseAtTarget`, `getDistanceToTarget`, `setCurrentTaskByID`, `chooseRandomTask`, `setTaskRoaming`, `playHonckSound`;
- `API.TaskDatabase`: `getTaskIndexByID`, `getAllLoadedTaskIDs`, `getRandomTaskID`;
- `API.Helper.getModDirectory`.

Carregamento (`ModSupport.LoadMods`):

1. para cada subpasta de `Assets/Mods/`, para cada `.dll`;
2. `Assembly.UnsafeLoadFrom(Path.GetFullPath(dll))`;
3. instancia **todo** tipo que implementa `IMod`;
4. instancia **toda** subclasse de `GooseTaskInfo` e registra no banco;
5. erro em qualquer DLL → MessageBox `Abort/Retry/Ignore` (Abort encerra o processo com exit code 1);
6. no fim, preenche os ponteiros de `API` e chama `Init()` de cada mod, depois `RaisePostModLoad()`.

Implicações:

- **não há sandbox, assinatura, allowlist ou verificação de hash**; mod é código .NET de confiança total no mesmo AppDomain;
- o DLL do mod **não deve** levar uma cópia de `GooseModdingAPI.dll` (a API já está no diretório do exe e é resolvida por nome);
- o aviso legal é a única barreira;
- `GetModDirectory` só funciona para mods registrados na inicialização.

O `GooseModdingAPI.dll` distribuído e o compilado em `FOR MOD-MAKERS/.../bin/Release` têm hashes diferentes, mas **a mesma contagem de metadata** (45 tipos, 147 métodos, 133 campos, 30 MemberRefs, 7 eventos). A diferença é de build (MVID `37000c81-…` vs `79656d58-…`), não de superfície de API.

---

## 9. Mod oficial Autumn (folhas)

`Assets/Mods/Autumn/Autumn.dll`:

- `ModEntryPoint` assina `PreTick`, `PostTick`, `PreRender`, `PostRender`;
- cria até **6** pilhas de folhas; primeira em 10 s, depois a cada 4,8–72 s;
- cada pilha tem 128 folhas com posição planar + altura Z, gravidade `-900 px/s²` (aplicada como `-7.5` por tick de 1/120), quique com restituição 0.3 e atrito 0.2;
- o ganso chuta a pilha quando chega a `rad + 4` px; a velocidade do chute é modulada pela porcentagem de velocidade entre `WalkSpeed` e `ChargeSpeed`;
- renderização em duas passadas (`PreRender` = folhas atrás do ganso; `PostRender` = folhas na frente), com sombra elíptica;
- registra a task `Autumn_ChaseLeafPile`, que sorteia uma pilha e corre em `Charge` para um ponto além do centro dela (para atravessar a pilha e chutá-la).

Detalhe suspeito: a classe `sks92j3qSIIS` (nome ofuscado de brincadeira) chama `SetWindowLong(GWL_EXSTYLE, 0x80000 | 0x08000000 | (perto ? 0 : 0x20))` a cada `PreTick`. Ou seja:

- cursor a **mais de 20 px** do ganso → `WS_EX_TRANSPARENT` **ligado** (cliques atravessam, comportamento normal);
- cursor a **menos de 20 px** → `WS_EX_TRANSPARENT` **desligado** (a janela fullscreen passa a interceptar cliques).

Isso parece um hack (ou bug) do mod: clicar perto do ganso pode "engolir" o clique em vez de repassar ao desktop. Não há uso de rede, registro, processo ou arquivo nesse DLL — o único P/Invoke é `user32!SetWindowLong`.

---

## 10. Remanescentes de Twitch / MMQ

- `IPCManager` existe, tem `ConnectedToTwitch` e um `ProcessMessages`, mas `Init()` e `ProcessMessages()` estão **vazios**. `ConnectedToTwitch` nunca é setado para `true`.
- `TwitchDesktopShared` sobrevive no assembly:
  - `MMQName_Twitch = "TwitchMessages"`, `MMQ_TwitchSize = 4096`;
  - `MMFMessage` serializa `"<tipo> <args>"` em UTF-8;
  - tipos `AttachToTwitch = 0`, `StartTask = 1`;
  - enum `GooseTask` com `Wander`, `NabMouse`, `CollectWindow_Meme`, `CollectWindow_Notepad`, `CollectWindow_Donate`, `CollectWindow_DONOTSET`, `TrackMud`.
- Bugs no código morto de Twitch:
  - o construtor `MMFMessage(MessageType, string[])` monta um `StringBuilder` mas **nunca atribui o resultado a `args`** — a mensagem sai com `args == null`;
  - `Helpers.MessageQueueExists(string name)` ignora o parâmetro e sempre testa o nome fixo `"TwitchMessages"`.
- `MMQ.dll` (biblioteca genérica de fila em memória compartilhada):
  - header de 24 bytes com cookies `0xDEADFEED`, `Version=1`, `FileLength`;
  - mutex `"<nome>.Mutex"`;
  - anel com ponteiros de leitura/escrita, mensagens com cookies `45054`/`49181`;
  - **não referenciado pelo exe** — é sobra do programa "Desktop Goose for Twitch" mencionado no changelog.

Conclusão: o suporte a Twitch foi removido/desligado nesta build, mas o protocolo e a biblioteca ficaram no pacote.

---

## 11. Código morto e dívida técnica

Confirmado por busca de referências no código decompilado:

| Item | Situação |
|---|---|
| `GooseDesktop.MainGame` + `GooseDesktop.TheGoose` (36 KB) | implementação antiga completa; `Program` chama `Refactor.MainGame`, então nada disso roda |
| `GooseDesktop.Form1` | nunca instanciado (`new Form()` é usado) |
| `Program.OpenSubform` | nunca chamado |
| `Program.SetLayeredWindowAttributes` | P/Invoke declarado, nunca usado |
| `CollectDonateWindow` + `SimpleDonateForm` | não registrados |
| `DemoTask` | não registrado |
| `GooseDesktop.HeartParticle` | só seria usado pela implementação antiga (`TheGoose`) |
| `GooseEntity.taskIndexQueue` | declarado, nunca usado |
| `TwitchDesktopShared.*` | sem uso |
| `MMQ.dll` | sem referência de assembly |
| `GooseDesktop.MainGame.curQuitAlpha` | duplicata do overlay novo |

Outros cheiros:

- `catch { }` silencioso em `SimpleTextForm` (ícone) e `SimpleImageForm` (fallback);
- `MessageBox` como tratamento de erro em código de jogo (tasks, config, mods);
- `Thread` cru para abrir formulário (`ShowDialog` em thread separada) sem `Join`/cancelamento;
- `BeginInvoke` sem checagem de handle destruído em `MovableForm`;
- strings de UI hard-coded em inglês;
- `Application.EnableVisualStyles()` chamado **depois** de criar o form principal.

---

## 12. Segurança e privacidade

Observado:

- Sem assinatura forte, sem ofuscação, sem anti-tamper, sem verificação de integridade.
- Mods = execução arbitrária de código .NET, por design. `Assembly.UnsafeLoadFrom` aceita qualquer DLL em subpasta de `Assets/Mods`.
- A única rede é o fallback de memes (`PictureBox.LoadAsync` para 5 URLs `i.redd.it`/`preview.redd.it`) quando a pasta de memes falha ou está vazia, e os links de doação abertos no navegador por clique.
- Sem telemetria, auto-update, persistência em registro ou tarefas agendadas.
- O app se mantém `TopMost` e com `WS_EX_TRANSPARENT`; não há hook de teclado global — só `GetAsyncKeyState(VK_ESCAPE)`.
- `Cursor.Clip` é usado de forma agressiva na task `NabMouse`: o clip é limpo no início de cada frame, reaplicado pela task durante o arraste e limpo de novo antes de sair.

Riscos/recomendações:

- Trate qualquer `.dll` em `Assets/Mods` como código confiável: ele roda com os mesmos privilégios do usuário.
- Não adicione chaves novas no `config.ini` sem backup — o parser pode apagar o arquivo (§7).
- Não redistribua uma build modificada: o README do jogo proíbe a redistribuição. Use as alterações apenas para estudo/uso pessoal.

---

## 13. Como reproduzir

Sem SDK .NET instalado, o caminho usado foi baixar o pacote NuGet do ILSpy e rodá-lo no runtime .NET 10 já presente:

```powershell
$dir = "$env:TEMP\ilspy"
$idx = Invoke-RestMethod "https://api.nuget.org/v3-flatcontainer/ilspycmd/index.json"
$v   = ($idx.versions | Where-Object { $_ -notmatch 'preview|beta|alpha|rc' })[-1]
Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/ilspycmd/$v/ilspycmd.$v.nupkg" -OutFile "$dir\ilspycmd.zip"
Expand-Archive "$dir\ilspycmd.zip" "$dir\pkg" -Force

$il = "$dir\pkg\tools\net10.0\any\ilspycmd.dll"
dotnet $il -p -o .\decompilado\GooseDesktop -r . .\GooseDesktop.exe
dotnet $il -p -o .\decompilado\GooseModdingAPI .\GooseModdingAPI.dll
dotnet $il -p -o .\decompilado\MMQ .\MMQ.dll
dotnet $il -p -o .\decompilado\Autumn -r . .\Assets\Mods\Autumn\Autumn.dll
```

> A árvore `decompilado/` é gerada localmente e **não é publicada**. Use uma
> cópia legal do jogo e não redistribua o resultado. O script
> [`../tools/decompile.ps1`](../tools/decompile.ps1) automatiza essa etapa.

O `.csproj` gerado pelo ILSpy contém um `HintPath` para `GooseModdingAPI.dll`;
ajuste se for recompilar. O projeto alvo é `net452` (ou `net48` para abrir no
Visual Studio atual). Para o ajuste dos recursos `Pat1..3` e o build, veja
[`COMPILAR.md`](COMPILAR.md).

---

## 14. O que ainda não sabemos (limites desta análise)

- **A análise estática foi complementada por análise dinâmica** (Frida): taxa de FPS, chamadas GDI+, custo de paint, dependência do MCI/timer e handles foram medidos. Ver `DINAMICA.md` e a seção 16. Ainda não confirmei em runtime: comportamento em multi-monitor, se o GIF do meme anima no `PictureBox`, nem o efeito visual exato do `WS_EX_TRANSPARENT` alternado pelo Autumn.
- A intenção do `swb()` do Autumn é inferida do efeito do código; não há comentário no assembly.
- O `GooseModdingAPI.dll` distribuído foi comparado por contagem de metadata, não por IL método a método; a superfície é idêntica, mas não afirmei igualdade byte a byte.
- `Pat1..3` são WAVs embutidos (usados por `SoundPlayer`), mas não extraí/validei o conteúdo.
- O fluxo de Twitch é reconstruível pelo protocolo MMQ, mas não há implementação ativa nesta build para confirmar o comportamento.

---

## 15. Próximos passos possíveis

1. **Mods**: criar uma task nova, um render hook (ex.: desenhar um chapéu), ou um mod que reage a eventos do Windows.
2. **Patch de comportamento**: mudar velocidades, remover o roubo de mouse, permitir música, corrigir o parser de config.
3. **Recompilar**: reconstruir o exe a partir do código decompilado (requer ajustes: recursos `Pat1..3`, `app.ico`, `GooseModdingAPI`). Ver [`COMPILAR.md`](COMPILAR.md).
4. **Reativar Twitch**: implementar `IPCManager` sobre `MMQ.dll` (`TwitchMessages`, 4096 bytes, mensagens `0/1`).
5. **Análise dinâmica (feito)**: foi executada com Frida; resultados em `DINAMICA.md` e na seção 16.

---

## 16. Análise dinâmica (resumo)

O app foi executado numa cópia de teste e instrumentado com Frida 17.24.3. Resultados principais:

- **~56–58 FPS em regime**, não 120. Frame de ~17,5 ms: ~9 ms de `Thread.Sleep(8)` + ~8 ms de pintura (GDI+ + `BitBlt`).
- **~47% de um núcleo** de CPU a ~58 FPS; handles GDI/USER estáveis em 13 s (25–28/24).
- Por frame: **10 `GdipDrawLineI`**, **5 `GdipFillEllipseI`**, 1 `GdipCreateFromHDC`/`GdipDeleteGraphics`, 1 `BitBlt`, 5 `DeleteObject`. A contagem bate com o `RenderGoose`.
- Por frame: `SetWindowPos` (TopMost), `ClipCursor` (`ClearCursorClip`), `GetAsyncKeyState` (ESC), 3× `PeekMessageW`, `InvalidateRect`, `SleepEx(8)`.
- **Simulação a ~0,47×** na instalação normal e **~0,27×** sem os MP3, porque a física usa `1/120 s` fixo por tick e o loop entrega ~56 ou ~33 ticks/s. `Time.time` é `Stopwatch` real, então timers/fades andam em tempo real enquanto o movimento anda em tempo simulado.
- **Dependência oculta de áudio:** abrir os MP3 via MCI MPEGVideo faz o `QUARTZ.dll` chamar `timeBeginPeriod(1)`; sem os MP3 (ou sem o codec), o `Sleep(8)` passa de ~9 ms para ~21,6 ms e o FPS cai para ~33. O jogo não chama `timeBeginPeriod` diretamente e `SilenceSounds=True` não evita o `open`.
- **Efeito colateral:** `OSFunctions.ClearCursorClip()` chama `ClipCursor` ~56 vezes/s e limpa qualquer clip de cursor de outros apps. `TopMost = true` a cada iteração chama `SetWindowPos` ~56 vezes/s.
- **DPI-unaware:** renderiza em 1707×1019 num display 2560×1600 @150% e o Windows upscala.

Detalhes, tabelas, scripts e evidências: [`DINAMICA.md`](DINAMICA.md),
[`../evidence/`](../evidence/) e [`../tools/dinamica/`](../tools/dinamica/).
