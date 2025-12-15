#!/usr/bin/env bash
# Enable local dev fake OpenAI provider
set -e
ENVFILE=.env.local
if [ -f "$ENVFILE" ]; then
  echo "$ENVFILE already exists; updating values"
else
  echo "Creating $ENVFILE"
fi
cat > $ENVFILE <<EOF
# Local development fake OpenAI provider
DEV_USE_FAKE_OPENAI=1
# A harmless marker key to avoid accidental production use
OPENAI_API_KEY=dev-key
EOF
chmod 600 $ENVFILE
echo "Wrote $ENVFILE. Remember: this is for local development only and must NOT be used in production."
