(() => {
  const FPS = 10;
  const FRAME_MS = 1000 / FPS;
  const MAX_WIDTH = 640;

  const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;
  const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

  const els = {
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    dropTitle: document.getElementById("dropTitle"),
    dropSub: document.getElementById("dropSub"),
    controls: document.getElementById("controls"),
    videoFields: document.getElementById("videoFields"),
    audioFields: document.getElementById("audioFields"),
    pixelSize: document.getElementById("pixelSize"),
    rate: document.getElementById("rate"),
    bits: document.getElementById("bits"),
    boost: document.getElementById("boost"),
    clip: document.getElementById("clip"),
    pixelVal: document.getElementById("pixelVal"),
    rateVal: document.getElementById("rateVal"),
    bitsVal: document.getElementById("bitsVal"),
    boostVal: document.getElementById("boostVal"),
    clipVal: document.getElementById("clipVal"),
    paramMeta: document.getElementById("paramMeta"),
    hint: document.getElementById("hint"),
    goBtn: document.getElementById("goBtn"),
    stopBtn: document.getElementById("stopBtn"),
    previewWrap: document.getElementById("previewWrap"),
    preview: document.getElementById("preview"),
    wave: document.getElementById("wave"),
    status: document.getElementById("status"),
    result: document.getElementById("result"),
    resultMeta: document.getElementById("resultMeta"),
    outVideo: document.getElementById("outVideo"),
    outAudio: document.getElementById("outAudio"),
    downloadBtn: document.getElementById("downloadBtn"),
    modeBadge: document.getElementById("modeBadge"),
    modeDot: document.getElementById("modeDot"),
  };

  let file = null;
  let mediaKind = null; // "audio" | "video"
  let objectUrl = null;
  let outUrl = null;
  let running = false;
  let stopRequested = false;
  let activeRecorder = null;
  let activeVideo = null;

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setModeUI(mode, label) {
    els.modeDot.dataset.mode = mode;
    els.modeBadge.dataset.mode = mode === "busy" ? mediaKind || "idle" : mode;
    els.modeBadge.textContent = label;
  }

  function syncLabels() {
    els.pixelVal.textContent = els.pixelSize.value;
    els.rateVal.textContent = `${els.rate.value} Hz`;
    els.bitsVal.textContent = `${els.bits.value}-bit`;
    els.boostVal.textContent = `${els.boost.value}×`;
    els.clipVal.textContent = `${els.clip.value}%`;
  }

  ["pixelSize", "rate", "bits", "boost", "clip"].forEach((id) => {
    els[id].addEventListener("input", syncLabels);
  });
  syncLabels();

  function detectKind(f) {
    const type = (f.type || "").toLowerCase();
    const name = f.name || "";
    if (type.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
    if (type.startsWith("audio/") || AUDIO_EXT.test(name)) return "audio";
    // Ambiguous containers (e.g. empty type) — prefer video for .webm/.mp4 already covered
    if (/\.(webm|mp4)$/i.test(name)) return "video";
    return null;
  }

  function applyKindUI(kind) {
    mediaKind = kind;
    els.videoFields.hidden = kind !== "video";
    els.audioFields.hidden = kind !== "audio";
    if (kind === "video") {
      setModeUI("video", "video detected");
      els.paramMeta.textContent = "video path · 10 fps";
      els.hint.textContent = "Pixelate + crush soundtrack. Output: WebM.";
    } else if (kind === "audio") {
      setModeUI("audio", "audio detected");
      els.paramMeta.textContent = "audio path · offline";
      els.hint.textContent = "Rate crush + boost/clip. Output: WAV.";
    } else {
      setModeUI("idle", "awaiting file");
      els.paramMeta.textContent = "shared";
    }
  }

  function stripExt(name) {
    return name.replace(/\.[^.]+$/, "") || "media";
  }

  function hardClipSample(x, hardnessPct) {
    const drive = 1 + (hardnessPct / 100) * 24;
    const ceiling = 0.98;
    let y = Math.tanh(x * drive);
    if (y > ceiling) y = ceiling;
    if (y < -ceiling) y = -ceiling;
    if (Math.abs(x * drive) > 1.2) y = Math.sign(y) * ceiling;
    return y;
  }

  function makeClipCurve(hardnessPct) {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = hardClipSample(x, hardnessPct);
    }
    return curve;
  }

  function pickMimeType() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const type of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
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

  function drawPixelated(video, ctx, small, sctx, block) {
    const w = els.preview.width;
    const h = els.preview.height;
    const sw = Math.max(1, Math.floor(w / block));
    const sh = Math.max(1, Math.floor(h / block));
    if (small.width !== sw || small.height !== sh) {
      small.width = sw;
      small.height = sh;
    }
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(video, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1d2021";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  }

  function mixToMono(buffer) {
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const out = new Float32Array(len);
    if (ch === 1) {
      out.set(buffer.getChannelData(0));
      return out;
    }
    for (let c = 0; c < ch; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += data[i] / ch;
    }
    return out;
  }

  function resample(samples, srcRate, dstRate) {
    if (dstRate >= srcRate) return { samples, rate: srcRate };
    const ratio = srcRate / dstRate;
    const outLen = Math.max(1, Math.floor(samples.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      out[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))];
    }
    return { samples: out, rate: dstRate };
  }

  function bitCrush(samples, bitDepth) {
    const levels = Math.pow(2, bitDepth - 1);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = Math.round(samples[i] * levels) / levels;
    }
    return out;
  }

  function encodeWavMono(samples, sampleRate) {
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, (s * 0x7fff) | 0, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function drawWave(samples) {
    const ctx = els.wave.getContext("2d");
    const w = els.wave.width;
    const h = els.wave.height;
    ctx.fillStyle = "#1d2021";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#fe8019";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const mid = h / 2;
    const step = Math.max(1, Math.floor(samples.length / w));
    for (let x = 0; x < w; x++) {
      const i = Math.min(samples.length - 1, x * step);
      const y = mid - samples[i] * (h * 0.42);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(250, 189, 47, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, mid - h * 0.42);
    ctx.lineTo(w, mid - h * 0.42);
    ctx.moveTo(0, mid + h * 0.42);
    ctx.lineTo(w, mid + h * 0.42);
    ctx.stroke();
  }

  function showResultMedia(kind) {
    els.outVideo.hidden = kind !== "video";
    els.outAudio.hidden = kind !== "audio";
    els.preview.hidden = kind !== "video";
    els.wave.hidden = kind !== "audio";
  }

  function cleanupRun() {
    running = false;
    activeRecorder = null;
    activeVideo = null;
    els.goBtn.disabled = false;
    els.stopBtn.hidden = true;
    if (mediaKind) applyKindUI(mediaKind);
  }

  async function crapifyVideo() {
    if (!window.MediaRecorder) throw new Error("MediaRecorder missing in this browser.");
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("No WebM recorder support. Try Chrome or Firefox.");

    stopRequested = false;
    els.stopBtn.hidden = false;
    setStatus("loading video…");

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const video = await loadVideo(objectUrl);
    activeVideo = video;

    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 360;
    const scale = Math.min(1, MAX_WIDTH / srcW);
    els.preview.width = Math.max(2, Math.round(srcW * scale));
    els.preview.height = Math.max(2, Math.round(srcH * scale));
    showResultMedia("video");

    const ctx = els.preview.getContext("2d", { alpha: false });
    const small = document.createElement("canvas");
    const sctx = small.getContext("2d", { alpha: false });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const source = audioCtx.createMediaElementSource(video);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(els.boost.value);
    const shaper = audioCtx.createWaveShaper();
    shaper.curve = makeClipCurve(Number(els.clip.value));
    shaper.oversample = "4x";
    const streamDest = audioCtx.createMediaStreamDestination();
    source.connect(gainNode);
    gainNode.connect(shaper);
    shaper.connect(streamDest);
    shaper.connect(audioCtx.destination);

    video.muted = false;
    video.volume = 1;

    const canvasStream = els.preview.captureStream(FPS);
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

    let lastDraw = 0;
    let raf = 0;
    const block = Number(els.pixelSize.value);

    function tick(now) {
      if (stopRequested) return;
      if (now - lastDraw >= FRAME_MS - 1) {
        if (video.readyState >= 2) drawPixelated(video, ctx, small, sctx, block);
        lastDraw = now;
        const t = video.currentTime;
        const d = video.duration || 0;
        const pct = d ? Math.min(100, Math.round((t / d) * 100)) : 0;
        setStatus(`crapifying… ${pct}% · 10 fps · pixel ${block}`);
      }
      if (!video.ended && !video.paused) raf = requestAnimationFrame(tick);
    }

    try {
      recorder.start(250);
      await video.play();
      raf = requestAnimationFrame(tick);
      await waitEvent(video, "ended");
    } catch (err) {
      stopRequested = true;
      throw err;
    }

    cancelAnimationFrame(raf);
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    tracks.forEach((t) => t.stop());
    video.pause();
    source.disconnect();
    gainNode.disconnect();
    shaper.disconnect();
    await audioCtx.close().catch(() => {});

    if (!chunks.length) {
      setStatus(stopRequested ? "stopped." : "nothing recorded.");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = URL.createObjectURL(blob);
    els.outVideo.src = outUrl;
    els.downloadBtn.href = outUrl;
    els.downloadBtn.download = `${stripExt(file.name)}-crapified.webm`;
    els.result.hidden = false;
    els.resultMeta.textContent = "webm";
    setStatus(
      stopRequested
        ? `stopped · ${(blob.size / 1024 / 1024).toFixed(2)} MB`
        : `done · ${(blob.size / 1024 / 1024).toFixed(2)} MB · 10 fps mush`
    );
  }

  async function crapifyAudio() {
    setStatus("decoding…");
    showResultMedia("audio");
    const arrayBuf = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    } catch (_) {
      throw new Error("Could not decode that file as audio.");
    }

    setStatus("crushing…");
    await new Promise((r) => requestAnimationFrame(r));

    const boostAmt = Number(els.boost.value);
    const hardness = Number(els.clip.value);
    const targetRate = Number(els.rate.value);
    const bitDepth = Number(els.bits.value);

    const mono = mixToMono(decoded);
    for (let i = 0; i < mono.length; i++) {
      mono[i] = hardClipSample(mono[i] * boostAmt, hardness);
    }
    const resampled = resample(mono, decoded.sampleRate, targetRate);
    const crushed = bitCrush(resampled.samples, bitDepth);
    for (let i = 0; i < crushed.length; i++) {
      crushed[i] = hardClipSample(crushed[i] * Math.max(1, boostAmt * 0.35), hardness);
    }

    drawWave(crushed);
    const blob = encodeWavMono(crushed, resampled.rate);
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = URL.createObjectURL(blob);
    els.outAudio.src = outUrl;
    els.downloadBtn.href = outUrl;
    els.downloadBtn.download = `${stripExt(file.name)}-crapified.wav`;
    els.result.hidden = false;
    els.resultMeta.textContent = "wav";
    setStatus(
      `done · ${(blob.size / 1024).toFixed(1)} KB · ${resampled.rate} Hz · ${bitDepth}-bit mush`
    );
    await audioCtx.close().catch(() => {});
  }

  async function crapify() {
    if (!file || !mediaKind || running) return;
    running = true;
    els.goBtn.disabled = true;
    els.result.hidden = true;
    els.previewWrap.hidden = false;
    setModeUI("busy", mediaKind === "video" ? "rendering video" : "rendering audio");

    try {
      if (mediaKind === "video") await crapifyVideo();
      else await crapifyAudio();
    } catch (err) {
      console.error(err);
      setStatus(err.message || "crapify failed.");
    } finally {
      cleanupRun();
    }
  }

  function stopCrapify() {
    if (!running) return;
    stopRequested = true;
    setStatus("stopping…");
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
    if (!next) return;
    const kind = detectKind(next);
    if (!kind) {
      els.previewWrap.hidden = false;
      setStatus("unsupported file — drop audio or video.");
      return;
    }
    file = next;
    applyKindUI(kind);
    els.dropTitle.textContent = next.name;
    els.dropSub.textContent = `${(next.size / 1024 / 1024).toFixed(2)} MB · ${kind} ready`;
    els.controls.hidden = false;
    els.result.hidden = true;
    els.previewWrap.hidden = true;
    setStatus("ready.");
  }

  els.fileInput.addEventListener("change", () => {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (f) onFile(f);
  });

  els.dropZone.addEventListener("click", (e) => {
    if (e.target === els.fileInput) return;
    els.fileInput.click();
  });

  ["dragenter", "dragover"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove("drag");
    });
  });
  els.dropZone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });

  els.goBtn.addEventListener("click", () => crapify());
  els.stopBtn.addEventListener("click", stopCrapify);
})();
