#!/bin/bash

echo "This is the nightly "commit changes" script running on $(date)"
echo "git status --short | egrep '^ M src/data/' | awk '{print $2}':"
CHANGED_DATA_FILES=$(git status --short | egrep '^ M src/data/' | awk '{print $2}')

echo "TODO: Commit the following changed data files:"
for i in $CHANGED_DATA_FILES; do
  echo "- $i"
done
