#!/bin/bash

echo "This is the nightly script running on $(date)"
echo "I have an environment variable TEETIME_USERNAME=$TEETIME_USERNAME"
echo "The directory tree looks like this:"
tree -P '*.ts' -P '*.js' -P '*.sh' -P '*.json' -I '__azurite*' --gitignore --prune
echo "Now trying to run 'src/scripts/nightly.ts' with 'tsx'..."
npx tsx src/scripts/nightly.ts
