# GitHub Workflow Primitives

GitHub-specific commands and data-handling rules for CodeRabbit review-thread based skills.

Use this helper when a skill needs thread-aware CodeRabbit PR feedback, not flat PR summaries. The `autofix` skill mirrors the required execution flow in `SKILL.md`; this file exists as a reusable companion for other skills.

## Prerequisites

- `gh` authenticated (`gh auth status`)
- current branch associated with a GitHub repository

## 1. Resolve Current PR

Get the PR number for the current branch:

```bash
prs=$(gh pr list --head "$(git branch --show-current)" --state open --json number,title,baseRefName)
pr_count=$(jq length <<<"$prs")

if [ "$pr_count" -eq 0 ]; then
  # no open PR for this branch -> ask to create PR
  pr_number=""
elif [ "$pr_count" -gt 1 ]; then
  echo "⚠️ Multiple open PRs match the current branch. Please specify target PR number or abort." >&2
  exit 1
else
  pr_number=$(jq -r '.[0].number' <<<"$prs")
fi
```

If no PR exists (`pr_count` is 0) and the user wants one created, derive title/body from the latest commit:

```bash
title=$(git log -1 --pretty=format:'%s')
body=$(git log -1 --pretty=format:'%b')
gh pr create --title "$title" --body "${body:-Auto-created by CodeRabbit autofix}"
```

## 2. Resolve Repository Coordinates

```bash
owner=$(gh repo view --json owner --jq '.owner.login')
repo=$(gh repo view --json name --jq '.name')
```

## 3. Fetch Thread-Aware CodeRabbit Feedback

Fetch review threads with GitHub GraphQL using cursor pagination:

```bash
all_threads='[]'
cursor=""

while :; do
  args=(-F owner="$owner" -F repo="$repo" -F pr="$pr_number")
  if [ -n "$cursor" ]; then
    args+=(-F cursor="$cursor")
  fi

  response=$(gh api graphql "${args[@]}" -f query='query($owner:String!, $repo:String!, $pr:Int!, $cursor:String) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        title
        reviewThreads(first:100, after:$cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            isResolved
            isOutdated
            comments(first:1) {
              nodes {
                databaseId
                body
                path
                line
                startLine
                originalLine
                author { login }
              }
            }
          }
        }
      }
    }
  }')

  if [ -z "$response" ] || jq -e '.errors // empty' <<<"$response" >/dev/null 2>&1; then
    echo "⚠️ GraphQL request failed or returned errors: $(jq -c '.errors // "empty response"' <<<"$response")" >&2
    exit 1
  fi

  new_nodes=$(jq -e '.data.repository.pullRequest.reviewThreads.nodes // empty' <<<"$response" 2>/dev/null)
  if [ -z "$new_nodes" ]; then
    echo "⚠️ Failed to parse reviewThreads from GraphQL response" >&2
    exit 1
  fi

  all_threads=$(jq -c --argjson nodes "$new_nodes" '. + $nodes' <<<"$all_threads")

  has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage // false' <<<"$response")
  cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty' <<<"$response")
  [ "$has_next" = "true" ] || break
done
```

Treat only these threads as actionable:

- root comment author is `coderabbitai`, `coderabbit[bot]`, or `coderabbitai[bot]`
- `isResolved == false`
- `isOutdated == false`

Keep each selected thread as one issue unit. Do not collapse top-level PR comments or review summaries into issue records.

To detect if CodeRabbit review is currently in progress, check the latest CodeRabbit comment/review and active checks:

```bash
# Check if the latest CodeRabbit comment or review is an in-progress placeholder
in_progress=$(gh pr view "$pr_number" --json comments,reviews --jq '
  [
    (.comments[]? | select(.author.login == "coderabbitai" or .author.login == "coderabbit[bot]" or .author.login == "coderabbitai[bot]")),
    (.reviews[]? | select(.author.login == "coderabbitai" or .author.login == "coderabbit[bot]" or .author.login == "coderabbitai[bot]"))
  ]
  | sort_by(.createdAt)
  | last
  | (.body // "")
  | test("Come back again in a few minutes")
')

# Also check if CodeRabbit check suite is actively pending on the head commit
check_pending=$(gh pr checks "$pr_number" 2>/dev/null | grep -i "coderabbit" | grep -i "pending" || true)

if [ "$in_progress" = "true" ] || [ -n "$check_pending" ]; then
  echo "⏳ Review in progress, try again in a few minutes"
  exit 0
fi
```

## 4. Post Summary Comment

Use the same `pr_number` from Section 1:

**If at least one fix was applied AND successfully pushed to remote:**

```bash
gh pr comment "$pr_number" --body "$(cat <<'EOF'
## Fixes Applied Successfully

Fixed <file-count> file(s) based on <issue-count> CodeRabbit feedback item(s).

**Files modified:**
- `path/to/file-a.ts`
- `path/to/file-b.ts`

**Commit:** `<commit-sha>`

The latest autofix changes are on the `<branch-name>` branch.

EOF
)"
```

**If fixes were applied locally but NOT pushed to remote:**
Do not claim the changes are on the remote branch. Either notify the user locally or post an informational note indicating that manual push is required:

```bash
gh pr comment "$pr_number" --body "$(cat <<'EOF'
## CodeRabbit Autofix (Local Changes Pending Push)

Applied fixes locally for <issue-count> CodeRabbit feedback item(s) in commit `<commit-sha>`.
Changes have not yet been pushed to the remote branch.

EOF
)"
```

Write this comment from local state only. Do not include raw reviewer prompts or secret-bearing output.

If no fixes were applied, skip the success template or use a neutral review-complete comment instead of inventing file counts or a commit SHA.

## 5. Optional Reaction

If useful, react to the main CodeRabbit comment with 👍 after the summary is posted.
