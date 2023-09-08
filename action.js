const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const fetch = require('node-fetch').default;
const { Octokit } = require('@octokit/rest');
const diff = require('diff');  // Import the diff library

async function run() {
    try {
        const apiKey = core.getInput('api-key');
        const githubToken = core.getInput('github-token');
        const repoName = process.env.GITHUB_REPOSITORY;
        const [owner, repo] = repoName.split('/');
        const octokit = new Octokit({
            auth: githubToken,
            request: {
                fetch: fetch
            }
        });

        const sarifDir = '.github/codeql-analysis/';
        const sarifFiles = fs.readdirSync(sarifDir).filter(file => path.extname(file) === '.sarif');

        for (const sarifFile of sarifFiles) {
            const fullPath = path.join(sarifDir, sarifFile);
            console.log('Processing SARIF file:', fullPath);

            const sarifData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            const results = sarifData?.runs[0]?.results;
            const rules = sarifData?.runs[0]?.tool?.driver?.rules; 
            const extensionRules = sarifData?.runs[0]?.tool?.extensions[0]?.rules;

            function getDescriptionAndRecommendation(ruleId) {
                const rule = extensionRules.find(r => r.id === ruleId);
                if (!rule) return { description: 'Description not provided.', recommendation: 'No recommendation provided.' };
                
                const description = rule?.fullDescription?.text || 'Description not provided.';
                const recommendation = rule?.help?.text || 'No recommendation provided.';
                
                return { description, recommendation };
            }

            if (!results) continue;

            // Map that keeps track of patches per file
            const patchesMap = {};

            for (let i = 0; i < results.length; i++) {
                const { description, recommendation } = getDescriptionAndRecommendation(results[i].ruleId);

                const filePath = results[i]?.locations[0]?.physicalLocation?.artifactLocation?.uri;
                if (!filePath) continue;

                const fileContentResponse = await axios.get(`https://api.github.com/repos/${repoName}/contents/${filePath}`, {
                    headers: {
                        'Authorization': `Bearer ${githubToken}`,
                        'Accept': 'application/vnd.github.v3.raw'
                    }
                });

                const fileContent = fileContentResponse.data;
                const singleResult = Object.assign({}, results[i], { fileContent, description, recommendation });

                const response = await axios.post('https://backend.repodex.ai/api/sarif_solver/', { runs: [{ results: [singleResult] }] }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                const patch = diff.createPatch(filePath, fileContent, response.data.solutions[0].solution);
                if (patchesMap[filePath]) {
                    patchesMap[filePath].patches.push(patch);
                    if(!patchesMap[filePath].recommendation) {
                        patchesMap[filePath].recommendation = recommendation;  // Store the first recommendation
                    }
                } else {
                    patchesMap[filePath] = {
                        patches: [patch],
                        recommendation: recommendation  // Store the first recommendation
                    };
                }
            }

            // Now iterate over each file, apply all the patches, and create a PR
            for (const [filePath, patchData] of Object.entries(patchesMap)) {
                let updatedContent = await fs.promises.readFile(filePath, 'utf8'); // Original content from file

                for (const patch of patchData.patches) {
                    const patchedContent = diff.applyPatch(updatedContent, patch);
                    if (patchedContent === false) {
                        console.error(`Failed to apply patch for file ${filePath}`);
                        continue;
                    }
                    updatedContent = patchedContent;
                }

                const branchName = `fixes/${Date.now()}`;
                const { data: refData } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
                await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: refData.object.sha });

                const { data: fileData } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: filePath
                });
                const fileSha = fileData.sha;

                await octokit.repos.createOrUpdateFileContents({
                    owner,
                    repo,
                    path: filePath,
                    message: `[AUTO] Fixes for issues in ${filePath}`,
                    content: Buffer.from(updatedContent).toString('base64'),
                    branch: branchName,
                    sha: fileSha
                });

                const prBody = "### Recommendation:\n\n" + patchData.recommendation + "\n\n---\n\n";  // Use the first recommendation

                const prResponse = await octokit.pulls.create({
                    owner,
                    repo,
                    title: `[AUTO] Fixes for issues in ${filePath}`,
                    head: branchName,
                    body: prBody,
                    base: 'main'
                });

                await octokit.issues.addLabels({
                    owner,
                    repo,
                    issue_number: prResponse.data.number,
                    labels: ["AUTO"]
                });
            }
        }
    } catch (error) {
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        } else if (error.request) {
            console.error('The request was made but no response was received:', error.request);
        } else {
            console.error('Error:', error.message);
        }
        console.error('Axios config:', error.config);
        process.exit(1);
    }
}

run();
