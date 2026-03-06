import { DefaultArtifactClient } from "@actions/artifact";
import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput,
  summary,
  warning,
} from "@actions/core";
import { context } from "@actions/github";
import path from "node:path";
import {
  buildArchiveArtifactName,
  buildArtifactUrl,
  buildCommentBody,
  buildRepoPreviewUrl,
  type ArtifactEntry,
  discoverHtmlDependencies,
  formatSkippedReferences,
  getUploadStrategy,
  parseIntegerInput,
  resolveSiteConfig,
  toPosixPath,
} from "./lib/preview.js";

function getValidatedMode(modeInput: string): "artifact" | "repo" {
  const mode = modeInput.trim().toLowerCase();

  if (mode === "artifact" || mode === "repo") {
    return mode;
  }

  throw new Error(`Unsupported mode: ${modeInput}`);
}

function getValidatedArtifactFormat(artifactFormatInput: string): "raw" | "archive" {
  const artifactFormat = artifactFormatInput.trim().toLowerCase();

  if (artifactFormat === "raw" || artifactFormat === "archive") {
    return artifactFormat;
  }

  throw new Error(`Unsupported artifact_format: ${artifactFormatInput}`);
}

type WriteJobSummaryInput = {
  mode: "artifact" | "repo";
  relativeHtmlFile: string;
  relativeSiteRoot: string;
  url: string;
  artifactEntries: ArtifactEntry[];
  uploadStrategy: string;
  artifactCount: number;
  discoveredFilesCount: number;
  skippedReferences: Array<{ from: string; reference: string; reason: string }>;
};

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
}: WriteJobSummaryInput): Promise<void> {
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
    summary.addLink("Open preview artifact", url);
    summary.addBreak();

    if (artifactEntries.length > 1) {
      summary.addBreak();

      for (const artifactEntry of artifactEntries.slice(0, 10)) {
        summary.addLink(
          artifactEntry.isEntry
            ? `${artifactEntry.relativePath} (entry)`
            : artifactEntry.relativePath,
          artifactEntry.artifactUrl,
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
        summary.addRaw(
          `- ${skippedReference.reference} (${skippedReference.reason}) from ${skippedReference.from}`,
        );
        summary.addBreak();
      }
    }
  } else {
    summary.addLink("Open preview URL", url);
    summary.addBreak();
  }

  await summary.write();
}

async function run(): Promise<void> {
  const artifactClient = new DefaultArtifactClient();
  const mode = getValidatedMode(getInput("mode", { required: true }));
  const htmlFile = getInput("html_file", { required: true });
  const siteRootInput = getInput("site_root", { required: true });
  const artifactFormat = getValidatedArtifactFormat(
    getInput("artifact_format", { required: true }),
  );
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
  let artifactEntries: ArtifactEntry[] = [];
  let skippedReferencePreview: Array<{ from: string; reference: string; reason: string }> = [];

  if (mode === "artifact") {
    const discovery = discoverHtmlDependencies({
      entryFile: siteConfig.entryFile,
      siteRoot: siteConfig.siteRoot,
    });

    uploadStrategy = getUploadStrategy(discovery.files, artifactFormat);
    discoveredFilesCount = discovery.files.length;
    skippedReferencesCount = discovery.skippedReferences.length;
    skippedReferencePreview = formatSkippedReferences(discovery.skippedReferences);
    artifactCount = 1;
    artifactName = buildArchiveArtifactName({
      artifactNameInput,
      relativeHtmlFile: siteConfig.relativeHtmlFile,
    });

    if (uploadStrategy === "raw" && artifactNameInput.trim()) {
      warning(
        "artifact_name is ignored for single-file non-zipped uploads because GitHub uses the uploaded filename as the artifact name.",
      );
    }

    const filesToUpload = discovery.files.map((file) => file.absolutePath);
    const rootDirectory =
      uploadStrategy === "raw" ? path.dirname(siteConfig.entryFile) : siteConfig.siteRoot;
    const uploadName =
      uploadStrategy === "raw" ? path.basename(siteConfig.entryFile) : artifactName;
    const uploadResponse = await artifactClient.uploadArtifact(
      uploadName,
      filesToUpload,
      rootDirectory,
      {
        retentionDays,
        compressionLevel: uploadStrategy === "raw" ? 0 : 6,
        skipArchive: uploadStrategy === "raw",
      },
    );

    if (!uploadResponse.id) {
      throw new Error("Artifact upload did not return an artifact ID");
    }

    artifactId = String(uploadResponse.id);
    artifactName = uploadName;
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

    info(
      `Uploaded ${artifactCount} artifact(s) for ${discoveredFilesCount} discovered file(s) with strategy '${uploadStrategy}'`,
    );
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
      relativeHtmlFile:
        mode === "artifact" ? siteConfig.relativeHtmlFile : workspaceRelativeHtmlFile,
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

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
