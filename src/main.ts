import { readFileSync } from "fs";
import * as core from "@actions/core";
import { Configuration, OpenAIApi } from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");
const REVIEW_MAX_COMMENTS: string = core.getInput("REVIEW_MAX_COMMENTS");
const REVIEW_PROJECT_CONTEXT: string = core.getInput("REVIEW_PROJECT_CONTEXT");

const RESPONSE_TOKENS = 1024;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

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
  return response.data as string;
}

function generatePRSummary(
  prDetails: PRDetails,
  changedFiles: File[],
  comments: GithubComment[]
): string {
  const totalFiles = changedFiles.length;
  const totalComments = comments.length;
  return `
# PR Summary
- **Title**: ${prDetails.title}
- **Description**: ${prDetails.description}
- **Files Changed**: ${totalFiles}
- **AI Comments**: ${totalComments}
${totalComments > 0 ? "Detailed comments posted in the PR." : "No comments required."}
`;
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

async function getAIResponse(prompt: string): Promise<AICommentResponse[] | null> {
  try {
    const response = await openai.createChatCompletion({
      model: OPENAI_API_MODEL,
      messages: [{ role: "system", content: prompt }],
      max_tokens: RESPONSE_TOKENS,
    });
    return JSON.parse(response.data.choices[0].message?.content || "[]");
  } catch (error) {
    console.error("OpenAI Error:", error);
    return null;
  }
}

function createPrompt(changedFiles: File[], prDetails: PRDetails): string {
  return `Your task is to review the following PR titled "${prDetails.title}".
Description:
${prDetails.description}

Files and changes:
${changedFiles
  .map(
    (file) =>
      `File: ${file.to}\nChanges:\n${file.chunks.map(
        (chunk) => `\n${chunk.content}\n${chunk.changes.map((c) => c.content).join("\n")}`
      )}`
  )
  .join("\n")}
- Focus on logical or critical improvements only.
- Output comments in JSON format as described.
`;
}

function createComments(
  changedFiles: File[],
  aiResponses: AICommentResponse[]
): GithubComment[] {
  return aiResponses.map((response) => {
    const file = changedFiles.find((f) => f.to === response.file);
    return { body: response.reviewComment, path: file?.to ?? "", line: +response.lineNumber };
  });
}

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

async function main() {
  const prDetails = await getPRDetails();
  const diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
  if (!diff) {
    console.log("No diff available.");
    return;
  }
  const changedFiles = parseDiff(diff);
  const comments = await analyzeCode(changedFiles, prDetails);

  if (comments.length > 0) {
    await octokit.pulls.createReview({
      owner: prDetails.owner,
      repo: prDetails.repo,
      pull_number: prDetails.pull_number,
      comments,
      event: "COMMENT",
    });
  }

  const summary = generatePRSummary(prDetails, changedFiles, comments);
  await postPRSummary(prDetails.owner, prDetails.repo, prDetails.pull_number, summary);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
