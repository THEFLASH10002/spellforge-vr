#!/bin/sh
# Build and publish dist/ to the gh-pages branch (GitHub Pages, HTTPS => WebXR works on any Quest).
set -e
npx vite build
rm -rf .deploy && git worktree prune
if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
  git worktree add -f .deploy origin/gh-pages --detach
else
  git worktree add -f --detach .deploy HEAD && (cd .deploy && git checkout --orphan gh-pages && git rm -rfq . )
fi
cp -r dist/. .deploy/
touch .deploy/.nojekyll
cd .deploy && git add -A && git commit -qm "Deploy $(date +%F-%H%M)" && git push -f origin HEAD:gh-pages
cd .. && git worktree remove --force .deploy
