// Timing detalhado por frame: separa paint, gap, BitBlt e SleepEx.
// A/B: chama timeBeginPeriod(1) aos 3s e timeEndPeriod(1) aos 6s.

const winmm = Process.getModuleByName("winmm.dll");
const timeBeginPeriod = new NativeFunction(winmm.findExportByName("timeBeginPeriod"), "uint", ["uint"]);
const timeEndPeriod = new NativeFunction(winmm.findExportByName("timeEndPeriod"), "uint", ["uint"]);

let phase = "baseline";
let start = Date.now();
let nextReport = start + 1000;

let lastEndPaint = 0;
let beginPaintAt = 0;
let bitbltAt = 0;
let sleepAt = 0;
let sleepArg = -1;

const acc = {
  frames: 0,
  gaps: [],
  paints: [],
  bitblts: [],
  sleeps: [],
  sleepArgs: {},
  counts: {}
};

function bump(k) { acc.counts[k] = (acc.counts[k] || 0) + 1; }
function stats(a) {
  if (!a.length) return null;
  let min = a[0], max = a[0], sum = 0;
  for (const v of a) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { n: a.length, min: min, avg: Math.round(sum / a.length * 100) / 100, max: max };
}

function reportIfDue() {
  const now = Date.now();
  if (now < nextReport) return;
  const elapsed = (now - start) / 1000;
  send({
    t: Math.round(elapsed * 10) / 10,
    phase: phase,
    fps: acc.frames,
    counts: acc.counts,
    gap_ms: stats(acc.gaps),
    paint_ms: stats(acc.paints),
    bitblt_ms: stats(acc.bitblts),
    sleep_ms: stats(acc.sleeps),
    sleep_args: acc.sleepArgs
  });
  acc.frames = 0;
  acc.gaps = [];
  acc.paints = [];
  acc.bitblts = [];
  acc.sleeps = [];
  acc.sleepArgs = {};
  acc.counts = {};
  nextReport = now + 1000;

  if (phase === "baseline" && elapsed >= 3) {
    phase = "boosted";
    send({ event: "timeBeginPeriod(1)", ret: timeBeginPeriod(1), t: Math.round(elapsed * 10) / 10 });
  }
  if (phase === "boosted" && elapsed >= 6) {
    phase = "restored";
    send({ event: "timeEndPeriod(1)", ret: timeEndPeriod(1), t: Math.round(elapsed * 10) / 10 });
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
      const now = Date.now();
      if (key === "BeginPaint") {
        beginPaintAt = now;
        if (lastEndPaint > 0) acc.gaps.push(now - lastEndPaint);
        reportIfDue();
      } else if (key === "EndPaint") {
        if (beginPaintAt > 0) acc.paints.push(now - beginPaintAt);
        lastEndPaint = now;
        acc.frames++;
      } else if (key === "BitBlt") {
        bitbltAt = now;
      } else if (key === "SleepEx") {
        sleepAt = now;
        sleepArg = args[0].toInt32();
        acc.sleepArgs[sleepArg] = (acc.sleepArgs[sleepArg] || 0) + 1;
      }
    },
    onLeave(retval) {
      const now = Date.now();
      if (key === "BitBlt") acc.bitblts.push(now - bitbltAt);
      else if (key === "SleepEx") acc.sleeps.push(now - sleepAt);
    }
  });
}

["gdiplus.dll", "winmm.dll", "gdi32.dll", "user32.dll", "kernel32.dll", "ntdll.dll"].forEach(m => {
  try { Process.getModuleByName(m); } catch (e) { try { Module.load(m); } catch (e2) { send({ load_error: m + ": " + e2.message }); } }
});

hook("user32.dll", "BeginPaint", "BeginPaint");
hook("user32.dll", "EndPaint", "EndPaint");
hook("gdi32.dll", "BitBlt", "BitBlt");
hook("kernel32.dll", "SleepEx", "SleepEx");
hook("kernel32.dll", "Sleep", "Sleep");
hook("ntdll.dll", "NtDelayExecution", "NtDelayExecution");

send({ ready: true, pid: Process.id, arch: Process.arch });
