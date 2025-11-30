#!/usr/bin/env bash

# cdot‑RMM setup script
#
# This script boots the entire RMM platform with a single command.  It
# requires Docker to be installed on your machine.  On invocation it
# will build the Docker images and start all services defined in
# `infra/docker-compose.yml`.  Once complete, the backend services
# will be running on their respective ports (3000–3007).  You can
# verify the services via `docker ps` or by browsing to the
# network dashboard at http://localhost:3007.

set -e

error() {
  echo "[setup] $1" >&2
}

# Ensure Docker is installed
if ! command -v docker &>/dev/null; then
  error "Docker is required but not installed. Please install Docker and retry."
  exit 1
fi

# Determine the compose command.  Newer Docker versions support
# `docker compose` as a subcommand; older installations may use
# `docker-compose`.
COMPOSE_CMD="docker compose"
if ! $COMPOSE_CMD version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    error "docker compose is not available. Please install docker-compose."
    exit 1
  fi
fi

# Navigate to the script directory (repository root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[setup] Building and starting services using $COMPOSE_CMD..."
$COMPOSE_CMD -f infra/docker-compose.yml up -d --build

echo "[setup] All services are starting in the background. Use 'docker ps' to see running containers."
echo "[setup] You can access the network dashboard at http://localhost:3007 once it is ready."