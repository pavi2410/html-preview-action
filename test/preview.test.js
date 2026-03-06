import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    buildArchiveArtifactName,
    buildArtifactUrl,
    buildCommentBody,
    buildRawArtifactFileName,
    discoverHtmlDependencies,
    getUploadStrategy,
    parseIntegerInput,
    resolveSiteConfig,
} from "../lib/preview.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesRoot = path.join(__dirname, "fixtures");

test("resolveSiteConfig resolves paths within site_root", () => {
    const config = resolveSiteConfig({
        workspace: process.cwd(),
        siteRootInput: "test/fixtures/basic-single-file",
        htmlFileInput: "index.html",
    });

    assert.equal(config.relativeHtmlFile, "index.html");
    assert.equal(config.relativeSiteRoot, "test/fixtures/basic-single-file");
    assert.match(config.entryFile, /basic-single-file[\\/]index\.html$/);
});

test("resolveSiteConfig allows absolute site_root inside the workspace", () => {
    const absoluteSiteRoot = path.join(process.cwd(), "test/fixtures/basic-single-file");
    const config = resolveSiteConfig({
        workspace: process.cwd(),
        siteRootInput: absoluteSiteRoot,
        htmlFileInput: "index.html",
    });

    assert.equal(config.siteRoot, absoluteSiteRoot);
    assert.equal(config.relativeSiteRoot, "test/fixtures/basic-single-file");
});

test("discoverHtmlDependencies includes linked pages and assets", () => {
    const siteRoot = path.join(fixturesRoot, "linked-pages");
    const result = discoverHtmlDependencies({
        entryFile: path.join(siteRoot, "index.html"),
        siteRoot,
    });

    assert.deepEqual(
        result.files.map((file) => file.relativePath),
        [
            "about.html",
            "assets/site.css",
            "assets/team.css",
            "images/logo.svg",
            "index.html",
            "nested/team.html",
        ]
    );
    assert.equal(getUploadStrategy(result.files, "raw"), "multi_raw");
    assert.equal(getUploadStrategy(result.files, "archive"), "archive");
    assert.equal(result.skippedReferences.length, 0);
    assert.ok(result.files.some((file) => file.relativePath === "images/logo.svg"));
});

test("discoverHtmlDependencies skips unsafe and out-of-root references", () => {
    const siteRoot = path.join(fixturesRoot, "discovery-escape-attempt");
    const result = discoverHtmlDependencies({
        entryFile: path.join(siteRoot, "index.html"),
        siteRoot,
    });

    assert.deepEqual(
        result.files.map((file) => file.relativePath),
        ["images/safe.png", "index.html", "nested/inside.html"]
    );

    const reasons = result.skippedReferences.map((item) => item.reason).sort();
    assert.deepEqual(reasons, [
        "ignored_reference",
        "ignored_reference",
        "ignored_reference",
        "outside_site_root",
    ]);
});

test("single-file discovery uses raw upload strategy and basename artifact name", () => {
    const siteRoot = path.join(fixturesRoot, "basic-single-file");
    const result = discoverHtmlDependencies({
        entryFile: path.join(siteRoot, "index.html"),
        siteRoot,
    });

    assert.equal(result.files.length, 1);
    assert.equal(getUploadStrategy(result.files, "raw"), "raw");
    assert.equal(
        buildRawArtifactFileName({
            artifactNameInput: "",
            relativePath: "index.html",
            multipleFiles: false,
        }),
        "index.html"
    );
    assert.equal(
        buildRawArtifactFileName({
            artifactNameInput: "preview-site",
            relativePath: "nested/team.html",
            multipleFiles: true,
        }),
        "preview-site--nested--team.html"
    );
    assert.match(
        buildArchiveArtifactName({
            artifactNameInput: "",
            relativeHtmlFile: "index.html",
        }),
        /^html-preview-index\.html-/
    );
});

test("parseIntegerInput and URL/comment helpers produce expected metadata", () => {
    assert.equal(parseIntegerInput("", 0), 0);
    assert.equal(parseIntegerInput("7", 0), 7);
    assert.throws(() => parseIntegerInput("-1", 0), /Invalid integer input/);

    const artifactUrl = buildArtifactUrl({
        serverUrl: "https://github.com",
        owner: "pavi2410",
        repo: "html-preview-action",
        runId: 123,
        artifactId: 456,
    });

    assert.equal(
        artifactUrl,
        "https://github.com/pavi2410/html-preview-action/actions/runs/123/artifacts/456"
    );

    const commentBody = buildCommentBody({
        relativeHtmlFile: "index.html",
        relativeSiteRoot: "dist",
        artifactUrl,
        artifactEntries: [
            {
                relativePath: "index.html",
                artifactUrl,
                isEntry: true,
            },
            {
                relativePath: "about.html",
                artifactUrl: "https://github.com/pavi2410/html-preview-action/actions/runs/123/artifacts/789",
                isEntry: false,
            },
        ],
        uploadStrategy: "multi_raw",
        artifactCount: 2,
        discoveredFilesCount: 3,
        skippedReferencesCount: 1,
        mode: "artifact",
    });

    assert.match(commentBody, /Open primary preview artifact/);
    assert.match(commentBody, /Artifact uploads: 2/);
    assert.match(commentBody, /Artifacts:/);
    assert.match(commentBody, /Files included: 3/);
    assert.match(commentBody, /References skipped: 1/);
});
