#!/bin/bash

# Get version - you'll need to pass this as an argument or set it another way
if [ -n "$1" ]; then
    version="$1"
else
    # Extract version from package.json more reliably
    version=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
    
    # Fallback to grep/sed if node method fails
    if [ -z "$version" ]; then
        version=$(grep '"version":' package.json | head -n1 | sed -E 's/.*"version": "([^"]+)".*/\1/' | tr -d '\n\r')
    fi
fi

# Clean the version string of any whitespace/newlines
version=$(echo "$version" | tr -d '\n\r' | xargs)

# Validate version format
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid version format '$version'. Expected format: x.y.z"
    exit 1
fi

echo "Processing version: $version"

repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ]; then
    origin_url=$(git remote get-url origin)
    repo=$(echo "$origin_url" | sed -E 's#^git@github.com:([^/]+/[^.]+)(\.git)?$#\1#; s#^https://github.com/([^/]+/[^.]+)(\.git)?$#\1#')
fi

if [[ ! "$repo" =~ ^[^/]+/[^/]+$ ]]; then
    echo "Error: Could not determine GitHub repository from GITHUB_REPOSITORY or origin remote"
    exit 1
fi

echo "Publishing against repository: $repo"

remote_tag_exists=false
release_exists=false

if git ls-remote --tags origin | grep -q "refs/tags/$version$"; then
    remote_tag_exists=true
fi

if gh release view "$version" --repo "$repo" >/dev/null 2>&1; then
    release_exists=true
fi

if [ "$remote_tag_exists" = true ] && [ "$release_exists" = true ]; then
    echo "Version $version is already tagged and released; nothing to publish."
    exit 0
fi

if [ "$release_exists" = true ] && [ "$remote_tag_exists" = false ]; then
    echo "Error: GitHub release '$version' exists but remote tag is missing"
    exit 1
fi

echo "Version checks passed - proceeding with release creation"

# Verify build assets exist before tagging
for asset in main.js manifest.json styles.css; do
    if [ ! -f "$asset" ]; then
        echo "Error: Missing release asset '$asset'. Run pnpm run build before publishing."
        exit 1
    fi
done

# Get release notes from either "# 1.2.3" or "## 1.2.3" changelog headings.
awk -v version="$version" '
BEGIN { found=0; content="" }
/^#{1,2} [0-9]+\.[0-9]+\.[0-9]+/ {
    if (found) { exit }
    if ($2 ~ "^"version"($| \\()") { found=1; next }
}
found { content = content $0 "\n" }
END { printf "%s", content }
' CHANGELOG.md > release_notes.txt

# Set NOTES variable to the content of release_notes.txt
NOTES=$(cat release_notes.txt)
if [ -z "$NOTES" ]; then
    NOTES="Release $version"
fi

# Create and push tag when this is the first publish attempt. If a previous run
# pushed the tag but failed before creating the release, reuse the existing tag.
git config user.name "GitHub Actions"
git config user.email "actions@github.com"
if [ "$remote_tag_exists" = false ]; then
    if git tag -l | grep -q "^$version$"; then
        echo "Error: Local git tag '$version' exists but remote tag is missing"
        exit 1
    fi

    git tag -a "$version" -m "Release version $version"
    git push origin "$version"
fi

# Create release
gh release create "$version" \
--repo="$repo" \
--title="$version" \
--notes="$NOTES" \
main.js manifest.json styles.css
