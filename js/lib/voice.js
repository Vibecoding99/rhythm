// Push-to-talk speech transcription via the Web Speech API. The mic is off
// until explicitly started by a tap — no always-on/wake-word listening, per
// spec. This module only transcribes; it hands back plain text and knows
// nothing about parsing or saving, so voice and text stay two front doors
// onto exactly the same downstream pipeline (parse.js -> capture.js).

const SpeechRecognitionCtor = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function isVoiceSupported() {
  return !!SpeechRecognitionCtor;
}

// onInterim(text) fires repeatedly while listening (show it live, greyed).
// onFinal(text) fires once, with the completed transcript, when speech ends
// with something recognized.
// onError(reason) fires instead of onFinal on failure — reason is one of
// 'not-allowed' | 'no-speech' | 'other'.
// onEnd() always fires last, success or failure, for UI cleanup (un-pulse
// the mic button, etc).
// Returns a stop() function for tap-to-stop; recognition also auto-stops on
// its own natural silence-detection if never called.
export function startListening({ onInterim, onFinal, onError, onEnd } = {}) {
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  let finalTranscript = "";
  let errorReported = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += transcript;
      else interim += transcript;
    }
    if (interim) onInterim && onInterim(interim);
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") return; // caller-initiated stop, not a real failure
    errorReported = true;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") onError && onError("not-allowed");
    else if (event.error === "no-speech") onError && onError("no-speech");
    else onError && onError("other");
  };

  recognition.onend = () => {
    if (!errorReported) {
      if (finalTranscript.trim()) onFinal && onFinal(finalTranscript.trim());
      else onError && onError("no-speech");
    }
    onEnd && onEnd();
  };

  recognition.start();

  return () => recognition.stop();
}
