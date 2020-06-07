# HTML Preview Action

This is a simple Github Action which comments on your PRs with a link to preview HTML files directly in the browser.

This is just a novelty action, but feel free to use it. If you'd like to contribute then just open a PR.

## Usage

```yaml
- name: HTML Preview
  id: html_preview
  uses: pavi2410/html-preview-action@v2
  with:
    html_file: 'index.html'
```

To get the `url` output, use this `steps.html_preview.outputs.url` in your later steps.

## Credits
https://github.com/htmlpreview/htmlpreview.github.com