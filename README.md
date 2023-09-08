# Repodex SARIF Solver

This GitHub Action processes the SARIF results from a CodeQL analysis and communicates with the Repodex backend service to generate solutions for found issues.

## Prerequisites

1. **API Key from Repodex**: Before you can use this action, you'll need to have an API key from Repodex. You can obtain this key by signing up on the Repodex platform.

2. **GitHub Secrets**: 
   - Store the API key as a secret in your GitHub repository. Name the secret `REPODEX_API_KEY`.
   - Optionally, if you do not want to use the default `GITHUB_TOKEN`, you can use a Personal Access Token. Store it as a secret named `MY_PERSONAL_ACCESS_TOKEN`.
   
   To add a new secret:
   - Navigate to your GitHub repository.
   - Click on the "Settings" tab.
   - In the left sidebar, click on "Secrets".
   - Click on "New repository secret".
   - For the API key, enter `REPODEX_API_KEY` as the name and paste your Repodex API key as the value.
   - For the Personal Access Token, enter `MY_PERSONAL_ACCESS_TOKEN` as the name and paste your token as the value.
   - Click on "Add secret".

3. **Determine SARIF File Paths**: After your CodeQL Analysis action runs, identify the paths to the generated SARIF files. If you don't specify a path, the action defaults to the typical path used by CodeQL: `.github/workflows/codeql-analysis/results.sarif`. You can specify multiple paths by separating them with commas.


## Usage

```yaml
name: CodeQL with Repodex SARIF Solver

on:
  push:
    branches: [ "main" ]
  schedule:
    - cron: '30 23 * * 4'

jobs:
  analyze:
    name: Analyze
    runs-on: ${{ (matrix.language == 'swift' && 'macos-latest') || 'ubuntu-latest' }}
    timeout-minutes: ${{ (matrix.language == 'swift' && 120) || 360 }}

    strategy:
      fail-fast: false
      matrix:
        language: [ 'python' ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    # Additional steps for checking commits and caching...

    - name: Run CodeQL Analysis
      uses: github/codeql-action/analyze@v2
      with:
        languages: 'autodetect'

    - name: Repodex SARIF Solver
      uses: Repodex-Organization/repodex-sarif-solver@main
      with:
        api-key: ${{ secrets.REPODEX_API_KEY }}
        github-token: ${{ secrets.MY_PERSONAL_ACCESS_TOKEN }}
