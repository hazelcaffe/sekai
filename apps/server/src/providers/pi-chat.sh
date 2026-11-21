#!/bin/sh
# The adapter reports native tool calls after the fact, not as approval requests.
exec "$SEKAI_PI_EXECUTABLE" --no-tools --no-mcp --no-extensions --no-skills --no-prompt-templates --no-context-files "$@"
