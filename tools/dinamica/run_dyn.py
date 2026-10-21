import json
import sys
import time

import frida

pid = int(sys.argv[1])
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
outfile = sys.argv[3] if len(sys.argv) > 3 else "events.jsonl"

with open("dyn.js", "r", encoding="utf-8") as f:
    source = f.read()

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
time.sleep(duration)
try:
    session.detach()
except Exception:
    pass

print(json.dumps({"done": True, "events": len(events)}, ensure_ascii=False), flush=True)
