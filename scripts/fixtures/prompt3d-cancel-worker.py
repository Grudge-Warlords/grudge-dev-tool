"""Non-GPU fixture used only to prove Prompt-to-3D sidecar cancellation."""
import argparse
import os
import signal
import sys
import time
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--pid-file", required=True)
args, _unknown = parser.parse_known_args()
pid_file = Path(args.pid_file)
pid_file.write_text(f"{os.getpid()}\n", encoding="ascii")


def stop(_signal, _frame):
    pid_file.unlink(missing_ok=True)
    sys.exit(143)


signal.signal(signal.SIGTERM, stop)
while True:
    time.sleep(0.25)
