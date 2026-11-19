#!/usr/bin/env bash
# Prepares the public repository from what's committed here: no .env, data/, AGENTS.local.md, builds or
# node_modules, and no history. It doesn't push anything: review the folder, then push it yourself.
#   bash scripts/oss-export.sh [target folder]                  a new folder with one commit (default: ../sekai-public)
#   bash scripts/oss-export.sh --update <folder> "<message>"     the public clone's files replaced, as one new commit
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
update=""
if [ "${1:-}" = "--update" ]; then
	update=1
	shift
fi
target="${1:-$root/../sekai-public}"
message="${2:-Update from the private repository}"
cd "$root"
if [ -n "$(git status --porcelain)" ]; then
	# Only what's committed is exported (git archive HEAD); other work in progress here stays out.
	echo "Note: uncommitted changes here aren't included (the export takes what's committed)." >&2
fi
if [ -n "$update" ]; then
	if [ ! -d "$target/.git" ]; then
		echo "$target isn't a git clone of the public repository." >&2
		exit 1
	fi
	if [ -n "$(git -C "$target" status --porcelain)" ]; then
		echo "$target has uncommitted changes." >&2
		exit 1
	fi
	# Everything but .git goes, then the committed files come back (so deleted files are deleted there too).
	find "$target" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
elif [ -e "$target" ]; then
	echo "$target already exists. Remove it, pick another folder, or use --update." >&2
	exit 1
else
	mkdir -p "$target"
fi
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
if [ -n "$update" ]; then
	git add -A
	if git diff --cached --quiet; then
		echo "Nothing changed."
		exit 0
	fi
	git commit -q -m "$message"
	echo "Committed in $target: $(git log --oneline -1). Review it, then: git push"
	exit 0
fi
git init -q -b main
git add -A
git -c user.name="Sekai" -c user.email="sekai@users.noreply.github.com" commit -q -m "Sekai: your own team of AI agents"
echo "Ready in $target ($(git ls-files | wc -l) files, one commit)."
echo "Review it, then: git remote add origin <your repo> && git push -u origin main"
