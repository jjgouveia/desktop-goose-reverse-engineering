// Captura o startup: comandos MCI e chamadas de resolucao de timer.
// Tambem mede FPS apos o startup.

const counts = {};
function bump(k) { counts[k] = (counts[k] || 0) + 1; }
let lastPaint = 0;
let paintTimes = [];
let start = Date.now();
let nextReport = start + 1000;

const winmm = Process.getModuleByName("winmm.dll");
const ntdll = Process.getModuleByName("ntdll.dll");
const kernel32 = Process.getModuleByName("kernel32.dll");

const mci = winmm.findExportByName("mciSendStringW");
if (mci) {
  Interceptor.attach(mci, {
    onEnter(args) {
      let cmd = null;
      try { cmd = args[0].readUtf16String(); } catch (e) { cmd = "<erro:" + e.message + ">"; }
      send({ mci: cmd });
    },
    onLeave(retval) {
      send({ mci_ret: retval.toInt32() });
    }
  });
} else {
  send({ hook_error: "mciSendStringW" });
}

const ntset = ntdll.findExportByName("NtSetTimerResolution");
if (ntset) {
  Interceptor.attach(ntset, {
    onEnter(args) {
      this.actualPtr = args[2];
      let caller = null;
      try { const _m = Process.findModuleByAddress(this.returnAddress); caller = _m ? (_m.name + "+0x" + this.returnAddress.sub(_m.base).toString(16)) : this.returnAddress.toString(); } catch (e) { caller = e.message; }
      send({ ntSetTimerResolution_enter: { desired_100ns: args[0].toInt32(), set: args[1].toInt32(), caller: caller } });
    },
    onLeave(retval) {
      let actual = null;
      try { actual = this.actualPtr.readU32(); } catch (e) { actual = null; }
      send({ ntSetTimerResolution_leave: { status: retval.toInt32(), actual_100ns: actual } });
    }
  });
} else {
  send({ hook_error: "NtSetTimerResolution" });
}

for (const fn of ["timeBeginPeriod", "timeEndPeriod"]) {
  const p = winmm.findExportByName(fn);
  if (p) {
    Interceptor.attach(p, {
      onEnter(args) {
        let caller = null;
        try { const _m = Process.findModuleByAddress(this.returnAddress); caller = _m ? (_m.name + "+0x" + this.returnAddress.sub(_m.base).toString(16)) : this.returnAddress.toString(); } catch (e) { caller = e.message; }
        send({ timer_api: fn, arg: args[0].toInt32(), caller: caller });
      }
    });
  }
}

const bp = Process.getModuleByName("user32.dll").findExportByName("BeginPaint");
Interceptor.attach(bp, {
  onEnter() {
    const now = Date.now();
    if (lastPaint > 0) paintTimes.push(now - lastPaint);
    lastPaint = now;
    if (now >= nextReport) {
      let avg = 0;
      if (paintTimes.length) avg = paintTimes.reduce((a, b) => a + b, 0) / paintTimes.length;
      send({ t: Math.round((now - start) / 100) / 10, fps: paintTimes.length, avg_interval_ms: Math.round(avg * 100) / 100 });
      paintTimes = [];
      nextReport = now + 1000;
    }
  }
});

send({ ready: true, pid: Process.id, arch: Process.arch });
