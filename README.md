# HTML Preview Action

This is a simple Github Action which comments on your PRs with a link to preview HTML files directly in the browser.

This is just a novelty action, but feel free to use it. If you'd like to contribute then just open a PR.

## Usage

```yaml
- name: HTML Preview
  uses: pavi2410/html-preview-action@master
  with:
    msg: 'Click here to preview HTML page in browser'
    html_file: 'index.html'
    gh_token: ${{ secrets.GITHUB_TOKEN }}
```
