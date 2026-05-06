#!/bin/bash

IMAGE_DIR="../../astrosite/src/data/players/images"

for original in "$IMAGE_DIR/originals"/*.jpeg; do
    filename=$(basename "$original")
    name="${filename%.*}"
    avatar="$IMAGE_DIR/avatars/${name}.png"
    if [ ! -f "$avatar" ]; then
        echo "Generating avatar for $original..."
        npm run cli:generate-player-avatar -- \
            "$original" \
            "$IMAGE_DIR/avatars/sample.png" \
            "$avatar"
    else
        echo "Avatar already exists for $original, skipping."
    fi
done
