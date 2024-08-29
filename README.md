# HTML Preview Action

This is a simple Github Action which comments on your PRs with a link to preview HTML files directly in the browser.

This is just a novelty action, but feel free to use it. If you'd like to contribute then just open a PR.

## Usage

```yaml
- name: HTML Preview
  id: html_preview
  uses: pavi2410/html-preview-action@v4
  with:
    html_file: 'index.html'
    job_summary: true
```

To get the `url` output, use this `steps.html_preview.outputs.url` in your later steps.

> [!note]
> Please read the [action.yml](https://github.com/pavi2410/html-preview-action/blob/master/action.yml) to learn more.


## Credits
https://github.com/htmlpreview/htmlpreview.github.com