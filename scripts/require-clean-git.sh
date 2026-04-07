#!/bin/bash
# Guard script: Prevent builds on dirty git tree
# Usage: ./scripts/require-clean-git.sh

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ ERROR: Uncommitted changes detected."
  echo ""
  echo "Git status:"
  git status --short
  echo ""
  echo "🛑 BLOCKED: Commit all changes before running build."
  echo "   Rule: Commit first, then build."
  echo ""
  exit 1
fi

echo "✅ Git tree is clean. Build allowed."
exit 0
