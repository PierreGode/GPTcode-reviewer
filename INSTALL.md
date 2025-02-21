# Installation Guide for GPTcode-reviewer

To set up **GPTcode-reviewer** in your GitHub repository, follow these steps:

## **1. Add the GitHub Action**
Create (or update) `.github/workflows/gpt-review.yml` with the following:

```yaml
name: GPTcode-reviewer

on:
  pull_request:
    types:
      - opened
      - synchronize

permissions: write-all

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v4

      - name: GPTcode-reviewer
        uses: PierreGode/GPTcode-reviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.G_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_API_MODEL: "gpt-4o-mini" # Optional: defaults to "gpt-4o-mini"
          REVIEW_MAX_COMMENTS: 5 # Optional: defaults to 5
          REVIEW_PROJECT_CONTEXT: "PHP 8.3 + Laravel 10 + PHPUnit 7." # Optional
          exclude: "**/*.json, **/*.md
