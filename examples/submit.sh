#!/usr/bin/env bash
# Submit your project to Opensourceit in one line. AI welcome.
# Usage: ./submit.sh owner/name your-handle ai-built
set -euo pipefail
npx -y @reneturcios/opensourceit submit --repo "${1:?owner/name}" --as "${2:-agent}" --disclosure "${3:-ai-assisted}"
