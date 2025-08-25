import { canvas, audioEl, gui } from "./webgpu.js";

const downloadURL = (url, filename) => {
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
const downloadBlob = (blob, filename) => {
  downloadURL(URL.createObjectURL(blob), filename);
}

const savePNG = () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `frame_${Date.now()}.png`);
  }, "image/png");
}

const getAudioStreamForRecording = async (audioEl) => {
  if (!audioEl) return new MediaStream();
  if (audioEl.captureStream) return audioEl.captureStream();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ac = new AudioCtx();
  if (ac.state === "suspended") { try { await ac.resume(); } catch {} }
  const src  = ac.createMediaElementSource(audioEl);
  const dest = ac.createMediaStreamDestination();
  src.connect(ac.destination);
  src.connect(dest);
  return dest.stream;
}

const recordClip = async (startAtSec, {
  fps = 60,
  durationSec = 10,
  videoMbps = 40,
  audioKbps = 320,
} = {}) => {
  const durationMs = durationSec * 1000;

  const canvasStream = canvas.captureStream(fps);
  const audioStream  = await getAudioStreamForRecording(audioEl);

  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);

  const tryTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mime = tryTypes.find(t => MediaRecorder.isTypeSupported(t)) || "";

  const rec = new MediaRecorder(mixed, {
    mimeType: mime,
    videoBitsPerSecond: Math.round(videoMbps * 1_000_000),
    audioBitsPerSecond: Math.round(audioKbps * 1000),
  });

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(res => (rec.onstop = res));

  const hadAudio = !!audioEl;
  const wasPlaying = hadAudio && !audioEl.paused && !audioEl.ended;
  const prevTime   = hadAudio ? audioEl.currentTime : 0;

  if (hadAudio) {
    if (Number.isFinite(startAtSec)) audioEl.currentTime = Math.max(0, startAtSec);
    await audioEl.play();
  }

  rec.start();
  const timer = setTimeout(() => { try { rec.stop(); } catch {} }, durationMs);
  await done;
  clearTimeout(timer);

  const blob = new Blob(chunks, { type: mime || "video/webm" });

  downloadBlob(blob, `LMV.webm`);

  if (hadAudio && !wasPlaying) {
    await audioEl.pause();
    audioEl.currentTime = prevTime;
  }
}

const exportControls = {
  "Save PNG": () => savePNG(),
  duration: 10,

  "Record 10s @ Current Time": async () => {
    const start = audioEl?.currentTime || 0;
    await recordClip(start, {
      fps: 60,
      durationSec: exportControls.duration,
      videoMbps: 40,
      audioKbps: 320,
    });
  },
};

const fExport = gui.addFolder("Export");
fExport.add(exportControls, "duration", 10, 60, 1).name("Duration (s)");
fExport.add(exportControls, "Save PNG");
fExport.add(exportControls, "Record 10s @ Current Time");