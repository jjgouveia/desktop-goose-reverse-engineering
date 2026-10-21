import json
import sys
import time

import frida

exe = sys.argv[1]
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
outfile = sys.argv[3] if len(sys.argv) > 3 else "events_startup.jsonl"

with open("startup.js", "r", encoding="utf-8") as f:
    source = f.read()

pid = frida.spawn(exe, cwd=exe.rsplit("\\", 1)[0])
session = frida.attach(pid)
script = session.create_script(source)
count = 0


def on_message(message, data):
    global count
    if message.get("type") == "send":
        count += 1
        line = json.dumps(message.get("payload"), ensure_ascii=False)
        print(line, flush=True)
        with open(outfile, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    elif message.get("type") == "error":
        print("SCRIPT ERROR: " + message.get("stack", message.get("description", "?")), flush=True)


script.on("message", on_message)
script.load()
frida.resume(pid)
print(json.dumps({"spawned": True, "pid": pid}), flush=True)
time.sleep(duration)
try:
    session.detach()
except Exception:
    pass
try:
    frida.kill(pid)
except Exception:
    pass
print(json.dumps({"done": True, "events": count}), flush=True)
