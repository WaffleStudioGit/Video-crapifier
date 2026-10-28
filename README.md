# Video / Audio Crapifier

Browser-only tools that ruin media on purpose. Nothing is uploaded to a server.

### Video (`index.html`)
- locks output to **10 fps**
- **pixelates** every kept frame
- **boosts + hard-clips** the audio

### Audio (`audio.html`)
- crushes sample rate (default **8 kHz**)
- **boosts + hard-clips**
- **bit-crushes** (default 8-bit)
- downloads a mangled **WAV**

## Put it on InfinityFree

1. Log into the [InfinityFree](https://www.infinityfree.com/) control panel → **File Manager** (or use FTP).
2. Open `htdocs` (or the folder for your domain).
3. Upload these files into that folder:
   - `index.html`
   - `audio.html`
   - `styles.css`
   - `crapifier.js`
   - `audio-crapifier.js`
4. Visit your site — use the **Video / Audio** nav to switch modes.

No PHP, databases, or FFmpeg needed.

### Tips

- Use **Chrome** or **Firefox**.
- Video output is **WebM**; audio output is **WAV**.
- Keep video clips short (recording is real-time). Audio render is offline and usually fast.
- Google Fonts load from `fonts.googleapis.com`; fallbacks still work offline.

## Local preview

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` (video) or `http://localhost:8080/audio.html` (audio).
