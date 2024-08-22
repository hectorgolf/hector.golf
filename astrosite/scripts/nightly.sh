#!/bin/bash

echo "This is the nightly script running on $(date)"
echo "I have an environment variable TEETIME_USERNAME=$TEETIME_USERNAME"

echo "Now trying to run 'src/scripts/nightly.ts' with 'ts-node'..."
npx tsx src/scripts/nightly.ts
