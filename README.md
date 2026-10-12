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

## Taking a puzzle down

Puzzles live in their links, so a sent link can't be deleted. But the site can refuse to show one:

1. Find the puzzle's ID. It's shown when you create the link, and in small print under the puzzle when anyone opens it.
2. On GitHub, edit `revoked.json` on `main` and add the ID to the list, e.g. `"revoked": ["1a2b3c4d"]`.
3. After GitHub Pages redeploys (a minute or two), that link and any other link to the same puzzle show "This puzzle has been removed".

The ID comes from the puzzle's title, categories and words, so changing any of those makes a new puzzle with a new ID.

## Visitor stats

Visits are counted with [GoatCounter](https://www.goatcounter.com) (free, no cookies). To switch it on, set `GOATCOUNTER_CODE` near the top of `app.js` to your GoatCounter code (the `xyz` in `xyz.goatcounter.com`).

It records page views for the maker (`/`), played puzzles (`/play`) and removed puzzles (`/removed`), plus the events `link-created`, `puzzle-won` and `puzzle-lost`. The part of the link after `#`, which holds the puzzle and its answers, is never sent. Counting is off on `localhost` and in embedded previews.
