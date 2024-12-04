import { readFileSync } from "fs";
import * as core from "@actions/core";
import { Configuration, OpenAIApi } from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const G_TOKEN: string = core.getInput("G_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");
const REVIEW_MAX_COMMENTS: string = core.getInput("REVIEW_MAX_COMMENTS");
const REVIEW_PROJECT_CONTEXT: string = core.getInput("REVIEW_PROJECT_CONTEXT");

const RESPONSE_TOKENS = 1024;

const octokit = new Octokit({ auth: G_TOKEN });

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

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

// Generate a PR summary
function generatePRSummary(
  prDetails: PRDetails,
  changedFiles: File[],
  comments: GithubComment[]
): string {
  const totalFilesChanged = changedFiles.length;
  const totalComments = comments.length;

  return `
# PR Summary

- **Title**: ${prDetails.title}
- **Description**: ${prDetails.description}
- **Files Changed**: ${totalFilesChanged}
- **AI Comments**: ${totalComments}

${
    totalComments > 0
      ? "Detailed comments have been posted in the pull request."
      : "No issues were found in the code changes."
  }
`;
}

// Post summary as a comment on the PR
async function postPRSummary(
  owner: string,
  repo: string,
  pull_number: number,
  summary: string
): Promise<void> {
  try {
    console.log("Posting PR summary...");
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: summary,
    });
    console.log("PR summary posted successfully.");
  } catch (error) {
    console.error("Error posting PR summary:", error);
    throw error;
  }
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

  console.log("Fetched PR details:", prResponse.data);

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
  console.log("Fetched diff data.");
  return response.data as string;
}

async function analyzeCode(
  changedFiles: File[],
  prDetails: PRDetails
): Promise<GithubComment[]> {
  const prompt = createPrompt(changedFiles, prDetails);
  const aiResponse = await getAIResponse(prompt);
  if (!aiResponse) return [];
  return createComments(changedFiles, aiResponse);
}

function createPrompt(changedFiles: File[], prDetails: PRDetails): string {
  const basePrompt = `
Your task is to review the following pull request (PR):
Title: ${prDetails.title}
Description: ${prDetails.description}

Provide comments in the following JSON format:
[{"file": "<file_name>", "lineNumber": <line_number>, "reviewComment": "<review_comment>"}]

Focus on logical, critical, or security-related improvements. Return an empty array if no comments are necessary.
`;

  const diffChunksPrompt = changedFiles
    .map((file) =>
      file.chunks.map((chunk) => {
        return `\nFile: ${file.to}\nChunk:\n${chunk.content}\n${chunk.changes
          .map((c) => c.content)
          .join("\n")}`;
      })
    )
    .flat()
    .join("\n");

  return `${basePrompt}\n\n${diffChunksPrompt}`;
}

async function getAIResponse(prompt: string): Promise<AICommentResponse[] | null> {
  try {
    console.log("Sending prompt to OpenAI...");
    const response = await openai.createChatCompletion({
      model: OPENAI_API_MODEL,
      messages: [{ role: "system", content: prompt }],
      max_tokens: RESPONSE_TOKENS,
    });

    const res = response.data.choices[0].message?.content?.trim() || "[]";
    console.log("AI response received:", res);
    return JSON.parse(res);
  } catch (error) {
    console.error("Error generating AI response:", error);
    return null;
  }
}

function createComments(
  changedFiles: File[],
  aiResponses: AICommentResponse[]
): GithubComment[] {
  return aiResponses.map((response) => {
    const file = changedFiles.find((f) => f.to === response.file);
    return {
      body: response.reviewComment,
      path: file?.to ?? "",
      line: parseInt(response.lineNumber, 10),
    };
  });
}

async function main() {
  console.log("Starting workflow...");

  const prDetails = await getPRDetails();
  const diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);

  if (!diff) {
    console.log("No diff found for the PR.");
    return;
  }

  const changedFiles = parseDiff(diff);
  const comments = await analyzeCode(changedFiles, prDetails);

  console.log("Comments generated:", comments);

  // Post AI comments if any
  if (comments.length > 0) {
    console.log("Posting review comments...");
    await octokit.pulls.createReview({
      owner: prDetails.owner,
      repo: prDetails.repo,
      pull_number: prDetails.pull_number,
      comments,
      event: "COMMENT",
    });
    console.log("Review comments posted.");
  }

  // Generate and post PR summary
  const summary = generatePRSummary(prDetails, changedFiles, comments);
  await postPRSummary(prDetails.owner, prDetails.repo, prDetails.pull_number, summary);
}

main().catch((error) => {
  console.error("Workflow failed:", error);
  process.exit(1);
});
