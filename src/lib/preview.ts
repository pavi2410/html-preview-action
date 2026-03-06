import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const CSS_EXTENSIONS = new Set([".css"]);
const REMOTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const MAX_DISCOVERED_FILES = 200;

type ResolveSiteConfigInput = {
  workspace: string;
  siteRootInput: string;
  htmlFileInput: string;
};

type ResolvedFileMetadata = {
  relativePath: string;
  kind: "html" | "asset";
};

type SkippedReference = {
  from: string;
  reference: string;
  reason: string;
};

type ResolveReferencePathInput = {
  currentFile: string;
  siteRoot: string;
  reference: string;
};

type ResolveReferencePathResult = { resolvedPath: string } | { skip: true; reason: string };

type DiscoverHtmlDependenciesInput = {
  entryFile: string;
  siteRoot: string;
  maxFiles?: number;
};

export type DiscoveredFile = {
  absolutePath: string;
  relativePath: string;
  kind: "html" | "asset";
};

export type DiscoverHtmlDependenciesResult = {
  files: DiscoveredFile[];
  skippedReferences: SkippedReference[];
};

type BuildArchiveArtifactNameInput = {
  artifactNameInput: string;
  relativeHtmlFile: string;
};

type BuildArtifactUrlInput = {
  serverUrl: string;
  owner: string;
  repo: string;
  runId: string | number;
  artifactId: string | number;
};

type BuildRepoPreviewUrlInput = {
  serverUrl: string;
  owner: string;
  repo: string;
  sha: string;
  htmlFile: string;
};

export type ArtifactEntry = {
  relativePath: string;
  artifactId: string;
  artifactName: string;
  artifactUrl: string;
  isEntry: boolean;
};

type BuildCommentBodyInput = {
  relativeHtmlFile: string;
  relativeSiteRoot: string;
  artifactUrl: string;
  artifactEntries?: ArtifactEntry[];
  sourceUrl?: string;
  uploadStrategy: string;
  artifactCount: number;
  discoveredFilesCount: number;
  skippedReferencesCount: number;
  mode: string;
};

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}

function decodePathname(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function normalizeInputPath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return ".";
  }

  return trimmed.replace(/^\/+/, "") || ".";
}

function isInsideRoot(rootDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(rootDirectory, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function ensureInsideRoot(rootDirectory: string, targetPath: string, label: string): void {
  if (!isInsideRoot(rootDirectory, targetPath)) {
    throw new Error(`${label} must resolve inside ${toPosixPath(rootDirectory)}`);
  }
}

export function resolveSiteConfig({
  workspace,
  siteRootInput,
  htmlFileInput,
}: ResolveSiteConfigInput) {
  const siteRoot = path.isAbsolute(siteRootInput || "")
    ? path.resolve(siteRootInput)
    : path.resolve(workspace, normalizeInputPath(siteRootInput || "."));
  const normalizedHtmlFile = normalizeInputPath(htmlFileInput);
  const entryFile = path.resolve(siteRoot, normalizedHtmlFile);

  ensureInsideRoot(workspace, siteRoot, "site_root");
  ensureInsideRoot(siteRoot, entryFile, "html_file");

  return {
    workspace,
    siteRoot,
    entryFile,
    relativeHtmlFile: toPosixPath(path.relative(siteRoot, entryFile)),
    relativeSiteRoot: toPosixPath(path.relative(workspace, siteRoot) || "."),
  };
}

function isHtmlPath(filePath: string): boolean {
  return HTML_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isCssPath(filePath: string): boolean {
  return CSS_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isIgnoredReference(reference: string): boolean {
  if (!reference) {
    return true;
  }

  if (reference.startsWith("#")) {
    return true;
  }

  if (reference.startsWith("//")) {
    return true;
  }

  if (REMOTE_PROTOCOL_RE.test(reference)) {
    return true;
  }

  return false;
}

function extractAttributeReferences(htmlContent: string): string[] {
  const references: string[] = [];
  const attributePattern = /\b(?:href|src|poster|data)=(["'])(.*?)\1/gis;
  const srcsetPattern = /\bsrcset=(["'])(.*?)\1/gis;

  for (const match of htmlContent.matchAll(attributePattern)) {
    references.push(match[2]);
  }

  for (const match of htmlContent.matchAll(srcsetPattern)) {
    const entries = match[2].split(",");

    for (const entry of entries) {
      const [candidate] = entry.trim().split(/\s+/, 1);
      if (candidate) {
        references.push(candidate);
      }
    }
  }

  return references;
}

function extractCssReferences(cssContent: string): string[] {
  const references: string[] = [];
  const importPattern = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/gis;
  const urlPattern = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gis;

  for (const match of cssContent.matchAll(importPattern)) {
    references.push(match[1]);
  }

  for (const match of cssContent.matchAll(urlPattern)) {
    references.push(match[1]);
  }

  return references;
}

function resolveReferencePath({
  currentFile,
  siteRoot,
  reference,
}: ResolveReferencePathInput): ResolveReferencePathResult {
  const sanitizedReference = decodePathname(stripQueryAndHash(reference.trim()));

  if (!sanitizedReference || isIgnoredReference(sanitizedReference)) {
    return { skip: true, reason: "ignored_reference" };
  }

  const withoutLeadingSlash = sanitizedReference.replace(/^\/+/, "");
  const candidatePath = sanitizedReference.startsWith("/")
    ? path.resolve(siteRoot, withoutLeadingSlash)
    : path.resolve(path.dirname(currentFile), sanitizedReference);

  if (!isInsideRoot(siteRoot, candidatePath)) {
    return { skip: true, reason: "outside_site_root" };
  }

  if (existsSync(candidatePath)) {
    const stats = statSync(candidatePath);

    if (stats.isDirectory()) {
      const directoryIndex = path.join(candidatePath, "index.html");
      if (existsSync(directoryIndex)) {
        return { resolvedPath: directoryIndex };
      }
    }

    if (stats.isFile()) {
      return { resolvedPath: candidatePath };
    }
  }

  const indexCandidate = path.join(candidatePath, "index.html");
  if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
    return { resolvedPath: indexCandidate };
  }

  return { skip: true, reason: "missing_file" };
}

export function discoverHtmlDependencies({
  entryFile,
  siteRoot,
  maxFiles = MAX_DISCOVERED_FILES,
}: DiscoverHtmlDependenciesInput): DiscoverHtmlDependenciesResult {
  if (!existsSync(entryFile) || !statSync(entryFile).isFile()) {
    throw new Error(`html_file not found: ${entryFile}`);
  }

  ensureInsideRoot(siteRoot, entryFile, "html_file");

  const includedFiles = new Map<string, ResolvedFileMetadata>();
  const queuedHtmlFiles: string[] = [entryFile];
  const queuedCssFiles: string[] = [];
  const visitedHtmlFiles = new Set<string>();
  const visitedCssFiles = new Set<string>();
  const skippedReferences: SkippedReference[] = [];

  function includeResolvedFile(resolvedPath: string): void {
    if (!includedFiles.has(resolvedPath)) {
      if (includedFiles.size >= maxFiles) {
        throw new Error(`Discovered more than ${maxFiles} files under site_root`);
      }

      includedFiles.set(resolvedPath, {
        relativePath: toPosixPath(path.relative(siteRoot, resolvedPath)),
        kind: isHtmlPath(resolvedPath) ? "html" : "asset",
      });
    }

    if (isHtmlPath(resolvedPath) && !visitedHtmlFiles.has(resolvedPath)) {
      queuedHtmlFiles.push(resolvedPath);
    }

    if (isCssPath(resolvedPath) && !visitedCssFiles.has(resolvedPath)) {
      queuedCssFiles.push(resolvedPath);
    }
  }

  while (queuedHtmlFiles.length > 0 || queuedCssFiles.length > 0) {
    if (queuedHtmlFiles.length > 0) {
      const currentFile = queuedHtmlFiles.shift();

      if (!currentFile || visitedHtmlFiles.has(currentFile)) {
        continue;
      }

      visitedHtmlFiles.add(currentFile);
      includeResolvedFile(currentFile);

      const htmlContent = readFileSync(currentFile, "utf8");
      const references = extractAttributeReferences(htmlContent);

      for (const reference of references) {
        const resolution = resolveReferencePath({
          currentFile,
          siteRoot,
          reference,
        });

        if ("skip" in resolution) {
          skippedReferences.push({
            from: toPosixPath(path.relative(siteRoot, currentFile)),
            reference,
            reason: resolution.reason,
          });
          continue;
        }

        includeResolvedFile(resolution.resolvedPath);
      }
      continue;
    }

    const currentFile = queuedCssFiles.shift();

    if (!currentFile || visitedCssFiles.has(currentFile)) {
      continue;
    }

    visitedCssFiles.add(currentFile);
    includeResolvedFile(currentFile);

    const cssContent = readFileSync(currentFile, "utf8");
    const references = extractCssReferences(cssContent);

    for (const reference of references) {
      const resolution = resolveReferencePath({
        currentFile,
        siteRoot,
        reference,
      });

      if ("skip" in resolution) {
        skippedReferences.push({
          from: toPosixPath(path.relative(siteRoot, currentFile)),
          reference,
          reason: resolution.reason,
        });
        continue;
      }

      includeResolvedFile(resolution.resolvedPath);
    }
  }

  const files: DiscoveredFile[] = Array.from(includedFiles.entries())
    .map(([absolutePath, metadata]) => ({ absolutePath, ...metadata }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    files,
    skippedReferences,
  };
}

function sanitizeArtifactNameSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "index-html"
  );
}

export function buildArchiveArtifactName({
  artifactNameInput,
  relativeHtmlFile,
}: BuildArchiveArtifactNameInput): string {
  if (artifactNameInput) {
    return artifactNameInput.trim();
  }

  const baseName = sanitizeArtifactNameSegment(relativeHtmlFile);
  return `html-preview-${baseName}-${randomUUID().slice(0, 8)}`;
}

export function parseIntegerInput(value: string, fallbackValue: number): number {
  if (!value?.trim()) {
    return fallbackValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid integer input: ${value}`);
  }

  return parsed;
}

export function buildArtifactUrl({
  serverUrl,
  owner,
  repo,
  runId,
  artifactId,
}: BuildArtifactUrlInput): string {
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}/artifacts/${artifactId}`;
}

export function buildRepoPreviewUrl({
  serverUrl,
  owner,
  repo,
  sha,
  htmlFile,
}: BuildRepoPreviewUrlInput) {
  const sourceUrl = encodeURI(`${serverUrl}/${owner}/${repo}/blob/${sha}/${htmlFile}`);
  return {
    sourceUrl,
    previewUrl: `https://htmlpreview.github.io/?${sourceUrl}`,
  };
}

export function buildCommentBody({
  relativeHtmlFile,
  relativeSiteRoot,
  artifactUrl,
  artifactEntries = [],
  sourceUrl,
  uploadStrategy,
  artifactCount,
  discoveredFilesCount,
  skippedReferencesCount,
  mode,
}: BuildCommentBodyInput): string {
  const lines: string[] = [];

  lines.push(`HTML preview for \`${relativeHtmlFile}\``);
  lines.push("");

  if (mode === "artifact") {
    lines.push(`[Open preview artifact](${artifactUrl})`);
    lines.push("");
    lines.push(`- Mode: artifact`);
    lines.push(`- Site root: \`${relativeSiteRoot}\``);
    lines.push(`- Upload strategy: ${uploadStrategy}`);
    lines.push(`- Artifact uploads: ${artifactCount}`);
    lines.push(`- Files included: ${discoveredFilesCount}`);
    lines.push(`- References skipped: ${skippedReferencesCount}`);

    if (artifactEntries.length > 1) {
      lines.push("");
      lines.push(`Artifacts:`);

      for (const artifactEntry of artifactEntries.slice(0, 10)) {
        const title = artifactEntry.isEntry
          ? `${artifactEntry.relativePath} (entry)`
          : artifactEntry.relativePath;
        lines.push(`- [${title}](${artifactEntry.artifactUrl})`);
      }

      if (artifactEntries.length > 10) {
        lines.push(`- ...and ${artifactEntries.length - 10} more artifacts`);
      }
    }
  } else {
    lines.push(`[Open preview URL](${artifactUrl})`);
    lines.push("");
    lines.push(`- Mode: repo`);
    lines.push(`- Source URL: ${sourceUrl}`);
  }

  return lines.join("\n");
}

export function formatSkippedReferences(
  skippedReferences: SkippedReference[],
  limit = 10,
): SkippedReference[] {
  return skippedReferences.slice(0, limit).map(({ from, reference, reason }) => ({
    from,
    reference,
    reason,
  }));
}

export function getUploadStrategy(
  files: DiscoveredFile[],
  artifactFormat: string,
): "raw" | "archive" {
  if (artifactFormat === "archive" || files.length > 1) {
    return "archive";
  }

  return "raw";
}

export { MAX_DISCOVERED_FILES };
