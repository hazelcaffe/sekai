#!/usr/bin/env python3
"""Lists or reads source files for Sekai's code index. Runs on a bot's computer or devbox over SSH.

  scan.py scan ROOT          -> JSON {root, git, files: [[path, size, sha1], ...], skipped}
  scan.py read ROOT < paths  -> JSON {path: text|null}   (paths: a JSON list on stdin)
"""
import hashlib
import json
import os
import subprocess
import sys

MAX_FILE = 400_000
MAX_FILES = 20_000
SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "out", "target", "vendor", ".venv", "venv", "__pycache__",
    ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage", ".gradle", ".idea", ".vscode",
    "bower_components", "Pods", ".terraform", ".mypy_cache", ".pytest_cache", ".tox", "release",
}
SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".bmp", ".tiff", ".psd", ".svgz",
    ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war", ".class", ".so", ".dylib",
    ".dll", ".exe", ".bin", ".o", ".a", ".obj", ".wasm", ".pyc", ".mp3", ".mp4", ".mov", ".wav", ".ogg",
    ".webm", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".lock", ".map", ".db", ".sqlite", ".parquet",
    ".pkl", ".pt", ".onnx", ".npy", ".min.js", ".min.css",
}
SKIP_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "Cargo.lock", "poetry.lock", "composer.lock", "go.sum"}


def skipped_name(path):
    name = os.path.basename(path)
    if name in SKIP_NAMES:
        return True
    lower = name.lower()
    return any(lower.endswith(ext) for ext in SKIP_EXT)


def list_files(root):
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
            capture_output=True, timeout=60,
        )
        if out.returncode == 0:
            return True, [p for p in out.stdout.decode("utf-8", "replace").split("\0") if p]
    except Exception:
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            files.append(os.path.relpath(os.path.join(dirpath, f), root))
            if len(files) > MAX_FILES * 2:
                return False, files
    return False, files


def is_text(data):
    if b"\0" in data[:8192]:
        return False
    sample = data[:8192]
    if not sample:
        return True
    lines = sample.split(b"\n")
    # Minified or generated: very long lines.
    return sum(len(l) for l in lines) / max(1, len(lines)) < 400


def scan(root):
    git, paths = list_files(root)
    files, skipped = [], 0
    for p in paths:
        if any(part in SKIP_DIRS for part in p.split("/")[:-1]) or skipped_name(p):
            skipped += 1
            continue
        full = os.path.join(root, p)
        try:
            if not os.path.isfile(full) or os.path.islink(full):
                continue
            size = os.path.getsize(full)
            if size == 0 or size > MAX_FILE:
                skipped += 1
                continue
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        if not is_text(data):
            skipped += 1
            continue
        files.append([p, size, hashlib.sha1(data).hexdigest()])
        if len(files) >= MAX_FILES:
            break
    return {"root": root, "git": git, "files": files, "skipped": skipped}


def read(root, paths):
    out = {}
    for p in paths:
        full = os.path.normpath(os.path.join(root, p))
        if not full.startswith(os.path.normpath(root) + os.sep):
            out[p] = None
            continue
        try:
            with open(full, "rb") as fh:
                out[p] = fh.read(MAX_FILE).decode("utf-8", "replace")
        except OSError:
            out[p] = None
    return out


def main():
    cmd, root = sys.argv[1], os.path.realpath(os.path.expanduser(sys.argv[2]))
    if not os.path.isdir(root):
        print(json.dumps({"error": "%s isn't a folder" % root}))
        return
    if cmd == "scan":
        print(json.dumps(scan(root)))
    else:
        print(json.dumps(read(root, json.load(sys.stdin))))


main()
