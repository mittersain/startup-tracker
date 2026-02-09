#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install all workspace dependencies
npm install --prefix "$CLAUDE_PROJECT_DIR"

# Install functions dependencies (separate from monorepo workspaces)
npm install --prefix "$CLAUDE_PROJECT_DIR/functions"

# Build shared packages so other workspaces can resolve their types
npm run --prefix "$CLAUDE_PROJECT_DIR" build --workspace=packages/shared --workspace=packages/ai-prompts
