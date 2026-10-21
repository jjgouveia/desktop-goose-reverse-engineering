import ctypes
import json
import sys
import time

import frida

pid = int(sys.argv[1])
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 13.0
outfile = sys.argv[3] if len(sys.argv) > 3 else "events_ab.jsonl"

with open("dyn_ab.js", "r", encoding="utf-8") as f:
    source = f.read()

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32.OpenProcess.restype = ctypes.c_void_p
kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
user32.GetGuiResources.restype = ctypes.c_uint32
user32.GetGuiResources.argtypes = [ctypes.c_void_p, ctypes.c_uint32]

h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
samples = []


def sample_handles():
    if not h:
        return None
    return {"gdi": int(user32.GetGuiResources(h, 0)), "user": int(user32.GetGuiResources(h, 1))}


session = frida.attach(pid)
script = session.create_script(source)
events = []


def on_message(message, data):
    if message.get("type") == "send":
        payload = message.get("payload")
        events.append(payload)
        line = json.dumps(payload, ensure_ascii=False)
        print(line, flush=True)
        with open(outfile, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    elif message.get("type") == "error":
        print("SCRIPT ERROR: " + message.get("stack", message.get("description", "?")), flush=True)


script.on("message", on_message)
script.load()

t0 = time.time()
next_sample = t0
while time.time() - t0 < duration:
    now = time.time()
    if now >= next_sample:
        samples.append(sample_handles())
        next_sample = now + 1.0
    time.sleep(0.1)

try:
    session.detach()
except Exception:
    pass

print(json.dumps({"done": True, "events": len(events), "handle_samples": samples}, ensure_ascii=False), flush=True)
