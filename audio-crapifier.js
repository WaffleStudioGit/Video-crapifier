(() => {
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const dropTitle = document.getElementById("dropTitle");
  const dropSub = document.getElementById("dropSub");
  const controls = document.getElementById("controls");
  const rate = document.getElementById("rate");
  const boost = document.getElementById("boost");
  const clip = document.getElementById("clip");
  const bits = document.getElementById("bits");
  const rateVal = document.getElementById("rateVal");
  const boostVal = document.getElementById("boostVal");
  const clipVal = document.getElementById("clipVal");
  const bitsVal = document.getElementById("bitsVal");
  const goBtn = document.getElementById("goBtn");
  const previewWrap = document.getElementById("previewWrap");
  const wave = document.getElementById("wave");
  const statusEl = document.getElementById("status");
  const result = document.getElementById("result");
  const outAudio = document.getElementById("outAudio");
  const downloadBtn = document.getElementById("downloadBtn");

  let file = null;
  let outUrl = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function syncLabels() {
    rateVal.textContent = `${rate.value} Hz`;
    boostVal.textContent = `${boost.value}×`;
    clipVal.textContent = `${clip.value}%`;
    bitsVal.textContent = `${bits.value}-bit`;
  }

  rate.addEventListener("input", syncLabels);
  boost.addEventListener("input", syncLabels);
  clip.addEventListener("input", syncLabels);
  bits.addEventListener("input", syncLabels);
  syncLabels();

  function hardClipSample(x, hardnessPct) {
    const drive = 1 + (hardnessPct / 100) * 24;
    const ceiling = 0.98;
    let y = Math.tanh(x * drive);
    if (y > ceiling) y = ceiling;
    if (y < -ceiling) y = -ceiling;
    if (Math.abs(x * drive) > 1.2) y = Math.sign(y) * ceiling;
    return y;
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

  /** Naive decimate / hold resample to a lower rate. */
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
    const numSamples = samples.length;
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const dataSize = numSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, (s * 0x7fff) | 0, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function drawWave(samples) {
    const ctx = wave.getContext("2d");
    const w = wave.width;
    const h = wave.height;
    ctx.fillStyle = "#2c2114";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#ff3d6e";
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
    // clipped rails
    ctx.strokeStyle = "rgba(232, 242, 90, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, mid - h * 0.42);
    ctx.lineTo(w, mid - h * 0.42);
    ctx.moveTo(0, mid + h * 0.42);
    ctx.lineTo(w, mid + h * 0.42);
    ctx.stroke();
  }

  function stripExt(name) {
    return name.replace(/\.[^.]+$/, "") || "audio";
  }

  async function crapify() {
    if (!file) return;
    goBtn.disabled = true;
    result.hidden = true;
    previewWrap.hidden = false;
    setStatus("Decoding…");

    try {
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      let decoded;
      try {
        decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      } catch (_) {
        throw new Error("Could not decode that file as audio.");
      }

      setStatus("Crushing…");
      await new Promise((r) => requestAnimationFrame(r));

      const boostAmt = Number(boost.value);
      const hardness = Number(clip.value);
      const targetRate = Number(rate.value);
      const bitDepth = Number(bits.value);

      let mono = mixToMono(decoded);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = hardClipSample(mono[i] * boostAmt, hardness);
      }

      const resampled = resample(mono, decoded.sampleRate, targetRate);
      const crushed = bitCrush(resampled.samples, bitDepth);

      // Second pass clip after crush so edges stay ugly
      for (let i = 0; i < crushed.length; i++) {
        crushed[i] = hardClipSample(crushed[i] * Math.max(1, boostAmt * 0.35), hardness);
      }

      drawWave(crushed);
      const blob = encodeWavMono(crushed, resampled.rate);
      if (outUrl) URL.revokeObjectURL(outUrl);
      outUrl = URL.createObjectURL(blob);
      outAudio.src = outUrl;
      downloadBtn.href = outUrl;
      downloadBtn.download = `${stripExt(file.name)}-crapified.wav`;
      result.hidden = false;
      setStatus(
        `Done · ${(blob.size / 1024).toFixed(1)} KB · ${resampled.rate} Hz · ${bitDepth}-bit mush`
      );
      await audioCtx.close().catch(() => {});
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Crapify failed.");
    } finally {
      goBtn.disabled = false;
    }
  }

  function onFile(next) {
    if (!next) return;
    const ok =
      next.type.startsWith("audio/") ||
      next.type.startsWith("video/") ||
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|mp4|mov)$/i.test(next.name);
    if (!ok) {
      setStatus("Please choose an audio (or video) file.");
      previewWrap.hidden = false;
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
    crapify();
  });
})();
