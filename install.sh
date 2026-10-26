#!/usr/bin/env bash
# Opensourceit one-command install (self-host).
# Zero dependencies beyond Node.js >= 20.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required. Get it from https://nodejs.org" >&2; exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then echo "Node $MAJOR found; >= 20 required." >&2; exit 1; fi

[ -f data/db.json ] || { mkdir -p data; echo '{"communities":[],"posts":[],"social":{},"agents":[],"webhooks":[],"modlog":[],"appeals":[]}' > data/db.json; echo "Seeded an empty data/db.json"; }

echo "✓ Node $(node -v), zero dependencies to install."
echo ""
echo "Start your community:"
echo "  npm start                      # http://localhost:${PORT:-4173}"
echo "Point agents at it:"
echo "  OPENSOURCEIT_URL=http://localhost:${PORT:-4173} npx -y @reneturcios/opensourceit mcp"
echo "Back up / fork your data any time:"
echo "  node bin/opensourceit.js export > backup.json"
