// Function to generate a PR summary
function generatePRSummary(
  prDetails: PRDetails,
  changedFiles: File[],
  comments: Array<GithubComment>
): string {
  const totalFilesChanged = changedFiles.length;
  const totalLinesChanged = changedFiles.reduce(
    (sum, file) =>
      sum + file.chunks.reduce((lineSum, chunk) => lineSum + chunk.changes.length, 0),
    0
  );
  const totalComments = comments.length;

  const criticalComments = comments.filter((comment) =>
    /(security|vulnerability|error|critical)/i.test(comment.body)
  );

  return `
# PR Summary

- **Title**: ${prDetails.title}
- **Description**: ${prDetails.description}
- **Repository**: ${prDetails.owner}/${prDetails.repo}
- **PR Number**: ${prDetails.pull_number}

## Changes Overview
- **Files Changed**: ${totalFilesChanged}
- **Lines Changed**: ${totalLinesChanged}
- **Total AI Comments**: ${totalComments}
- **Critical Issues Identified**: ${criticalComments.length}

${
  criticalComments.length > 0
    ? `## Critical Findings
${criticalComments
  .map(
    (comment) => `
- **File**: ${comment.path}
  - **Line**: ${comment.line}
  - **Issue**: ${comment.body}
`
  )
  .join("\n")}
`
    : "No critical issues identified."
}
  `;
}

// Enhanced logging function to include summary
function logPRDocumentation(
  prDetails: PRDetails,
  changedFiles: File[],
  comments: Array<GithubComment>
) {
  const logFileName = `PR_${prDetails.pull_number}_log.md`;
  const summary = generatePRSummary(prDetails, changedFiles, comments);
  const logContent = `
${summary}

---

## Detailed AI Comments
${comments
  .map(
    (comment) => `
### File: ${comment.path}
- **Line**: ${comment.line}
- **Comment**: ${comment.body}
`
  )
  .join("\n")}
  `;

  writeFileSync(logFileName, logContent, "utf8");
  console.log(`Log saved to ${logFileName}`);
}

// Post summary as a comment on the PR
async function postPRSummary(
  owner: string,
  repo: string,
  pull_number: number,
  summary: string
): Promise<void> {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body: summary,
  });
}

// Update main to include summary generation and posting
async function main() {
  const prDetails = await getPRDetails();
  let diff: string | null;
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  if (eventData.action === "opened") {
    diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
    );
  } else if (eventData.action === "synchronize") {
    const newBaseSha = eventData.before;
    const newHeadSha = eventData.after;

    const response = await octokit.repos.compareCommits({
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
      owner: prDetails.owner,
      repo: prDetails.repo,
      base: newBaseSha,
      head: newHeadSha,
    });

    diff = String(response.data);
  } else {
    console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
    return;
  }

  if (!diff) {
    console.log("No diff found");
    return;
  }

  const changedFiles = parseDiff(diff);

  const excludePatterns = core
    .getInput("exclude")
    .split(",")
    .map((s) => s.trim());

  const filteredDiff = changedFiles.filter((file) => {
    return !excludePatterns.some((pattern) =>
      minimatch(file.to ?? "", pattern)
    );
  });

  const comments = await analyzeCode(filteredDiff, prDetails);

  // Save PR Documentation with Summary
  logPRDocumentation(prDetails, filteredDiff, comments);

  // Post PR Summary as a Comment
  const summary = generatePRSummary(prDetails, filteredDiff, comments);
  await postPRSummary(prDetails.owner, prDetails.repo, prDetails.pull_number, summary);

  if (comments.length > 0) {
    await createReviewComment(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number,
      comments
    );
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
