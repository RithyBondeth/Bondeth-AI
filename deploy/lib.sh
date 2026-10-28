# Shared helpers for the deploy scripts (sourced, not run).

# env_get KEY: the value of KEY in ./.env, read as data. .env is never sourced, because
# values like `Bondeth AI <no-reply@...>` are not valid shell.
env_get() {
  [ -f .env ] || return 0
  local value
  value=$(grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-) || true
  value="${value%$'\r'}"
  case "$value" in \"*\") value="${value#\"}"; value="${value%\"}";; \'*\') value="${value#\'}"; value="${value%\'}";; esac
  printf '%s' "$value"
}
