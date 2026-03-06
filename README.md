# HTML Preview Action

Upload preview artifacts for an HTML entrypoint and its related files from a GitHub Actions workflow.

`v5` is a breaking, artifact-only update focused on the most common use case for this action: previewing HTML generated during CI. If you need the old checked-in repo/blob preview behavior, jump to [Migrating from repo-mode usage](#migrating-from-repo-mode-usage).

This action is designed for outputs like:

- generated docs sites
- test reports
- coverage reports
- static sites emitted during CI
- HTML dashboards with local CSS, JS, images, or linked pages

Run it once per entry HTML file, then use the returned outputs in your own summary or PR comment step if you want.

## Usage

```yaml
- name: HTML Preview
  id: html_preview
  uses: pavi2410/html-preview-action@v5
  with:
    html_file: index.html
    site_root: dist
    upload: auto
    job_summary: true
```

The primary output is `steps.html_preview.outputs.url`, which points to the uploaded artifact for this preview run.

## How this action works

When the action runs, it does the following:

1. Resolves `html_file` inside `site_root`
2. Recursively discovers local linked HTML pages and local assets under that root
3. Ignores references that are:
   - remote (`http:`, `https:`)
   - non-previewable (`data:`, `mailto:`, `javascript:`)
   - outside `site_root`
   - missing on disk
4. Chooses an upload strategy:
   - `raw` when only one file is included
   - `archive` when multiple files are needed, or when you explicitly request `upload: archive`
5. Uploads the preview payload as a GitHub Actions artifact
6. Exposes the artifact URL plus summary metadata via outputs

This behavior is intentional: multi-file previews need stable in-artifact paths so linked CSS, images, JS, and nested pages continue to work together.

## Is this action a good fit?

This action is a good fit when:

- your HTML is generated during CI
- the preview payload lives inside a known output directory like `dist/` or `build/`
- you want local linked assets and pages discovered automatically
- you want a GitHub artifact URL plus comment-friendly metadata

This action is probably not a good fit when:

- you want preview behavior for checked-in repository files without generating artifacts
- you need custom hosting, custom routing, or a public deployment URL
- your site relies heavily on remote runtime behavior that artifact downloads do not model
- you want the action itself to post PR comments automatically

## Upload behavior

- **`upload: auto`**
  - default
  - uploads a single discovered file as a non-zipped artifact when possible
  - automatically falls back to `archive` when multiple files are required

- **`upload: archive`**
  - opt-in
  - uploads the full discovered preview payload as one archived artifact
  - useful when you explicitly want one bundle even if the entrypoint is a single file

The resolved behavior is included in `result_json`.

## Discovery behavior

The action recursively discovers local references starting from `html_file`.

It includes:

- relative linked HTML pages
- relative CSS, JS, images, and similar local assets
- root-relative references that still resolve inside `site_root`

It skips:

- remote URLs such as `http:` and `https:`
- `data:`, `mailto:`, and `javascript:` references
- paths that escape `site_root`
- missing files

This makes the action safer for CI-generated output while still handling common site/report layouts.

## Example: generated HTML in CI

```yaml
name: Preview generated HTML

on:
  pull_request:

permissions:
  actions: write
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Build site
        run: |
          mkdir -p dist
          cp index.html dist/index.html

      - name: Upload HTML preview artifact
        id: html_preview
        uses: pavi2410/html-preview-action@v5
        with:
          html_file: index.html
          site_root: dist
          job_summary: true
```

## Example: force an archive upload

```yaml
- name: Upload preview as archive
  id: archived_preview
  uses: pavi2410/html-preview-action@v5
  with:
    html_file: index.html
    site_root: dist
    upload: archive
    archive_name: preview-site
```

## Compose a PR comment yourself

This action does not post PR comments by itself.

Instead, use `comment_body` or `result_json` in your own PR comment step.

```yaml
name: Preview HTML in PR

on:
  pull_request:

permissions:
  actions: write
  contents: read
  issues: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Build docs
        run: |
          mkdir -p dist
          cp index.html dist/index.html

      - name: Upload preview artifact
        id: docs_preview
        uses: pavi2410/html-preview-action@v5
        with:
          html_file: index.html
          site_root: dist

      - name: Comment preview artifact on PR
        uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: |
            ${{ steps.docs_preview.outputs.comment_body }}
```

If you have multiple entrypoints, run this action multiple times with different step ids and compose the final PR comment however you like.

## Inputs

- `upload`
  - Upload behavior
  - Default: `auto`
  - Supported values: `auto`, `archive`

- `html_file`
  - Entry HTML file relative to `site_root`

- `site_root`
  - Root directory used for resolving the entry HTML file and related files
  - Default: `.`

- `archive_name`
  - Optional archive artifact name
  - Ignored for single-file raw uploads because GitHub uses the uploaded filename as the artifact name

- `retention_days`
  - Artifact retention in days
  - `0` uses the repository default

- `job_summary`
  - Whether to write a job summary
  - Default: `true`

## Outputs

- `url`
  - Primary preview URL for the run
  - Same value as `artifact_url`

- `artifact_url`
  - Uploaded artifact URL

- `artifact_id`
  - Uploaded artifact ID

- `artifact_name`
  - Uploaded artifact name

- `discovered_files_count`
  - Number of files included in the preview payload

- `skipped_references_count`
  - Number of skipped references during discovery

- `result_json`
  - JSON object containing:
    - artifact metadata
    - requested and resolved upload behavior
    - preview URL
    - entry HTML file
    - site root
    - discovery counts

- `comment_body`
  - Markdown you can forward into a PR comment action

## Migrating from repo-mode usage

`v5` no longer supports repo/blob preview mode.

If your workflow previously depended on checked-in file previews, you have two options:

- keep using `v4`
- construct the preview URL yourself in your workflow:

```ts
const previewUrl = `https://htmlpreview.github.io/?https://github.com/${owner}/${repo}/blob/${sha}/${htmlFile}`;
```

For most existing users, a drop-in workflow-step replacement is enough.

### Copy-pasteable replacement step

This step recreates the old repo/blob preview URL and exposes `url` and `comment_body` outputs you can use in later steps:

```yaml
- name: Build repo preview URL
  id: repo_preview
  env:
    HTML_FILE: index.html
  run: |
    preview_url="https://htmlpreview.github.io/?https://github.com/${GITHUB_REPOSITORY}/blob/${GITHUB_SHA}/${HTML_FILE}"
    {
      echo "url=${preview_url}"
      echo "comment_body<<EOF"
      echo "HTML preview for \`${HTML_FILE}\`"
      echo
      echo "[Open preview URL](${preview_url})"
      echo "EOF"
    } >> "$GITHUB_OUTPUT"
```

For example, you can use it similarly to the old action outputs:

```yaml
- name: Comment preview URL on PR
  uses: peter-evans/create-or-update-comment@v4
  with:
    issue-number: ${{ github.event.pull_request.number }}
    body: |
      ${{ steps.repo_preview.outputs.comment_body }}
```

If your old workflow passed a different checked-in path, change `HTML_FILE` accordingly.

That path is intentionally not built into `v5`, because this major rewrite is focused on CI-generated preview artifacts.

> [!NOTE]
> Please read the [action.yml](https://github.com/pavi2410/html-preview-action/blob/master/action.yml) to learn more.

## Development

This repository now uses:

- Node 24
- pnpm
- TypeScript source files under `src/`
- `tsdown` for the bundled ESM build with sourcemaps
- `oxlint` and `oxfmt` for linting and formatting

Common commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Credits
https://github.com/htmlpreview/htmlpreview.github.com