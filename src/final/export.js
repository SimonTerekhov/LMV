import { canvas, audioEl, gui } from "./webgpu.js";

const downloadURL = (url, filename) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
};

const downloadBlob = (blob, filename) => {
  downloadURL(URL.createObjectURL(blob), filename);
};

const savePNG = () => {
  canvas.toBlob((blob) => {
    downloadBlob(blob, `frame_${Date.now()}.png`);
  }, "image/png");
};

const getAudioStreamForRecording = async (mediaEl) => {
  if (!mediaEl) return new MediaStream();

  const ac = new AudioContext();
  await ac.resume();

  const src  = ac.createMediaElementSource(mediaEl);
  const dest = ac.createMediaStreamDestination();

  src.connect(ac.destination);
  src.connect(dest);

  return dest.stream;
};

const recordClip = async (
  startAtSec = 0,
  { fps = 60, durationSec = 10, videoMbps = 40, audioKbps = 320 } = {}
) => {
  const canvasStream = canvas.captureStream(fps);
  const audioStream  = await getAudioStreamForRecording(audioEl);

  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);

  const prefer = "video/webm;codecs=vp9,opus";
  const mime = MediaRecorder.isTypeSupported(prefer) ? prefer : "video/webm";

  const rec = new MediaRecorder(mixed, {
    mimeType: mime,
    videoBitsPerSecond: Math.round(videoMbps * 1_000_000),
    audioBitsPerSecond: Math.round(audioKbps * 1000),
  });

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const hadAudio   = !!audioEl;
  const wasPlaying = hadAudio && !audioEl.paused && !audioEl.ended;
  const prevTime   = hadAudio ? audioEl.currentTime : 0;

  if (hadAudio) {
    audioEl.currentTime = Math.max(0, startAtSec);
    await audioEl.play();
  }

  const done = new Promise((res) => (rec.onstop = res));
  rec.start();

  setTimeout(() => rec.stop(), durationSec * 1000);
  await done;

  downloadBlob(new Blob(chunks, { type: mime }), `LMV.webm`);

  if (hadAudio && !wasPlaying) {
    await audioEl.pause();
    audioEl.currentTime = prevTime;
  }
};

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