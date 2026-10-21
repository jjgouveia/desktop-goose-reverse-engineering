// A/B causal test: mede FPS antes/depois de timeBeginPeriod(1) no proprio processo.
// Tambem conta o blit do double buffer via GDI+ (GdipDrawImage*) e o clear do buffer.

const counts = {};
function bump(k) { counts[k] = (counts[k] || 0) + 1; }

const paintTimes = [];
let lastPaint = 0;
const start = Date.now();
let nextReport = start + 1000;
let phase = "baseline";

const winmm = Process.getModuleByName("winmm.dll");
const pTimeBeginPeriod = winmm.findExportByName("timeBeginPeriod");
const pTimeEndPeriod = winmm.findExportByName("timeEndPeriod");
const timeBeginPeriod = new NativeFunction(pTimeBeginPeriod, "uint", ["uint"]);
const timeEndPeriod = new NativeFunction(pTimeEndPeriod, "uint", ["uint"]);

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
  send({
    t: Math.round(elapsed * 10) / 10,
    phase: phase,
    fps: n,
    counts: counts,
    paint_intervals_ms: { n: n, min: min, avg: Math.round(avg * 100) / 100, max: max }
  });
  for (const k in counts) delete counts[k];
  paintTimes.length = 0;
  nextReport = now + 1000;

  if (phase === "baseline" && elapsed >= 4) {
    phase = "boosted";
    const r = timeBeginPeriod(1);
    send({ event: "timeBeginPeriod(1)", ret: r, t: Math.round(elapsed * 10) / 10 });
  }
  if (phase === "boosted" && elapsed >= 8) {
    phase = "restored";
    const r = timeEndPeriod(1);
    send({ event: "timeEndPeriod(1)", ret: r, t: Math.round(elapsed * 10) / 10 });
  }
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
    }
  });
}

["gdiplus.dll", "winmm.dll", "gdi32.dll", "user32.dll"].forEach(m => {
  try { Process.getModuleByName(m); } catch (e) { try { Module.load(m); } catch (e2) { send({ load_error: m + ": " + e2.message }); } }
});

hook("user32.dll", "BeginPaint", "BeginPaint");
hook("user32.dll", "EndPaint", "EndPaint");
hook("user32.dll", "PeekMessageW", "PeekMessageW");
hook("user32.dll", "SetWindowPos", "SetWindowPos");
hook("user32.dll", "GetAsyncKeyState", "GetAsyncKeyState");
hook("user32.dll", "ClipCursor", "ClipCursor");

hook("gdi32.dll", "BitBlt", "BitBlt");
hook("gdi32.dll", "StretchBlt", "StretchBlt");
hook("gdi32.dll", "AlphaBlend", "AlphaBlend");

hook("gdiplus.dll", "GdipCreateFromHDC", "GdipCreateFromHDC");
hook("gdiplus.dll", "GdipDeleteGraphics", "GdipDeleteGraphics");
hook("gdiplus.dll", "GdipDrawLineI", "GdipDrawLineI");
hook("gdiplus.dll", "GdipFillEllipseI", "GdipFillEllipseI");
hook("gdiplus.dll", "GdipDrawImage", "GdipDrawImage");
hook("gdiplus.dll", "GdipDrawImageI", "GdipDrawImageI");
hook("gdiplus.dll", "GdipDrawImageRectI", "GdipDrawImageRectI");
hook("gdiplus.dll", "GdipGraphicsClear", "GdipGraphicsClear");
hook("gdiplus.dll", "GdipFillRectangleI", "GdipFillRectangleI");

send({ ready: true, pid: Process.id, arch: Process.arch, timeBeginPeriod: pTimeBeginPeriod.toString(), timeEndPeriod: pTimeEndPeriod.toString() });
