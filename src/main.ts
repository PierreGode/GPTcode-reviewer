import { writeFileSync } from "fs"; // Add writeFileSync to save logs

// Function to log PR details and comments to a file
function logPRDocumentation(
  prDetails: PRDetails,
  changedFiles: File[],
  comments: Array<GithubComment>
) {
  const logFileName = `PR_${prDetails.pull_number}_log.md`;
  const logContent = `
# Pull Request Documentation

## PR Metadata
- **Title**: ${prDetails.title}
- **Description**: ${prDetails.description}
- **Repository**: ${prDetails.owner}/${prDetails.repo}
- **PR Number**: ${prDetails.pull_number}

---

## Changed Files
${changedFiles.map((file) => `- ${file.to}`).join("\n")}

---

## AI Comments
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

// Enhanced Prompt for Security Vulnerability Checks
function createPrompt(changedFiles: File[], prDetails: PRDetails): string {
  const problemOutline = `Your task is to review pull requests (PR). Instructions:
- Provide the response in the following JSON format:  [{"file": <file name>,  "lineNumber":  <line_number>, "reviewComment": "<review comment>"}]
- DO NOT give positive comments or compliments.
- DO NOT give advice on renaming variable names or writing more descriptive variables.
- Provide comments and suggestions ONLY if there is something to improve, otherwise return an empty array.
- Provide at most ${REVIEW_MAX_COMMENTS} comments. It's up to you how to decide which comments to include.
- Write the comment in GitHub Markdown format.
- Check for math or logic errors in code.
- **Check for common security vulnerabilities** (e.g., SQL Injection, XSS, hardcoded secrets, insecure deserialization, etc.).
- Provide feedback on how to fix any vulnerabilities found.
- Use the given description only for the overall context and only comment on the code.
${
  REVIEW_PROJECT_CONTEXT
    ? `- Additional context regarding this PR's project: ${REVIEW_PROJECT_CONTEXT}`
    : ""
}
- IMPORTANT: NEVER suggest adding comments to the code.
- IMPORTANT: Evaluate the entire diff in the PR before adding any comments.

Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

TAKE A DEEP BREATH AND WORK ON THIS PROBLEM STEP-BY-STEP.
`;

  const diffChunksPrompt = new Array();

  for (const file of changedFiles) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    for (const chunk of file.chunks) {
      diffChunksPrompt.push(createPromptForDiffChunk(file, chunk));
    }
  }

  return `${problemOutline}\n ${diffChunksPrompt.join("\n")}`;
}

// Update main to include logging and security checks
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

  // Save PR Documentation
  logPRDocumentation(prDetails, filteredDiff, comments);

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
