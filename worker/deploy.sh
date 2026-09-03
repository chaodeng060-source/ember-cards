#!/usr/bin/env bash
# 部署到 Cloudflare。凭证从环境变量 CLOUDFLARE_API_TOKEN 取；
# 没设的话会读 $EMBER_ENV_FILE（默认 ~/.config/ember-cards.env，格式 KEY=VALUE，不进仓库）。
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${EMBER_ENV_FILE:-$HOME/.config/ember-cards.env}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
cmd="${1:-deploy}"
case "$cmd" in
  whoami) exec npx wrangler whoami ;;
  deploy) exec npx wrangler deploy ;;
  *) echo "usage: $0 [whoami|deploy]" >&2; exit 2 ;;
esac
