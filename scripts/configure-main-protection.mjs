const repository = process.env.GITHUB_REPOSITORY ?? "NeelM0906/Mauz";
const branch = process.env.PROTECTED_BRANCH ?? "main";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const requiredChecks = ["Quality gates", "Security audit"];

if (!token) {
  console.error("Set GITHUB_TOKEN or GH_TOKEN to a GitHub token with repository administration permission.");
  process.exit(1);
}

const response = await fetch(`https://api.github.com/repos/${repository}/branches/${branch}/protection`, {
  method: "PUT",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  },
  body: JSON.stringify({
    required_status_checks: {
      strict: true,
      contexts: requiredChecks
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismissal_restrictions: {},
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 1,
      require_last_push_approval: true,
      bypass_pull_request_allowances: {}
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: false
  })
});

if (!response.ok) {
  const body = await response.text();
  console.error(`GitHub branch protection request failed with HTTP ${response.status}.`);
  console.error(body);
  process.exit(1);
}

console.log(`Protected ${repository}:${branch} with required checks: ${requiredChecks.join(", ")}.`);
