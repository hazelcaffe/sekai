#!/usr/bin/env bash
# Prepares the public repository: a clean copy of the files git tracks, with a fresh history (one commit), in a
# folder of its own. It doesn't publish anything: review the folder, then push it yourself.
#   bash scripts/oss-export.sh [target folder]        (default: ../sekai-public)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-$root/../sekai-public}"
cd "$root"
if [ -n "$(git status --porcelain)" ]; then
	echo "Commit or stash your changes first (the export takes what's committed)." >&2
	exit 1
fi
if [ -e "$target" ]; then
	echo "$target already exists. Remove it or pick another folder." >&2
	exit 1
fi
mkdir -p "$target"
# What's committed, nothing else: no .env, data/, AGENTS.local.md, builds or node_modules.
git archive --format=tar HEAD | tar -x -C "$target"
rm -f "$target/AGENTS.local.md"

# Things that must never be public: stop if any turn up.
leaks=$(grep -rIlE "(pgw_|sek_|fsh_)[A-Za-z0-9]{20,}|BEGIN (OPENSSH|RSA|EC) PRIVATE KEY|tskey-(auth|api)-[A-Za-z0-9]{6,}-[A-Za-z0-9]{12,}|xox[bp]-[A-Za-z0-9-]{20,}|ghp_[A-Za-z0-9]{30,}" "$target" || true)
if [ -n "$leaks" ]; then
	echo "Possible secrets in: $leaks" >&2
	echo "Nothing was committed. Remove them, then run this again." >&2
	exit 1
fi
# Your own details that mustn't be public (addresses, handles…): one pattern per line in .export-private
# (gitignored), if you keep one.
personal=""
if [ -f "$root/.export-private" ]; then
	personal=$(grep -rIlE -f <(grep -v '^\s*\(#\|$\)' "$root/.export-private") "$target" || true)
fi
if [ -n "$personal" ]; then
	echo "Personal details are still in: $personal" >&2
	echo "Nothing was committed. Clean them up in this repo, commit, then run this again." >&2
	exit 1
fi

cd "$target"
git init -q -b main
git add -A
git -c user.name="Sekai" -c user.email="sekai@users.noreply.github.com" commit -q -m "Sekai: your own team of AI agents"
echo "Ready in $target ($(git ls-files | wc -l) files, one commit)."
echo "Review it, then: git remote add origin <your repo> && git push -u origin main"
