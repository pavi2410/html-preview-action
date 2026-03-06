import { DefaultArtifactClient } from "@actions/artifact";
import { getBooleanInput, getInput, info, setFailed, setOutput, summary } from "@actions/core";
import { context } from "@actions/github";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    buildArchiveArtifactName,
    buildArtifactUrl,
    buildCommentBody,
    buildRepoPreviewUrl,
    buildRawArtifactFileName,
    discoverHtmlDependencies,
    formatSkippedReferences,
    getUploadStrategy,
    parseIntegerInput,
    resolveSiteConfig,
    toPosixPath,
} from "./lib/preview.js";

function getValidatedMode(modeInput) {
    const mode = modeInput.trim().toLowerCase();

    if (mode === "artifact" || mode === "repo") {
        return mode;
    }

    throw new Error(`Unsupported mode: ${modeInput}`);
}

function getValidatedArtifactFormat(artifactFormatInput) {
    const artifactFormat = artifactFormatInput.trim().toLowerCase();

    if (artifactFormat === "raw" || artifactFormat === "archive") {
        return artifactFormat;
    }

    throw new Error(`Unsupported artifact_format: ${artifactFormatInput}`);
}

async function writeJobSummary({
    mode,
    relativeHtmlFile,
    relativeSiteRoot,
    url,
    artifactEntries,
    uploadStrategy,
    artifactCount,
    discoveredFilesCount,
    skippedReferences,
}) {
    summary.addHeading("HTML Preview Action");
    summary.addRaw(`Entry HTML file: ${relativeHtmlFile}`);
    summary.addBreak();
    summary.addRaw(`Mode: ${mode}`);
    summary.addBreak();

    if (mode === "artifact") {
        summary.addRaw(`Site root: ${relativeSiteRoot}`);
        summary.addBreak();
        summary.addRaw(`Upload strategy: ${uploadStrategy}`);
        summary.addBreak();
        summary.addRaw(`Artifact uploads: ${artifactCount}`);
        summary.addBreak();
        summary.addRaw(`Files included: ${discoveredFilesCount}`);
        summary.addBreak();
        summary.addLink("Open primary preview artifact", url);
        summary.addBreak();

        if (artifactEntries.length > 1) {
            summary.addBreak();

            for (const artifactEntry of artifactEntries.slice(0, 10)) {
                summary.addLink(
                    artifactEntry.isEntry ? `${artifactEntry.relativePath} (entry)` : artifactEntry.relativePath,
                    artifactEntry.artifactUrl
                );
                summary.addBreak();
            }

            if (artifactEntries.length > 10) {
                summary.addRaw(`...and ${artifactEntries.length - 10} more artifacts`);
                summary.addBreak();
            }
        }

        if (skippedReferences.length > 0) {
            summary.addBreak();
            summary.addRaw(`References skipped: ${skippedReferences.length}`);
            summary.addBreak();

            for (const skippedReference of skippedReferences) {
                summary.addRaw(`- ${skippedReference.reference} (${skippedReference.reason}) from ${skippedReference.from}`);
                summary.addBreak();
            }
        }
    } else {
        summary.addLink("Open preview URL", url);
        summary.addBreak();
    }

    await summary.write();
}

async function run() {
    const artifactClient = new DefaultArtifactClient();
    const mode = getValidatedMode(getInput("mode", { required: true }));
    const htmlFile = getInput("html_file", { required: true });
    const siteRootInput = getInput("site_root", { required: true });
    const artifactFormat = getValidatedArtifactFormat(getInput("artifact_format", { required: true }));
    const artifactNameInput = getInput("artifact_name");
    const retentionDays = parseIntegerInput(getInput("retention_days"), 0);
    const jobSummary = getBooleanInput("job_summary");

    const {
        sha,
        runId,
        serverUrl,
        repo: { owner, repo },
    } = context;

    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const siteConfig = resolveSiteConfig({
        workspace,
        siteRootInput,
        htmlFileInput: htmlFile,
    });
    const workspaceRelativeHtmlFile = toPosixPath(path.relative(workspace, siteConfig.entryFile));

    let url = "";
    let artifactUrl = "";
    let artifactId = "";
    let sourceUrl = "";
    let uploadStrategy = "";
    let artifactCount = 0;
    let discoveredFilesCount = 0;
    let skippedReferencesCount = 0;
    let commentBody = "";
    let artifactName = "";
    let artifactEntries = [];
    let skippedReferencePreview = [];

    if (mode === "artifact") {
        const discovery = discoverHtmlDependencies({
            entryFile: siteConfig.entryFile,
            siteRoot: siteConfig.siteRoot,
        });

        uploadStrategy = getUploadStrategy(discovery.files, artifactFormat);
        discoveredFilesCount = discovery.files.length;
        skippedReferencesCount = discovery.skippedReferences.length;
        skippedReferencePreview = formatSkippedReferences(discovery.skippedReferences);
        artifactCount = uploadStrategy === "archive" ? 1 : discovery.files.length;

        if (uploadStrategy === "archive") {
            artifactName = buildArchiveArtifactName({
                artifactNameInput,
                relativeHtmlFile: siteConfig.relativeHtmlFile,
            });

            const uploadResponse = await artifactClient.uploadArtifact(
                artifactName,
                discovery.files.map((file) => file.absolutePath),
                siteConfig.siteRoot,
                {
                    retentionDays,
                    compressionLevel: 6,
                }
            );

            if (!uploadResponse.id) {
                throw new Error("Artifact upload did not return an artifact ID");
            }

            artifactId = String(uploadResponse.id);
            artifactUrl = buildArtifactUrl({
                serverUrl,
                owner,
                repo,
                runId,
                artifactId,
            });
            artifactEntries = [
                {
                    relativePath: siteConfig.relativeHtmlFile,
                    artifactId,
                    artifactName,
                    artifactUrl,
                    isEntry: true,
                },
            ];
        } else {
            const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "html-preview-action-raw-"));

            try {
                artifactEntries = [];

                for (const file of discovery.files) {
                    const uploadedFileName = buildRawArtifactFileName({
                        artifactNameInput,
                        relativePath: file.relativePath,
                        multipleFiles: discovery.files.length > 1,
                    });
                    const tempFilePath = path.join(tempDirectory, uploadedFileName);

                    await copyFile(file.absolutePath, tempFilePath);

                    const uploadResponse = await artifactClient.uploadArtifact(
                        uploadedFileName,
                        [tempFilePath],
                        tempDirectory,
                        {
                            retentionDays,
                            compressionLevel: 0,
                            skipArchive: true,
                        }
                    );

                    if (!uploadResponse.id) {
                        throw new Error(`Artifact upload did not return an artifact ID for ${file.relativePath}`);
                    }

                    const currentArtifactId = String(uploadResponse.id);
                    artifactEntries.push({
                        relativePath: file.relativePath,
                        artifactId: currentArtifactId,
                        artifactName: uploadedFileName,
                        artifactUrl: buildArtifactUrl({
                            serverUrl,
                            owner,
                            repo,
                            runId,
                            artifactId: currentArtifactId,
                        }),
                        isEntry: file.relativePath === siteConfig.relativeHtmlFile,
                    });
                }
            } finally {
                await rm(tempDirectory, { recursive: true, force: true });
            }

            const primaryArtifactEntry = artifactEntries.find((entry) => entry.isEntry) ?? artifactEntries[0];

            artifactId = primaryArtifactEntry.artifactId;
            artifactName = primaryArtifactEntry.artifactName;
            artifactUrl = primaryArtifactEntry.artifactUrl;
        }

        url = artifactUrl;
        commentBody = buildCommentBody({
            relativeHtmlFile: siteConfig.relativeHtmlFile,
            relativeSiteRoot: siteConfig.relativeSiteRoot,
            artifactUrl,
            artifactEntries,
            uploadStrategy,
            artifactCount,
            discoveredFilesCount,
            skippedReferencesCount,
            mode,
        });

        info(`Uploaded ${artifactCount} artifact(s) for ${discoveredFilesCount} discovered file(s) with strategy '${uploadStrategy}'`);
    } else {
        const preview = buildRepoPreviewUrl({
            serverUrl,
            owner,
            repo,
            sha,
            htmlFile: workspaceRelativeHtmlFile,
        });

        sourceUrl = preview.sourceUrl;
        url = preview.previewUrl;
        uploadStrategy = "repo";
        artifactCount = 0;
        discoveredFilesCount = 1;
        commentBody = buildCommentBody({
            relativeHtmlFile: workspaceRelativeHtmlFile,
            relativeSiteRoot: siteConfig.relativeSiteRoot,
            artifactUrl: url,
            sourceUrl,
            uploadStrategy: "repo",
            artifactCount: 0,
            discoveredFilesCount: 1,
            skippedReferencesCount: 0,
            mode,
        });
    }

    setOutput("url", url);
    setOutput("artifact_url", artifactUrl);
    setOutput("artifact_id", artifactId);
    setOutput("artifact_name", artifactName);
    setOutput("source_url", sourceUrl);
    setOutput("mode", mode);
    setOutput("upload_strategy", uploadStrategy || mode);
    setOutput("artifact_count", String(artifactCount));
    setOutput("discovered_files_count", String(discoveredFilesCount));
    setOutput("skipped_references_count", String(skippedReferencesCount));
    setOutput("artifact_names", JSON.stringify(artifactEntries.map((entry) => entry.artifactName)));
    setOutput("artifact_ids", JSON.stringify(artifactEntries.map((entry) => entry.artifactId)));
    setOutput("artifact_urls", JSON.stringify(artifactEntries.map((entry) => entry.artifactUrl)));
    setOutput("artifact_manifest", JSON.stringify(artifactEntries));
    setOutput("comment_body", commentBody);

    if (jobSummary) {
        await writeJobSummary({
            mode,
            relativeHtmlFile: mode === "artifact" ? siteConfig.relativeHtmlFile : workspaceRelativeHtmlFile,
            relativeSiteRoot: siteConfig.relativeSiteRoot,
            url,
            artifactEntries,
            uploadStrategy,
            artifactCount,
            discoveredFilesCount,
            skippedReferences: skippedReferencePreview,
        });
    }
}

run().catch((error) => {
    setFailed(error instanceof Error ? error.message : String(error));
});
