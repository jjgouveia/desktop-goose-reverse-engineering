// Instrumentacao Frida para Desktop Goose v0.31 (32-bit, .NET Framework/WinForms/GDI+)
// Conta chamadas nativas por segundo sem alterar o comportamento do app.

const counts = {};
function bump(k) { counts[k] = (counts[k] || 0) + 1; }

const paintTimes = [];
let lastPaint = 0;
let start = Date.now();
let nextReport = start + 1000;

function reportIfDue() {
  const now = Date.now();
  if (now < nextReport) return;
  const elapsed = (now - start) / 1000;
  const n = paintTimes.length;
  let min = 0, max = 0, avg = 0;
  if (n > 0) {
    min = Math.min.apply(null, paintTimes);
    max = Math.max.apply(null, paintTimes);
    avg = paintTimes.reduce((a, b) => a + b, 0) / n;
  }
  const out = { t: Math.round(elapsed * 10) / 10, counts: counts, paint_intervals_ms: { n, min, avg: Math.round(avg * 100) / 100, max } };
  send(out);
  for (const k in counts) delete counts[k];
  paintTimes.length = 0;
  nextReport = now + 1000;
}

function hook(modName, exportName, key) {
  let mod = null;
  try { mod = Process.getModuleByName(modName); } catch (e) { }
  if (mod === null) {
    try { mod = Module.load(modName); } catch (e) { send({ hook_error: modName + " load: " + e.message }); return; }
  }
  const addr = mod.findExportByName(exportName);
  if (addr === null) { send({ hook_error: exportName + " not found in " + modName }); return; }
  Interceptor.attach(addr, {
    onEnter(args) {
      bump(key);
      if (key === "BeginPaint") {
        const now = Date.now();
        if (lastPaint > 0) paintTimes.push(now - lastPaint);
        lastPaint = now;
        reportIfDue();
      }
      if (key === "Sleep") {
        const ms = args[0].toInt32();
        if (ms === 8) bump("Sleep_8ms"); else bump("Sleep_other");
      }
    }
  });
}

// Garante que as DLLs de interesse estao carregadas
["gdiplus.dll", "winmm.dll", "gdi32.dll", "user32.dll", "kernel32.dll"].forEach(m => {
  try { Process.getModuleByName(m); } catch (e) { try { Module.load(m); } catch (e2) { send({ load_error: m + ": " + e2.message }); } }
});

// Loop / pintura
hook("user32.dll", "BeginPaint", "BeginPaint");
hook("user32.dll", "EndPaint", "EndPaint");
hook("user32.dll", "InvalidateRect", "InvalidateRect");
hook("user32.dll", "PeekMessageW", "PeekMessageW");
hook("user32.dll", "SetWindowPos", "SetWindowPos");
hook("user32.dll", "GetAsyncKeyState", "GetAsyncKeyState");
hook("user32.dll", "ClipCursor", "ClipCursor");
hook("kernel32.dll", "Sleep", "Sleep");

// GDI (double buffer)
hook("gdi32.dll", "BitBlt", "BitBlt");
hook("gdi32.dll", "CreateCompatibleDC", "CreateCompatibleDC");
hook("gdi32.dll", "CreateCompatibleBitmap", "CreateCompatibleBitmap");
hook("gdi32.dll", "DeleteObject", "DeleteObject");

// GDI+ (desenho do ganso, sombra, texto)
hook("gdiplus.dll", "GdipCreateFromHDC", "GdipCreateFromHDC");
hook("gdiplus.dll", "GdipDeleteGraphics", "GdipDeleteGraphics");
hook("gdiplus.dll", "GdipDrawLine", "GdipDrawLine");
hook("gdiplus.dll", "GdipDrawLineI", "GdipDrawLineI");
hook("gdiplus.dll", "GdipFillEllipse", "GdipFillEllipse");
hook("gdiplus.dll", "GdipFillEllipseI", "GdipFillEllipseI");
hook("gdiplus.dll", "GdipFillRectangleI", "GdipFillRectangleI");
hook("gdiplus.dll", "GdipDrawString", "GdipDrawString");
hook("gdiplus.dll", "GdipFillPath", "GdipFillPath");
hook("gdiplus.dll", "GdipDrawPath", "GdipDrawPath");

// Audio (MCI)
hook("winmm.dll", "mciSendStringW", "mciSendStringW");

send({ ready: true, pid: Process.id, arch: Process.arch, pointerSize: Process.pointerSize });
