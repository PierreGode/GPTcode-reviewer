import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import * as minimatch from "minimatch";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");
const REVIEW_MAX_COMMENTS: string = core.getInput("REVIEW_MAX_COMMENTS");
const REVIEW_PROJECT_CONTEXT: string = core.getInput("REVIEW_PROJECT_CONTEXT");

const RESPONSE_TOKENS = 1024;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

interface AICommentResponse {
  file: string;
  lineNumber: string;
  reviewComment: string;
}

interface GithubComment {
  body: string;
  path: string;
  line: number;
}

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

async function getDiff(
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
}

async function analyzeCode(
  changedFiles: File[],
  prDetails: PRDetails
): Promise<Array<GithubComment>> {
  const prompt = createPrompt(changedFiles, prDetails);
  const aiResponse = await getAIResponse(prompt);

  const comments: Array<GithubComment> = [];

  if (aiResponse) {
    const newComments = createComments(changedFiles, aiResponse);
    if (newComments) {
      comments.push(...newComments);
    }
  }
  return comments;
}

function createPrompt(changedFiles: File[], prDetails: PRDetails): string {
  const problemOutline = `Your task is to review pull requests (PR). Instructions:
- Provide the response in the following JSON format: [{"file": <file name>, "lineNumber": <line_number>, "reviewComment": "<review comment>"}]
- DO NOT give positive comments or compliments.
- DO NOT give advice on renaming variable names or writing more descriptive variables.
- Provide comments and suggestions ONLY if there is something to improve in the diff, otherwise return an empty array.
- Provide at most ${REVIEW_MAX_COMMENTS} comments. It's up to you how to decide which comments to include.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment on the code changes.
${REVIEW_PROJECT_CONTEXT ? `- Additional context regarding this PR's project: ${REVIEW_PROJECT_CONTEXT}` : ""}
- IMPORTANT: NEVER suggest adding comments to the code.
- IMPORTANT: NEVER comment on comment rows unless they pose any issues to the code.
- IMPORTANT: Evaluate the entire diff in the PR before adding any comments.
- IMPORTANT: The following full file contexts are provided solely to give you a complete understanding of the codebase. You MUST ONLY comment on the changed rows indicated in the diff and ignore the rest of the file content.

Pull request title: ${prDetails.title}
Pull request description:
---
${prDetails.description}
---

TAKE A DEEP BREATH AND WORK ON THIS PROBLEM STEP-BY-STEP.
`;

  const diffChunksPrompt: string[] = [];
  for (const file of changedFiles) {
    if (!file.to || file.to === "/dev/null") continue; // Ignore deleted or undefined files
    for (const chunk of file.chunks) {
      diffChunksPrompt.push(createPromptForDiffChunk(file, chunk));
    }
  }

  const fileContextsPrompt: string[] = [];
  for (const file of changedFiles) {
    if (!file.to || file.to === "/dev/null") continue; // Ignore deleted or undefined files
    try {
      const fileContent = readFileSync(file.to, "utf8");
      fileContextsPrompt.push(`\nFull file context for "${file.to}":\n\`\`\`plaintext\n${fileContent}\n\`\`\``);
    } catch (error) {
      console.error(`Failed to read file ${file.to}:`, error);
    }
  }

  return `${problemOutline}\n${diffChunksPrompt.join("\n")}\n${fileContextsPrompt.join("\n")}`;
}

function createPromptForDiffChunk(file: File, chunk: Chunk): string {
  // Include the chunk header (e.g. "@@ -1,4 +1,4 @@") if present
  const header = chunk.content ? chunk.content.trim() : "";
  // Filter out deleted rows and only show added/changed rows
  const changesStr = chunk.changes
    .filter((c) => {
      const change = c as any;
      return change.type !== "del";
    })
    .map((c) => {
      const change = c as any;
      let prefix = " ";
      if (change.type === "add") {
        prefix = "+";
      }
      return `${prefix} ${change.content}`;
    })
    .join("\n");

  return `\nReview the following code diff in the file but ignore + at the beginning of line as it just points out that this is an added line and not deleted. "${file.to}":
  
\`\`\`diff
${header}
${changesStr}
\`\`\`
`;
}

async function getAIResponse(
  prompt: string
): Promise<Array<AICommentResponse> | null> {
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.2,
    max_tokens: RESPONSE_TOKENS,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };

  try {
    const response = await openai.chat.completions.create({
      ...queryConfig,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    });

    const res = response.choices[0].message?.content?.trim() || "[]";
    return JSON.parse(res);
  } catch (error: any) {
    console.error("Error Message:", error?.message || error);
    if (error?.response) {
      console.error("Response Data:", error.response.data);
      console.error("Response Status:", error.response.status);
      console.error("Response Headers:", error.response.headers);
    }
    if (error?.config) {
      console.error("Config:", error.config);
    }
    return null;
  }
}

function createComments(
  changedFiles: File[],
  aiResponses: Array<AICommentResponse>
): Array<GithubComment> {
  return aiResponses
    .flatMap((aiResponse) => {
      const file = changedFiles.find((file) => file.to === aiResponse.file);
      return {
        body: aiResponse.reviewComment,
        path: file?.to ?? "",
        line: Number(aiResponse.lineNumber),
      };
    })
    .filter((comment) => comment.path !== "");
}

async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<GithubComment>
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: "COMMENT",
  });
}

async function main() {
  const prDetails = await getPRDetails();
  let diff: string | null;
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  if (eventData.action === "opened") {
    diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
  } else if (eventData.action === "synchronize") {
    const newBaseSha = eventData.before;
    const newHeadSha = eventData.after;
    const response = await octokit.repos.compareCommits({
      headers: { accept: "application/vnd.github.v3.diff" },
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
      minimatch.minimatch(file.to ?? "", pattern)
    );
  });

  const comments = await analyzeCode(filteredDiff, prDetails);
  if (comments.length > 0) {
    await createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
