# Crapifier

One-page browser tool that ruins audio or video. Drop a file — type is detected automatically.

### Video
- **10 fps**, pixelation, boosted/clipped soundtrack → **WebM**

### Audio
- Sample-rate crush, boost/clip, bit crush → **WAV**

UI uses **Gruvbox dark** (morhetz palette). Processing stays in the browser.

## InfinityFree

Upload to `/htdocs`:

- `index.html`
- `styles.css`
- `crapifier.js`
- `audio.html` (optional redirect for old links)

## Local preview

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.
