# Grey Connections

Make your own Connections-style puzzles and send them to friends.

- **Create:** fill in four categories (yellow → purple, easiest → trickiest) with four words each, then hit **Create link**.
- **Share:** the whole puzzle is packed into the link (compressed, after the `#`), so there's no server, database, or account. Anyone with the link can play.
- **Play:** same rules as the original game — select four tiles, submit, four mistakes allowed, "One away..." hints, and a shareable emoji results grid.

Progress on each puzzle and your in-progress draft are saved in the browser's local storage.

## Run locally

It's plain HTML/CSS/JS with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish with GitHub Pages

Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick the branch and `/ (root)`, and save. Your site will be at `https://<user>.github.io/grey-connections/`.

Note: the answers are encoded (base64), not encrypted, so a determined player could decode a link to peek.
