import { readFileSync } from "fs";
import * as core from "@actions/core";
import { Configuration, OpenAIApi } from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL = core.getInput("OPENAI_API_MODEL");
const REVIEW_MAX_COMMENTS = parseInt(core.getInput("REVIEW_MAX_COMMENTS"), 10);
const REVIEW_PROJECT_CONTEXT = core.getInput("REVIEW_PROJECT_CONTEXT");

const RESPONSE_TOKENS = 1024;

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));

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
  const eventPath = process.env.GITHUB_EVENT_PATH || "";
  const { repository, number } = JSON.parse(readFileSync(eventPath, "utf8"));
  
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
  return typeof response.data === "string" ? response.data : null;
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
  const problemOutline = `Your task is to review pull requests (PR). Instructions:
- Provide response in JSON format: [{"file": <file name>,  "lineNumber":  <line_number>, "reviewComment": "<review comment>"}]
- Avoid positive comments, compliments, or naming advice.
- Only suggest improvements if necessary. Otherwise, return an empty array.
- Limit to ${REVIEW_MAX_COMMENTS} comments.
- Use GitHub Markdown.
- Look for math or logic errors.
${REVIEW_PROJECT_CONTEXT ? `- Context: ${REVIEW_PROJECT_CONTEXT}` : ""}
- DO NOT suggest adding comments in code.
- Evaluate the entire PR diff.

Title: ${prDetails.title}
Description:
---
${prDetails.description}
---

START THE REVIEW.
`;

  const diffChunksPrompt = changedFiles
    .filter((file) => file.to !== "/dev/null")
    .flatMap((file) =>
      file.chunks.map((chunk) => createPromptForDiffChunk(file, chunk))
    );

  return `${problemOutline}\n${diffChunksPrompt.join("\n")}`;
}

function createPromptForDiffChunk(file: File, chunk: Chunk): string {
  const changes = chunk.changes
    .map((c) => `${c.ln || c.ln2} ${c.content}`)
    .join("\n");
    
  return `
  File: "${file.to}" Review this Git diff:

  \`\`\`diff
  ${chunk.content}
  ${changes}
  \`\`\`
  `;
}

async function getAIResponse(
  prompt: string
): Promise<AICommentResponse[] | null> {
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.2,
    max_tokens: RESPONSE_TOKENS,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };

  try {
    const response = await openai.createChatCompletion({
      ...queryConfig,
      messages: [{ role: "system", content: prompt }],
    });

    const result = response.data.choices[0].message?.content?.trim() || "[]";
    return JSON.parse(result);
  } catch (error) {
    console.error("Error Message:", error.message || error);
    return null;
  }
}

function createComments(
  changedFiles: File[],
  aiResponses: AICommentResponse[]
): GithubComment[] {
  return aiResponses
    .map((aiResponse) => {
      const file = changedFiles.find((file) => file.to === aiResponse.file);
      if (!file) return null;

      return {
        body: aiResponse.reviewComment,
        path: file.to,
        line: Number(aiResponse.lineNumber),
      };
    })
    .filter((comment): comment is GithubComment => comment !== null);
}

async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: GithubComment[]
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
  try {
    const prDetails = await getPRDetails();
    const eventData = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8"));

    let diff: string | null;
    if (eventData.action === "opened" || eventData.action === "synchronize") {
      diff = eventData.action === "opened"
        ? await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number)
        : await octokit.repos.compareCommits({
            headers: { accept: "application/vnd.github.v3.diff" },
            owner: prDetails.owner,
            repo: prDetails.repo,
            base: eventData.before,
            head: eventData.after,
          }).then((res) => String(res.data));

      if (!diff) {
        console.log("No diff found");
        return;
      }

      const changedFiles = parseDiff(diff);
      const excludePatterns = core.getInput("exclude").split(",").map((s) => s.trim());

      const filteredDiff = changedFiles.filter((file) => 
        !excludePatterns.some((pattern) => minimatch(file.to || "", pattern))
      );

      const comments = await analyzeCode(filteredDiff, prDetails);
      if (comments.length > 0) {
        await createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
      }
    } else {
      console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
