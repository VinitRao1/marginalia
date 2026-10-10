#!/bin/sh
# Imports and publishes the Marginalia workflows, then starts n8n.
# n8n reads published state at startup, so this runs before `n8n start`.
set -u

if [ "${MARGINALIA_AUTO_IMPORT:-true}" = "true" ]; then
  echo "[marginalia] Importing workflows from /marginalia/workflows"
  if n8n import:workflow --separate --input=/marginalia/workflows; then
    for id in MarginaliaResrch MarginaliaVoiceT; do
      if n8n publish:workflow --id="$id" >/dev/null 2>&1; then
        echo "[marginalia] Published $id"
      elif n8n update:workflow --id="$id" --active=true >/dev/null 2>&1; then
        echo "[marginalia] Activated $id (pre-2.0 n8n)"
      else
        echo "[marginalia] Could not publish $id. Open n8n and publish it manually."
      fi
    done
  else
    echo "[marginalia] Import failed; n8n will start without the workflows."
  fi
else
  echo "[marginalia] MARGINALIA_AUTO_IMPORT=false, leaving workflows untouched"
fi

exec n8n start
