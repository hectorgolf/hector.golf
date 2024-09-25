#!/bin/bash

if [ "$GITHUB_ACTIONS" == "true" ]; then
    echo "This is the \"commit changes\" script running on $(date) as part of Github Actions workflow \"$GITHUB_WORKFLOW\""
else
    echo "This is the \"commit changes\" script running on $(date)"
fi

CHANGED_DATA_FILES=$(git status --short | egrep '^ M src/data/' | awk '{print $2}')

if [ "$CHANGED_DATA_FILES" != "" ]; then
    echo "Committing changes to the following data files:"
    for i in $CHANGED_DATA_FILES; do
        echo "- $i"
        git add "$i"
    done
    COMMIT_MESSAGE="$(printf "Github Action: $GITHUB_WORKFLOW\nGITHUB_EVENT_NAME: $GITHUB_EVENT_NAME\nGITHUB_RUN_NUMBER: $GITHUB_RUN_NUMBER\n")"
    git commit -m "$COMMIT_MESSAGE"
    git pull -r
    git push
else
    echo "No changes to data files detected.";
fi
