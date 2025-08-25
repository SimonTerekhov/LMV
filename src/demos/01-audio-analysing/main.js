import Meyda from "meyda";
import loadAubioModule from "aubiojs";

const fileInput = document.getElementById("fileInput");
const audioElement = document.getElementById("audio");
const output = document.getElementById("output");

let audioContext;
let sourceNode;
let analyzer;
let meyda;
let aubioOnset;

let lastBeatTime = 0;
let latestFeatures = null;

const featuresToExtract = ["rms", "mfcc", "spectralCentroid", "amplitudeSpectrum"];

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  audioElement.src = url;
  await audioElement.play();

  setupAudioContext();
});

const setupAudioContext = async () => {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (meyda) meyda.stop();

  sourceNode = audioContext.createMediaElementSource(audioElement);
  analyzer = audioContext.createAnalyser();
  analyzer.fftSize = 512;

  sourceNode.connect(analyzer);
  analyzer.connect(audioContext.destination);

  meyda = Meyda.createMeydaAnalyzer({
    audioContext,
    source: sourceNode,
    bufferSize: 512,
    featureExtractors: featuresToExtract,
    callback: (features) => {
      latestFeatures = features;
      formatAndDisplayFeatures(features);
    },
  });

  meyda.start();

  const aubio = await loadAubioModule();
  aubioOnset = new aubio.Onset("default", 512, 256, audioContext.sampleRate);

  detectBeats();
};

const detectBeats = () => {
  const buffer = new Float32Array(512);

  const process = () => {
    analyzer.getFloatTimeDomainData(buffer);
    const isOnset = aubioOnset.do(buffer);
    if (isOnset && latestFeatures?.rms > 0.25) {
      const now = audioElement.currentTime;
      lastBeatTime = now;
    }
    requestAnimationFrame(process);
  };

  process();
};

const formatAndDisplayFeatures = (features) => {
  console.log("Latest Features:", features);
  const mfcc = features.mfcc
    .map((val, i) => `  ${i}: ${val.toFixed(2)}`)
    .join("\n");

  const amp = features.amplitudeSpectrum
    .slice(0, 10)
    .map((val) => val.toFixed(2))
    .join(", ");

  output.textContent = `
RMS:               ${features.rms.toFixed(4)}
Spectral Centroid: ${features.spectralCentroid.toFixed(2)}
Last Beat:         ${lastBeatTime.toFixed(2)}s
MFCC:
${mfcc}

Amplitude Spectrum (first 10 bins):
${amp}
  `.trim();
};

document.getElementById("audio").addEventListener("seeked", () => {
  console.log("Audio element changed, resetting state.");
  lastBeatTime = 0;
})

const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let flashAlpha = 0;

const render = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  if (audioElement.currentTime - lastBeatTime < 0.1) flashAlpha = 1;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    flashAlpha *= 0.9;
  }

  if (latestFeatures) {
    const rms = latestFeatures.rms;
    const spectralCentroid = latestFeatures.spectralCentroid;
    const mfcc = latestFeatures.mfcc || [];
    const amplitudeSpectrum = latestFeatures.amplitudeSpectrum || [];

    const baseRadius = 50 + rms * 300;

    const maxCentroid = 1000;
    const hue = Math.min((spectralCentroid / maxCentroid) * 360, 360);

    ctx.beginPath();
    const spikes = mfcc.length;
    for (let i = 1; i < spikes; i++) {
      const angle = (i / spikes) * 2 * Math.PI;
      const deform = mfcc[i];
      const radius = baseRadius + deform;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
    ctx.fill();

    const bars = 60;
    const barMaxLength = 100;
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * 2 * Math.PI;
      const amp = amplitudeSpectrum[i] || 0;
      const barLength = amp * barMaxLength;

      const x1 = centerX + Math.cos(angle) * (baseRadius + 20);
      const y1 = centerY + Math.sin(angle) * (baseRadius + 20);
      const x2 = centerX + Math.cos(angle) * (baseRadius + 20 + barLength);
      const y2 = centerY + Math.sin(angle) * (baseRadius + 20 + barLength);

      ctx.strokeStyle = `hsl(${hue}, 100%, 70%)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  requestAnimationFrame(render);
};

render();
