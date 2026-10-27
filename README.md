# Video Crapifier

Browser-only tool that ruins a video on purpose:

- locks output to **10 fps** (less work for the browser)
- **pixelates** every kept frame
- **boosts + hard-clips** the audio into a crushed mess

Nothing is uploaded to a server. Processing happens in the visitor’s browser with Canvas, Web Audio, and MediaRecorder.

## Put it on InfinityFree

1. Log into the [InfinityFree](https://www.infinityfree.com/) control panel → **File Manager** (or use FTP).
2. Open `htdocs` (or the folder for your domain).
3. Upload these three files into that folder:
   - `index.html`
   - `styles.css`
   - `crapifier.js`
4. Visit `https://your-site.infinityfreeapp.com/` (or your custom domain).

No PHP, databases, or FFmpeg needed. Free static hosting is enough.

### Tips

- Use **Chrome** or **Firefox**. Output is **WebM**.
- Keep source clips short (a minute or two). Recording happens in real time.
- If the page is silent while processing, click once on the page first so the browser allows audio.
- Google Fonts load from `fonts.googleapis.com` — fine on InfinityFree; if you want zero external requests, the page still works with fallback fonts.

## Local preview

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
