const core = require("@actions/core");
const {context} = require("@actions/github");

async function run() {
    try {
        const html_file = core.getInput("html_file");

        const {sha, repo: {owner, repo}} = context;

        core.setOutput(
            "url",
            `https://htmlpreview.github.io/?https://github.com/${owner}/${repo}/blob/${sha}/${html_file}`
        );
    } catch (e) {
        core.setFailed(e.message);
    }
}

run()