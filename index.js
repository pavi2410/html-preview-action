import { getInput, setOutput, setFailed } from "@actions/core";
import { context } from "@actions/github";

try {
    const html_file = getInput("html_file");

    const { sha, repo: { owner, repo } } = context;

    setOutput(
        "url",
        `https://htmlpreview.github.io/?https://github.com/${owner}/${repo}/blob/${sha}/${html_file}`
    );
} catch (e) {
    setFailed(e.message);
}
