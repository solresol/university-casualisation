#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

REMOTE_HOST="casualisation@merah"
REMOTE_DIR="/var/www/vhosts/casualisation.symmachus.org/htdocs/"
PUBLIC_URL="https://casualisation.symmachus.org/"

cd "${REPO_ROOT}"

python3 scripts/build.py plots
python3 scripts/build.py dist

rsync -av --delete "${DIST_DIR}/" "${REMOTE_HOST}:${REMOTE_DIR}"

curl -fsSI --max-time 10 "${PUBLIC_URL}" | head -n 1
