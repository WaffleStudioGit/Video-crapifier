(() => {
  const FPS = 10;
  const FRAME_MS = 1000 / FPS;
  const MAX_WIDTH = 640;

  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const dropTitle = document.getElementById("dropTitle");
  const dropSub = document.getElementById("dropSub");
  const controls = document.getElementById("controls");
  const pixelSize = document.getElementById("pixelSize");
  const boost = document.getElementById("boost");
  const clip = document.getElementById("clip");
  const pixelVal = document.getElementById("pixelVal");
  const boostVal = document.getElementById("boostVal");
  const clipVal = document.getElementById("clipVal");
  const goBtn = document.getElementById("goBtn");
  const stopBtn = document.getElementById("stopBtn");
  const previewWrap = document.getElementById("previewWrap");
  const preview = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const result = document.getElementById("result");
  const outVideo = document.getElementById("outVideo");
  const downloadBtn = document.getElementById("downloadBtn");

  let file = null;
  let objectUrl = null;
  let running = false;
  let stopRequested = false;
  let activeRecorder = null;
  let activeAudioCtx = null;
  let activeVideo = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function syncLabels() {
    pixelVal.textContent = pixelSize.value;
    boostVal.textContent = `${boost.value}×`;
    clipVal.textContent = `${clip.value}%`;
  }

  pixelSize.addEventListener("input", syncLabels);
  boost.addEventListener("input", syncLabels);
  clip.addEventListener("input", syncLabels);
  syncLabels();

  function pickMimeType() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const type of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  /** Hard-clip waveshaper: boost into a brick wall. */
  function makeClipCurve(hardnessPct) {
    const n = 2048;
    const curve = new Float32Array(n);
    const drive = 1 + (hardnessPct / 100) * 24;
    const ceiling = 0.98;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      let y = Math.tanh(x * drive);
      if (y > ceiling) y = ceiling;
      if (y < -ceiling) y = -ceiling;
      // Extra fold for "really bad"
      if (Math.abs(x * drive) > 1.2) {
        y = Math.sign(y) * ceiling;
      }
      curve[i] = y;
    }
    return curve;
  }

  function drawPixelated(video, ctx, small, sctx, block) {
    const w = preview.width;
    const h = preview.height;
    const sw = Math.max(1, Math.floor(w / block));
    const sh = Math.max(1, Math.floor(h / block));
    if (small.width !== sw || small.height !== sh) {
      small.width = sw;
      small.height = sh;
    }
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(video, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  }

  function loadVideo(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.playsInline = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.src = url;
      video.onloadedmetadata = () => resolve(video);
      video.onerror = () => reject(new Error("Could not read that video."));
    });
  }

  function waitEvent(target, event) {
    return new Promise((resolve) => {
      target.addEventListener(event, resolve, { once: true });
    });
  }

  async function crapify() {
    if (!file || running) return;
    if (!window.MediaRecorder) {
      setStatus("This browser cannot record video (MediaRecorder missing).");
      return;
    }

    const mimeType = pickMimeType();
    if (!mimeType) {
      setStatus("No supported WebM recorder in this browser. Try Chrome or Firefox.");
      return;
    }

    running = true;
    stopRequested = false;
    goBtn.disabled = true;
    stopBtn.hidden = false;
    result.hidden = true;
    previewWrap.hidden = false;
    setStatus("Loading video…");

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    let video;
    try {
      video = await loadVideo(objectUrl);
    } catch (err) {
      setStatus(err.message);
      cleanupRun();
      return;
    }
    activeVideo = video;

    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 360;
    const scale = Math.min(1, MAX_WIDTH / srcW);
    preview.width = Math.max(2, Math.round(srcW * scale));
    preview.height = Math.max(2, Math.round(srcH * scale));

    const ctx = preview.getContext("2d", { alpha: false });
    const small = document.createElement("canvas");
    const sctx = small.getContext("2d", { alpha: false });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    activeAudioCtx = audioCtx;
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    // Route element audio through boost + hard clip into the recording stream.
    const source = audioCtx.createMediaElementSource(video);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(boost.value);

    const shaper = audioCtx.createWaveShaper();
    shaper.curve = makeClipCurve(Number(clip.value));
    shaper.oversample = "4x";

    const streamDest = audioCtx.createMediaStreamDestination();
    source.connect(gainNode);
    gainNode.connect(shaper);
    shaper.connect(streamDest);
    shaper.connect(audioCtx.destination);

    video.muted = false;
    video.volume = 1;

    const canvasStream = preview.captureStream(FPS);
    const tracks = [
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks(),
    ];
    const combined = new MediaStream(tracks);

    const chunks = [];
    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 800_000,
      audioBitsPerSecond: 96_000,
    });
    activeRecorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });

    // Draw only at 10 fps while the source plays in real time.
    let lastDraw = 0;
    let raf = 0;
    const block = Number(pixelSize.value);

    function tick(now) {
      if (stopRequested) return;
      if (now - lastDraw >= FRAME_MS - 1) {
        if (video.readyState >= 2) {
          drawPixelated(video, ctx, small, sctx, block);
        }
        lastDraw = now;
        const t = video.currentTime;
        const d = video.duration || 0;
        const pct = d ? Math.min(100, Math.round((t / d) * 100)) : 0;
        setStatus(`Crapifying… ${pct}% · 10 fps · pixel ${block}`);
      }
      if (!video.ended && !video.paused) {
        raf = requestAnimationFrame(tick);
      }
    }

    try {
      recorder.start(250);
      await video.play();
      raf = requestAnimationFrame(tick);
      await waitEvent(video, "ended");
    } catch (err) {
      setStatus(err.message || "Playback failed.");
      stopRequested = true;
    }

    cancelAnimationFrame(raf);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    await stopped;

    tracks.forEach((t) => t.stop());
    video.pause();
    source.disconnect();
    gainNode.disconnect();
    shaper.disconnect();
    await audioCtx.close().catch(() => {});

    if (chunks.length === 0) {
      setStatus(stopRequested ? "Stopped." : "Nothing was recorded.");
      cleanupRun();
      return;
    }

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    const outUrl = URL.createObjectURL(blob);
    outVideo.src = outUrl;
    downloadBtn.href = outUrl;
    downloadBtn.download = `${stripExt(file.name)}-crapified.webm`;
    result.hidden = false;
    setStatus(
      stopRequested
        ? `Stopped early · ${(blob.size / 1024 / 1024).toFixed(2)} MB`
        : `Done · ${(blob.size / 1024 / 1024).toFixed(2)} MB · 10 fps mush`
    );
    cleanupRun();
  }

  function stripExt(name) {
    return name.replace(/\.[^.]+$/, "") || "video";
  }

  function cleanupRun() {
    running = false;
    activeRecorder = null;
    activeAudioCtx = null;
    activeVideo = null;
    goBtn.disabled = false;
    stopBtn.hidden = true;
  }

  function stopCrapify() {
    if (!running) return;
    stopRequested = true;
    setStatus("Stopping…");
    if (activeVideo) {
      try {
        activeVideo.pause();
        activeVideo.dispatchEvent(new Event("ended"));
      } catch (_) {
        /* ignore */
      }
    }
    if (activeRecorder && activeRecorder.state !== "inactive") {
      try {
        activeRecorder.stop();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function onFile(next) {
    if (!next || !next.type.startsWith("video/")) {
      setStatus("Please choose a video file.");
      return;
    }
    file = next;
    dropTitle.textContent = next.name;
    dropSub.textContent = `${(next.size / 1024 / 1024).toFixed(2)} MB ready to ruin`;
    controls.hidden = false;
    result.hidden = true;
    previewWrap.hidden = true;
    setStatus("Ready.");
  }

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) onFile(f);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
    });
  });
  dropZone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });

  goBtn.addEventListener("click", () => {
    crapify().catch((err) => {
      console.error(err);
      setStatus(err.message || "Crapify failed.");
      cleanupRun();
    });
  });
  stopBtn.addEventListener("click", stopCrapify);
})();
