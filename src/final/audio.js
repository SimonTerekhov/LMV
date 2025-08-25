import Meyda from "meyda";
import loadAubioModule from "aubiojs";

export const AudioData = {
  latestFeatures: null,
  lastBeatTime: 0,
  isOnset: 0,
  waveform: null,

  rmsZ: 0,
  bpm: 60,
  energy: 0,
  lowBand: 0,
};

const fileInput = document.querySelector("#fileInput");
const audioElement = document.querySelector("#audio");

let audioContext;
let sourceNode;
let analyzer;
let meyda;
let aubioOnset;

let lastBeatTime = 0;
let latestFeatures = null;
let beatRAF = null;

const ema = (prev, x, a) => (1 - a) * prev + a * x;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const zscore = (x, m, s) => (s > 1e-6 ? (x - m) / s : 0);
const median = (arr) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
};
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const lerp = (a, b, t) => a + (b - a) * t;

const TrackProfile = { rmsEMA: 0, rmsEMASq: 0, rmsMean: 0, rmsStd: 0 };

let rmsFast = 0, rmsSlow = 0, slowSq = 0;

let onsetTimes = [];

let warmupFrames = 0;
const WARMUP_FRAMES = 360;

export const initAudio = () => {
  if (!fileInput || !audioElement) throw new Error("Expected #fileInput and #audio elements in the DOM.");

  fileInput.addEventListener("change", async (event) => {
    if (beatRAF) cancelAnimationFrame(beatRAF);
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    audioElement.src = url;
    await audioElement.play();

    if (!audioContext) audioContext = new AudioContext();
    window.addEventListener("click", () => {
      if (audioContext.state === "suspended") audioContext.resume();
    });

    lastBeatTime = 0;
    onsetTimes = [];
    warmupFrames = 0;
    Object.assign(TrackProfile, { rmsEMA:0, rmsEMASq:0, rmsMean:0, rmsStd:0 });
    Object.assign(AudioData, { lastBeatTime:0, bpm:120, rmsZ:0, energy:0 });

    setupAudioContext();
  });

  audioElement.addEventListener("seeked", () => {
    AudioData.lastBeatTime = 0;
    lastBeatTime = 0;
    onsetTimes = [];
    warmupFrames = 0;
  });
};

const setupAudioContext = async () => {
  if (meyda) meyda.stop();

    if (!sourceNode) {
    sourceNode = audioContext.createMediaElementSource(audioElement);
  } else {
    try { sourceNode.disconnect(); } catch {}
  }
  analyzer = audioContext.createAnalyser();
  analyzer.fftSize = 512;

  sourceNode.connect(analyzer);
  analyzer.connect(audioContext.destination);

  meyda = Meyda.createMeydaAnalyzer({
    audioContext,
    source: sourceNode,
    bufferSize: 512,
    featureExtractors: ["rms", "mfcc", "spectralCentroid", "amplitudeSpectrum"],
    callback: (features) => {
      latestFeatures = features;
      AudioData.latestFeatures = features;
      warmupFrames++;

      const rms = features.rms || 0;
      TrackProfile.rmsEMA   = ema(TrackProfile.rmsEMA,   rms, 0.02);
      TrackProfile.rmsEMASq = ema(TrackProfile.rmsEMASq, rms * rms, 0.02);
      TrackProfile.rmsMean  = TrackProfile.rmsEMA;
      TrackProfile.rmsStd   = Math.sqrt(Math.max(1e-8, TrackProfile.rmsEMASq - TrackProfile.rmsEMA ** 2));
      AudioData.rmsZ        = zscore(rms, TrackProfile.rmsMean, TrackProfile.rmsStd);

      rmsFast = ema(rmsFast, rms, 0.2);
      rmsSlow = ema(rmsSlow, rms, 0.02);
      slowSq  = ema(slowSq, rms * rms, 0.02);
      const slowStd = Math.sqrt(Math.max(1e-8, slowSq - rmsSlow * rmsSlow));
      const contrastZ = slowStd > 1e-6 ? (rmsFast - rmsSlow) / slowStd : 0;
      AudioData.energy = sigmoid(contrastZ * 3);

      const sc = features.spectralCentroid || 0;
      const normTone = clamp((Math.log2(Math.max(80, sc)) - Math.log2(80)) / (Math.log2(8000) - Math.log2(80)), 0, 1);
      AudioData.tone = normTone;
          
      const spec = features.amplitudeSpectrum || [];
      let lows = 0;
      for (let i = 0; i < Math.min(8, spec.length); i++) lows += spec[i];
      AudioData.lowBand = lows / (8 || 1);

    },
  });

  meyda.start();

  const aubio = await loadAubioModule();
  aubioOnset = new aubio.Onset("default", 512, 256, audioContext.sampleRate);

  detectBeats();
};

const detectBeats = () => {
  if (beatRAF) cancelAnimationFrame(beatRAF);

  const buffer = new Float32Array(512);

  const process = () => {
    analyzer.getFloatTimeDomainData(buffer);

    if (!AudioData.waveform) AudioData.waveform = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const v = buffer[i * 2];
      AudioData.waveform[i] = v * 0.5 + 0.5;
    }

    const isOnset = aubioOnset.do(buffer);
    AudioData.isOnset = isOnset;
    const now = audioElement.currentTime;

    if (isOnset) {
      onsetTimes.push(now);
      if (onsetTimes.length > 60) onsetTimes.shift();
    }

    if (onsetTimes.length >= 5) {
      const iois = [];
      for (let i = 1; i < onsetTimes.length; i++) iois.push(onsetTimes[i] - onsetTimes[i - 1]);
      const T = median(iois) || (60 / 120);
      const bpmInstant = clamp(60 / Math.max(1e-3, T), 60, 200);
      AudioData.bpm = lerp(AudioData.bpm, bpmInstant, 0.05);
    }

    const minBeatInterval = 0.5 * (60 / (AudioData.bpm || 120));

    const warmedUp = warmupFrames > WARMUP_FRAMES;
    const loudEnough = warmedUp && (AudioData.rmsZ || 0) > 0.3;

    if (isOnset && loudEnough && now - lastBeatTime > minBeatInterval) {
      lastBeatTime = now;
      AudioData.lastBeatTime = now;
    }

    beatRAF = requestAnimationFrame(process);
  };

  process();
};