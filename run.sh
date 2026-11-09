#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="${WEBAPI_IMAGE:-questacase-webapi:latest}"
NETWORK_NAME="${DOCKER_NETWORK:-questacase}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not available." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is required." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 0600 .env
  echo "Created $SCRIPT_DIR/.env. Configure the bucket and service addresses, then run ./run.sh again." >&2
  exit 1
fi

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Image $IMAGE_NAME does not exist. Run ./build.sh first." >&2
  exit 1
fi

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  docker network create "$NETWORK_NAME" >/dev/null
fi

connect_if_running() {
  local container="$1"
  local alias="$2"
  if docker container inspect "$container" >/dev/null 2>&1; then
    docker network connect --alias "$alias" "$NETWORK_NAME" "$container" 2>/dev/null || true
  fi
}

connect_if_running legal-kafka kafka
connect_if_running questacase-neo4j neo4j
connect_if_running questacase-qdrant qdrant

docker compose --env-file .env up --detach --no-build
docker compose --env-file .env ps
echo "QuestaCase API is starting on http://127.0.0.1:${API_PORT:-8080}/api/v1/health"
