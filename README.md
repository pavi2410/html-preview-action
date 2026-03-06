# HTML Preview Action

Upload preview artifacts for an HTML entrypoint and its related files from a GitHub Actions workflow.

`v5` is a breaking, artifact-first update focused on the most common use case for this action: previewing HTML generated during CI.

By default, the action:

- resolves an entry HTML file from `site_root`
- discovers linked local HTML pages and assets under that root
- uploads each discovered file as its own non-zipped artifact for easier online viewing
- exposes a primary artifact URL, aggregate artifact metadata, and PR-comment-friendly markdown outputs

This keeps the action simple: run it once per entrypoint, then compose your own PR comment step if you want to surface one or many previews in the pull request.

## Usage

```yaml
- name: HTML Preview
  id: html_preview
  uses: pavi2410/html-preview-action@v5
  with:
    html_file: index.html
    site_root: dist
    job_summary: true
```

The primary output is `steps.html_preview.outputs.url`.

In the default `artifact` mode, `url` is the uploaded artifact URL for the entry HTML file.

## Default behavior in `v5`

The default mode is `artifact`.

That means this action now favors CI-generated HTML over checked-in blob URLs.

The default artifact delivery format is `raw`.

Examples:

- `dist/index.html`
- `build/docs/index.html`
- generated static documentation
- generated HTML reports with local CSS, JS, images, or linked pages

## Single-file vs multi-file uploads

In `artifact` mode, this action now supports two explicit delivery formats:

- **`artifact_format: raw`**
  - default
  - uploads each discovered file as its own non-zipped artifact
  - best when maintainers want directly viewable/downloadable HTML and asset files from the Actions UI

- **`artifact_format: archive`**
  - opt-in
  - uploads the full discovered preview payload as one archived artifact
  - useful when maintainers want one bundle to download and preview locally

So the action uses these upload strategies:

- `raw`
  - when only the entry HTML file is included

- `multi_raw`
  - when multiple discovered files are uploaded as separate non-zipped artifacts

- `archive`
  - when `artifact_format: archive` is selected

The resolved strategy is exposed via `steps.<id>.outputs.upload_strategy`.

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
        uses: actions/checkout@v4

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
          artifact_name: preview-site
          job_summary: true
```

## Compose a PR comment yourself

This action does not post PR comments by itself.

Instead, use `comment_body` or any of the individual outputs in your own PR comment step.

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
        uses: actions/checkout@v4

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

## Example: explicit archive upload

```yaml
- name: Upload preview as archive
  id: archived_preview
  uses: pavi2410/html-preview-action@v5
  with:
    html_file: index.html
    site_root: dist
    artifact_format: archive
    artifact_name: preview-site-archive
```

## Inputs

- `mode`
  - Preview mode
  - Default: `artifact`
  - Supported values today: `artifact`, `repo`

- `artifact_format`
  - Artifact delivery format used in `artifact` mode
  - Default: `raw`
  - Supported values: `raw`, `archive`

- `html_file`
  - Entry HTML file relative to `site_root`

- `site_root`
  - Root directory used for resolving the entry HTML file and related files
  - Default: `.`

- `artifact_name`
  - Optional archive artifact name
  - In `raw` multi-file mode, used as a filename prefix for uploaded raw artifacts

- `retention_days`
  - Artifact retention in days
  - `0` uses the repository default

- `job_summary`
  - Whether to write a job summary
  - Default: `true`

## Outputs

- `url`
  - Primary preview URL for the run
  - In `artifact` mode, this is the entry HTML artifact URL

- `artifact_url`
  - Primary uploaded artifact URL in `artifact` mode

- `artifact_id`
  - Primary uploaded artifact ID in `artifact` mode

- `artifact_name`
  - Primary uploaded artifact name in `artifact` mode

- `artifact_count`
  - Number of uploaded artifacts in `artifact` mode

- `artifact_names`
  - JSON array of uploaded artifact names

- `artifact_ids`
  - JSON array of uploaded artifact IDs

- `artifact_urls`
  - JSON array of uploaded artifact URLs

- `artifact_manifest`
  - JSON array of uploaded artifact records with `relativePath`, `artifactName`, `artifactId`, `artifactUrl`, and `isEntry`

- `source_url`
  - Source blob URL in `repo` mode

- `mode`
  - Resolved preview mode

- `upload_strategy`
  - `raw`, `multi_raw`, `archive`, or `repo`

- `discovered_files_count`
  - Number of files included in the preview payload

- `skipped_references_count`
  - Number of skipped references during discovery

- `comment_body`
  - Markdown you can forward into a PR comment action

## Optional fallback: repo mode

If you still want the old checked-in-file behavior, you can use `mode: repo`.

```yaml
- name: Repo mode preview
  id: repo_preview
  uses: pavi2410/html-preview-action@v5
  with:
    mode: repo
    html_file: index.html
    site_root: .
```

> [!NOTE]
> Please read the [action.yml](https://github.com/pavi2410/html-preview-action/blob/master/action.yml) to learn more.


## Credits
https://github.com/htmlpreview/htmlpreview.github.com