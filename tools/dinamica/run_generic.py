import json
import sys
import time

import frida

pid = int(sys.argv[1])
duration = float(sys.argv[2])
script_path = sys.argv[3]
outfile = sys.argv[4]

with open(script_path, "r", encoding="utf-8") as f:
    source = f.read()

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
time.sleep(duration)
try:
    session.detach()
except Exception:
    pass
print(json.dumps({"done": True, "events": count}), flush=True)
