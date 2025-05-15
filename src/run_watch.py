import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import subprocess
import time

class ReloadHandler(FileSystemEventHandler):
    def __init__(self, command):
        self.command = command
        self.process = subprocess.Popen(self.command)

    def on_any_event(self, event):
        if event.src_path.endswith(".py"):
            print("🔁 Cambios detectados, reiniciando...")
            self.process.kill()
            self.process = subprocess.Popen(self.command)

if __name__ == "__main__":
    path = "."
    command = ["python", "main.py"]  # o cambia a ["flet", "run", "main.py"]
    event_handler = ReloadHandler(command)
    observer = Observer()
    observer.schedule(event_handler, path, recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
