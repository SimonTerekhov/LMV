import Meyda from "meyda";
import loadAubioModule from "aubiojs";

export const AudioData = {latestFeatures: null, lastBeatTime: 0, isOnset: 0};

const fileInput = document.querySelector("#fileInput");
const audioElement = document.querySelector("#audio");

let audioContext;
let sourceNode;
let analyzer;
let meyda;
let aubioOnset;

let lastBeatTime = 0;
let latestFeatures = null;
let isOnset = 0;
let beatRAF = null;


const featuresToExtract = ["rms", "mfcc", "spectralCentroid", "amplitudeSpectrum"];

export const initAudio = () => {

  if (!fileInput || !audioElement) {
    throw new Error("Expected #fileInput and #audio elements in the DOM.");
  }
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    audioElement.src = url;
    await audioElement.play();

    setupAudioContext();
  });

  document.querySelector("#audio").addEventListener("seeked", () => {
    AudioData.lastBeatTime = 0;
  });
}


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
      AudioData.latestFeatures = features;
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
    const isOnset = aubioOnset.do(buffer);
    AudioData.isOnset = isOnset;

    const MIN_BEAT_INTERVAL = 0.25; 
    if (isOnset && latestFeatures?.rms > 0.25 && audioElement.currentTime - lastBeatTime > MIN_BEAT_INTERVAL) {
      const now = audioElement.currentTime;
      lastBeatTime = now;
      AudioData.lastBeatTime = now;
    }
    beatRAF = requestAnimationFrame(process);
  };

  process();
};
