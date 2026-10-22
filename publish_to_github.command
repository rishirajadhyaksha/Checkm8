#!/bin/bash
cd "$(dirname "$0")" || exit 1
set -e
[ -d .git ] || git init -b main
git add -A
git commit -m "Checkm8: chess platform, bot arena, game room fixes, Python bot" || true
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh repo create checkm8 --private --source=. --remote=origin --push || git push -u origin main
else
  echo
  echo "Committed locally. gh (GitHub CLI) isn't set up, so to publish:"
  echo "  1. Create an empty repo at https://github.com/new (name: checkm8, no README)"
  echo "  2. Run:  git remote add origin https://github.com/<you>/checkm8.git && git push -u origin main"
fi
echo; read -n 1 -s -r -p "Done. Press any key to close."
