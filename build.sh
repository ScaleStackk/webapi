#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="${WEBAPI_IMAGE:-questacase-webapi:latest}"
TARGET_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not available." >&2
  exit 1
fi

echo "Building $IMAGE_NAME for $TARGET_PLATFORM"
docker build --platform "$TARGET_PLATFORM" --tag "$IMAGE_NAME" .
docker image inspect "$IMAGE_NAME" --format 'Built {{.RepoTags}} ({{.Os}}/{{.Architecture}})'
