# Open AI GPTcode-reviewer

[![Known Vulnerabilities](https://snyk.io/test/github/PierreGode/GPTcode-reviwer/badge.svg)](https://snyk.io/test/github/PierreGode/GPTcode-reviwer) [![GitHub issues](https://img.shields.io/github/issues/PierreGode/GPTcode-reviwer)](https://github.com/PierreGode/GPTcode-reviwer/issues) [![GitHub pull requests](https://img.shields.io/github/issues-pr/PierreGode/GPTcode-reviwer)](https://github.com/PierreGode/GPTcode-reviwer/pulls) ![Visitor Count](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https://github.com/PierreGode/GPTcode-reviewer&title=Visitors) ![GitHub Workflow Status](https://github.com/PierreGode/GPTcode-reviewer/actions/workflows/code_review.yml/badge.svg) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/PierreGode/GPTcode-reviwer/blob/main/LICENSE)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/J3J2EARPK)

Open AI GPTcode-reviewer is a GitHub Action that leverages OpenAI's GPT-4o-mini API to provide intelligent feedback and suggestions on
your pull requests. This powerful tool helps improve code quality and saves developers time by automating the code
review process.

![image](https://github.com/user-attachments/assets/00a3a9f2-134a-4906-9392-d77916c1174d)

![image](https://github.com/user-attachments/assets/2beff50c-15fc-4beb-8f2c-1e25f01ce4ee)

## Features

- Reviews pull requests using OpenAI's GPT-4o API.
- Provides intelligent comments and suggestions for improving your code.
- Filters out files that match specified exclude patterns.
- Easy to set up and integrate into your GitHub workflow.


## GPT-4o mini
- GPT-4o mini is our most cost-efficient small model that’s smarter and cheaper than GPT-3.5 Turbo, and has vision capabilities. The model has 128K context and an October 2023 knowledge cutoff.
- gpt-4o-mini
- $0.150 / 1M input tokens
- $0.600 / 1M output tokens


## Setup

1. To use this GitHub Action, you need an OpenAI API key. If you don't have one, sign up for an API key
   at [OpenAI](https://beta.openai.com/signup).

2. Add the OpenAI API key as a GitHub Secret in your repository with the name `OPENAI_API_KEY`. You can find more
   information about GitHub Secrets [here](https://docs.github.com/en/actions/reference/encrypted-secrets).

3. Create a `.github/workflows/main.yml` file in your repository and add the following content:

#### See INSTALL.md

4. Replace `your-username` with your GitHub username or organization name where the AI Code Reviewer repository is
   located.

5. Customize the `exclude` input if you want to ignore certain file patterns from being reviewed.

6. Commit the changes to your repository, and AI Code Reviewer will start working on your future pull requests.

## How It Works

The GPTcode-reviewer GitHub Action retrieves the pull request diff, filters out excluded files, and sends code chunks to
the OpenAI API. It then generates review comments based on the AI's response and adds them to the pull request.

## Add your badge to readme
![GitHub Workflow Status](https://github.com/PierreGode/GPTcode-reviewer/actions/workflows/code_review.yml/badge.svg)
```
![GitHub Workflow Status](https://github.com/YOUR-GITHUB/YOUR-REVIWED-REPOSITORY/actions/workflows/code_review.yml/badge.svg)
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests to improve the GPTcode-reviewer GitHub
Action.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
