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
  buildResultJson,
  discoverHtmlDependencies,
  formatSkippedReferences,
  getUploadStrategy,
  parseIntegerInput,
  resolveSiteConfig,
} from "./lib/preview.js";

function getValidatedUpload(uploadInput: string): "auto" | "archive" {
  const upload = uploadInput.trim().toLowerCase();

  if (upload === "auto" || upload === "archive") {
    return upload;
  }

  throw new Error(`Unsupported upload: ${uploadInput}`);
}

type WriteJobSummaryInput = {
  relativeHtmlFile: string;
  relativeSiteRoot: string;
  url: string;
  artifactName: string;
  requestedUpload: "auto" | "archive";
  resolvedUpload: "raw" | "archive";
  discoveredFilesCount: number;
  skippedReferences: Array<{ from: string; reference: string; reason: string }>;
};

async function writeJobSummary({
  relativeHtmlFile,
  relativeSiteRoot,
  url,
  artifactName,
  requestedUpload,
  resolvedUpload,
  discoveredFilesCount,
  skippedReferences,
}: WriteJobSummaryInput): Promise<void> {
  summary.addHeading("HTML Preview Action");
  summary.addRaw(`Entry HTML file: ${relativeHtmlFile}`);
  summary.addBreak();
  summary.addRaw(`Site root: ${relativeSiteRoot}`);
  summary.addBreak();
  summary.addRaw(`Requested upload: ${requestedUpload}`);
  summary.addBreak();
  summary.addRaw(`Resolved upload: ${resolvedUpload}`);
  summary.addBreak();
  summary.addRaw(`Artifact name: ${artifactName}`);
  summary.addBreak();
  summary.addRaw(`Files included: ${discoveredFilesCount}`);
  summary.addBreak();
  summary.addLink("Open preview artifact", url);
  summary.addBreak();

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

  await summary.write();
}

async function run(): Promise<void> {
  const artifactClient = new DefaultArtifactClient();
  const htmlFile = getInput("html_file", { required: true });
  const siteRootInput = getInput("site_root", { required: true });
  const upload = getValidatedUpload(getInput("upload", { required: true }));
  const archiveNameInput = getInput("archive_name");
  const retentionDays = parseIntegerInput(getInput("retention_days"), 0);
  const jobSummary = getBooleanInput("job_summary");

  const {
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
  const discovery = discoverHtmlDependencies({
    entryFile: siteConfig.entryFile,
    siteRoot: siteConfig.siteRoot,
  });

  const resolvedUpload = getUploadStrategy(discovery.files, upload);
  const discoveredFilesCount = discovery.files.length;
  const skippedReferencesCount = discovery.skippedReferences.length;
  const skippedReferencePreview = formatSkippedReferences(discovery.skippedReferences);
  const generatedArchiveName = buildArchiveArtifactName({
    archiveNameInput,
    relativeHtmlFile: siteConfig.relativeHtmlFile,
  });

  if (resolvedUpload === "raw" && archiveNameInput.trim()) {
    warning(
      "archive_name is ignored for single-file non-zipped uploads because GitHub uses the uploaded filename as the artifact name.",
    );
  }

  const filesToUpload = discovery.files.map((file) => file.absolutePath);
  const rootDirectory =
    resolvedUpload === "raw" ? path.dirname(siteConfig.entryFile) : siteConfig.siteRoot;
  const uploadName =
    resolvedUpload === "raw" ? path.basename(siteConfig.entryFile) : generatedArchiveName;
  const uploadResponse = await artifactClient.uploadArtifact(uploadName, filesToUpload, rootDirectory, {
    retentionDays,
    compressionLevel: resolvedUpload === "raw" ? 0 : 6,
    skipArchive: resolvedUpload === "raw",
  });

  if (!uploadResponse.id) {
    throw new Error("Artifact upload did not return an artifact ID");
  }

  const artifactId = String(uploadResponse.id);
  const artifactName = uploadName;
  const artifactUrl = buildArtifactUrl({
    serverUrl,
    owner,
    repo,
    runId,
    artifactId,
  });
  const url = artifactUrl;
  const commentBody = buildCommentBody({
    relativeHtmlFile: siteConfig.relativeHtmlFile,
    relativeSiteRoot: siteConfig.relativeSiteRoot,
    artifactUrl,
    artifactName,
    requestedUpload: upload,
    resolvedUpload,
    discoveredFilesCount,
    skippedReferencesCount,
  });
  const resultJson = buildResultJson({
    relativeHtmlFile: siteConfig.relativeHtmlFile,
    relativeSiteRoot: siteConfig.relativeSiteRoot,
    artifactUrl,
    artifactId,
    artifactName,
    requestedUpload: upload,
    resolvedUpload,
    discoveredFilesCount,
    skippedReferencesCount,
  });

  info(
    `Uploaded preview artifact '${artifactName}' for ${discoveredFilesCount} discovered file(s) with resolved upload '${resolvedUpload}'`,
  );

  setOutput("url", url);
  setOutput("artifact_url", artifactUrl);
  setOutput("artifact_id", artifactId);
  setOutput("artifact_name", artifactName);
  setOutput("discovered_files_count", String(discoveredFilesCount));
  setOutput("skipped_references_count", String(skippedReferencesCount));
  setOutput("result_json", resultJson);
  setOutput("comment_body", commentBody);

  if (jobSummary) {
    await writeJobSummary({
      relativeHtmlFile: siteConfig.relativeHtmlFile,
      relativeSiteRoot: siteConfig.relativeSiteRoot,
      url,
      artifactName,
      requestedUpload: upload,
      resolvedUpload,
      discoveredFilesCount,
      skippedReferences: skippedReferencePreview,
    });
  }
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
