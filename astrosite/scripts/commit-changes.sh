#!/bin/bash

echo "This is the nightly "commit changes" script running on $(date)"

CHANGED_DATA_FILES=$(git status --short | egrep '^ M src/data/' | awk '{print $2}')
echo "Committing changes to the following data files:"
for i in $CHANGED_DATA_FILES; do
  echo "- $i"
  git add "$i"
done
COMMIT_MESSAGE="$(printf "Update data files\nGITHUB_WORKFLOW=$GITHUB_WORKFLOW\nGITHUB_RUN_ID=$GITHUB_RUN_ID\nGITHUB_ACTION=$GITHUB_ACTION")"
git commit -m "$COMMIT_MESSAGE"
git push
