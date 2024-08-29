import { getInput, setOutput, setFailed, summary, getBooleanInput } from "@actions/core";
import { context } from "@actions/github";

try {
    const htmlFile = getInput("html_file");
    const jobSummary = getBooleanInput("job_summary");

    const { sha, repo: { owner, repo } } = context;

    const previewUrl = `https://htmlpreview.github.io/?https://github.com/${owner}/${repo}/blob/${sha}/${htmlFile}`;

    setOutput("url", previewUrl);

    if (jobSummary) {
        summary
            .addHeading('HTML Preview Action')
            .addRaw(`Using HTML file: \`${htmlFile}\``)
            .addBreak()
            .addLink('Click here to preview the HTML page in your browser', previewUrl)
            .write();
    }
} catch (e) {
    setFailed(e.message);
}
