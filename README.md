# HTML Preview Action

Generate a browser preview URL for an HTML file that is already checked into your repository.

This is especially useful in pull requests: you can preview the HTML file exactly as it exists at the PR's commit, without setting up a separate preview environment, deployment pipeline, or hosting infrastructure.

Use it to help maintainers and contributors review HTML changes live from the PR itself.

## Usage

```yaml
- name: HTML Preview
  id: html_preview
  uses: pavi2410/html-preview-action@v4
  with:
    html_file: 'index.html'
    job_summary: true
```

This action outputs the generated preview URL as `steps.html_preview.outputs.url`.

## Common use case: preview HTML files in a PR

If your repository contains HTML files such as `index.html`, `docs/demo.html`, or generated static output that is committed to the repo, this action can generate a preview URL for that file at the exact commit being tested in the workflow.

That makes it easy for reviewers to open the rendered page directly from the PR context.

## Post the preview URL as a PR comment

You can wire the generated `url` output into a PR comment action so the preview link is visible directly in the pull request conversation.

```yaml
name: Preview HTML in PR

on:
  pull_request:

permissions:
  contents: read
  issues: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate HTML preview URL
        id: html_preview
        uses: pavi2410/html-preview-action@v4
        with:
          html_file: index.html
          job_summary: true

      - name: Comment preview URL on PR
        uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: |
            HTML preview for `${{ github.sha }}`:
            ${{ steps.html_preview.outputs.url }}
```

This workflow is useful when you want reviewers to:

- See the preview link without opening workflow logs
- Validate checked-in HTML changes at the PR commit
- Review live output without provisioning any extra infrastructure

> [!NOTE]
> Please read the [action.yml](https://github.com/pavi2410/html-preview-action/blob/master/action.yml) to learn more.


## Credits
https://github.com/htmlpreview/htmlpreview.github.com