const core = require("@actions/core");
const {context, GitHub} = require("@actions/github");

async function run() {
    const msg = core.getInput("msg");
    const html_file = core.getInput("html_file");
    const gh_token = core.getInput("gh_token");

    const {sha, repo: {owner, repo}} = context;
    const client = new GitHub(gh_token);

    await client.issues.createComment({
        owner, repo,
        issue_number: context.payload.pull_request.number,
        body: `[${msg}](https://htmlpreview.github.io/?https://github.com/${owner}/${repo}/blob/${sha}/${html_file})`
    });
}

run().catch(e => core.setFailed(e.message));
