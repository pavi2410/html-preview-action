import { getInput, setOutput, setFailed, summary, getBooleanInput } from "@actions/core";
import { context } from "@actions/github";

async function run() {
    const htmlFile = getInput("html_file", { required: true });
    const jobSummary = getBooleanInput("job_summary");

    const {
        sha,
        repo: { owner, repo },
    } = context;

    const sourceUrl = encodeURI(`https://github.com/${owner}/${repo}/blob/${sha}/${htmlFile}`);
    const previewUrl = `https://htmlpreview.github.io/?${sourceUrl}`;

    setOutput("url", previewUrl);

    if (jobSummary) {
        await summary
            .addHeading("HTML Preview Action")
            .addRaw(`Using HTML file: ${htmlFile}`)
            .addBreak()
            .addBreak()
            .addLink("Click here to preview the HTML page in your browser", previewUrl)
            .write();
    }
}

run().catch((error) => {
    setFailed(error instanceof Error ? error.message : String(error));
});
