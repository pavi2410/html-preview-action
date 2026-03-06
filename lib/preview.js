import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const CSS_EXTENSIONS = new Set([".css"]);
const REMOTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const MAX_DISCOVERED_FILES = 200;

function toPosixPath(value) {
    return value.split(path.sep).join("/");
}

function stripQueryAndHash(value) {
    return value.split("#", 1)[0].split("?", 1)[0];
}

function decodePathname(value) {
    try {
        return decodeURI(value);
    } catch {
        return value;
    }
}

function normalizeInputPath(value) {
    const trimmed = value.trim();

    if (!trimmed) {
        return ".";
    }

    return trimmed.replace(/^\/+/, "") || ".";
}

function isInsideRoot(rootDirectory, targetPath) {
    const relativePath = path.relative(rootDirectory, targetPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function ensureInsideRoot(rootDirectory, targetPath, label) {
    if (!isInsideRoot(rootDirectory, targetPath)) {
        throw new Error(`${label} must resolve inside ${toPosixPath(rootDirectory)}`);
    }
}

function resolveSiteConfig({ workspace, siteRootInput, htmlFileInput }) {
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

function isHtmlPath(filePath) {
    return HTML_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isCssPath(filePath) {
    return CSS_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isIgnoredReference(reference) {
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

function extractAttributeReferences(htmlContent) {
    const references = [];
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

function extractCssReferences(cssContent) {
    const references = [];
    const importPattern = /@import\s+(?:url\()?['"]?([^'"\)\s]+)['"]?\)?/gis;
    const urlPattern = /url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gis;

    for (const match of cssContent.matchAll(importPattern)) {
        references.push(match[1]);
    }

    for (const match of cssContent.matchAll(urlPattern)) {
        references.push(match[1]);
    }

    return references;
}

function resolveReferencePath({ currentFile, siteRoot, reference }) {
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

export function discoverHtmlDependencies({ entryFile, siteRoot, maxFiles = MAX_DISCOVERED_FILES }) {
    if (!existsSync(entryFile) || !statSync(entryFile).isFile()) {
        throw new Error(`html_file not found: ${entryFile}`);
    }

    ensureInsideRoot(siteRoot, entryFile, "html_file");

    const includedFiles = new Map();
    const queuedHtmlFiles = [entryFile];
    const queuedCssFiles = [];
    const visitedHtmlFiles = new Set();
    const visitedCssFiles = new Set();
    const skippedReferences = [];

    function includeResolvedFile(resolvedPath) {
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

            if (visitedHtmlFiles.has(currentFile)) {
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

                if (resolution.skip) {
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

        if (visitedCssFiles.has(currentFile)) {
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

            if (resolution.skip) {
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

    const files = Array.from(includedFiles.entries())
        .map(([absolutePath, metadata]) => ({ absolutePath, ...metadata }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return {
        files,
        skippedReferences,
    };
}

function sanitizeArtifactNameSegment(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "index-html";
}

export function buildArchiveArtifactName({ artifactNameInput, relativeHtmlFile }) {
    if (artifactNameInput) {
        return artifactNameInput.trim();
    }

    const baseName = sanitizeArtifactNameSegment(relativeHtmlFile);
    return `html-preview-${baseName}-${randomUUID().slice(0, 8)}`;
}

export function buildRawArtifactFileName({ artifactNameInput, relativePath, multipleFiles }) {
    const extension = path.extname(relativePath).toLowerCase();
    const rawBaseName = extension ? relativePath.slice(0, -extension.length) : relativePath;
    const sanitizedBaseName = sanitizeArtifactNameSegment(rawBaseName.replaceAll("/", "--"));
    const prefix = artifactNameInput?.trim() ? `${sanitizeArtifactNameSegment(artifactNameInput.trim())}--` : "";

    if (!multipleFiles && !artifactNameInput?.trim()) {
        return path.basename(relativePath);
    }

    return `${prefix}${sanitizedBaseName}${extension}`;
}

export function parseIntegerInput(value, fallbackValue) {
    if (!value?.trim()) {
        return fallbackValue;
    }

    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid integer input: ${value}`);
    }

    return parsed;
}

export function buildArtifactUrl({ serverUrl, owner, repo, runId, artifactId }) {
    return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}/artifacts/${artifactId}`;
}

export function buildRepoPreviewUrl({ serverUrl, owner, repo, sha, htmlFile }) {
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
}) {
    const lines = [];

    lines.push(`HTML preview for \`${relativeHtmlFile}\``);
    lines.push("");

    if (mode === "artifact") {
        lines.push(`[Open primary preview artifact](${artifactUrl})`);
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

export function formatSkippedReferences(skippedReferences, limit = 10) {
    return skippedReferences.slice(0, limit).map(({ from, reference, reason }) => ({
        from,
        reference,
        reason,
    }));
}

export function getUploadStrategy(files, artifactFormat) {
    if (artifactFormat === "archive") {
        return "archive";
    }

    return files.length === 1 ? "raw" : "multi_raw";
}

export { MAX_DISCOVERED_FILES, resolveSiteConfig, toPosixPath };
