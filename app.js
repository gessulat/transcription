let pc, dc, mediaStream;
let listening = false;
const transcripts = [];
let activeTranscriptId = null;
let currentPartial = "";

const ConnectionState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
};

let connectionState = ConnectionState.DISCONNECTED;
let connectToken = 0;

const el = (id) => document.getElementById(id);
const out = el("out");
const statusEl = el("status");
const toggleBtn = el("toggle");
const logBox = el("log");
const keyInput = el("key");
const debug = el("debug");
const showBtn = el("show");
const showIcon = showBtn.querySelector("i");
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

(() => {
  const saved = localStorage.getItem("OPENAI_API_KEY");
  if (saved) keyInput.value = saved;
})();

updateShowButton(false);
updateToggleButton();
maybeAutoConnect();

showBtn.onclick = () => {
  const willShow = keyInput.type === "password";
  keyInput.type = willShow ? "text" : "password";
  updateShowButton(willShow);
};

debug.onchange = () => {
  logBox.style.display = debug.checked ? "block" : "none";
};

el("save").onclick = () => {
  const trimmed = keyInput.value.trim();
  if (!trimmed) {
    toast("Add your API key first");
    status("Add your API key first");
    return;
  }
  localStorage.setItem("OPENAI_API_KEY", trimmed);
  toast("Key saved");
  connect();
};

el("clear").onclick = () => {
  invalidateConnectionAttempts();
  localStorage.removeItem("OPENAI_API_KEY");
  keyInput.value = "";
  keyInput.type = "password";
  updateShowButton(false);
  toast("Key cleared");
  teardownConnection();
};

toggleBtn.onclick = () => {
  if (connectionState !== ConnectionState.CONNECTED) return;
  if (!listening) startListening();
  else stopListening();
};

function maybeAutoConnect() {
  if (keyInput.value.trim()) {
    connect();
  } else {
    setConnectionState(ConnectionState.DISCONNECTED);
    status("Not connected.");
  }
}

async function connect() {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    status("Add your API key first");
    setConnectionState(ConnectionState.DISCONNECTED);
    return;
  }

  const token = ++connectToken;
  setConnectionState(ConnectionState.CONNECTING);
  status("Requesting microphone…");

  teardownConnection({ keepState: true, preserveStatus: true });

  let localStream;
  let localPc;
  let localDc;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    status("Building WebRTC connection…");
    localPc = new RTCPeerConnection();
    localPc.onconnectionstatechange = () => handlePeerConnectionStateChange(token, localPc);
    localStream.getTracks().forEach((track) => {
      track.enabled = false;
      localPc.addTrack(track, localStream);
    });

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    localDc = localPc.createDataChannel("oai-events");
    localDc.onmessage = onRealtimeEvent;
    localDc.onopen = () => handleDataChannelOpen(token);
    localDc.onclose = () => handleDataChannelClosed(token);

    const offer = await localPc.createOffer();

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    await localPc.setLocalDescription(offer);

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    status("Exchanging SDP…");
    const model = "gpt-4o-realtime-preview";
    const response = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    if (!response.ok) {
      throw new Error(`SDP exchange failed: ${response.status} ${response.statusText}`);
    }

    const answerSdp = await response.text();

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    await localPc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    if (token !== connectToken) {
      cleanupLocalConnection(localStream, localPc, localDc);
      return;
    }

    pc = localPc;
    dc = localDc;
    mediaStream = localStream;
    status("Awaiting data channel…");
  } catch (err) {
    cleanupLocalConnection(localStream, localPc, localDc);
    if (token !== connectToken) {
      return;
    }
    console.error(err);
    status("Error: " + (err?.message || err));
    toast("Failed to connect. See console.");
    setConnectionState(ConnectionState.DISCONNECTED);
  }
}

function handleDataChannelOpen(token) {
  if (token !== connectToken) return;
  status("Connected. Configuring session…");
  setConnectionState(ConnectionState.CONNECTED);
  resetTranscriptState();
  configureSession();
}

function handleDataChannelClosed(token) {
  if (token !== connectToken) return;
  status("Connection closed.");
  teardownConnection();
}

function handlePeerConnectionStateChange(token, peer) {
  if (token !== connectToken) return;
  const state = peer.connectionState;
  if (state === "failed" || state === "disconnected" || state === "closed") {
    status("Connection lost.");
    teardownConnection();
  }
}

function setConnectionState(state) {
  if (state !== ConnectionState.CONNECTED && listening) {
    stopListening({ skipStatusUpdate: true });
  }
  connectionState = state;
  updateToggleButton();
}

function updateToggleButton() {
  toggleBtn.classList.remove("is-connecting", "is-connected", "is-recording");

  if (listening) {
    toggleBtn.classList.add("is-recording");
  } else if (connectionState === ConnectionState.CONNECTING) {
    toggleBtn.classList.add("is-connecting");
  } else if (connectionState === ConnectionState.CONNECTED) {
    toggleBtn.classList.add("is-connected");
  }

  const canToggle = connectionState === ConnectionState.CONNECTED;
  toggleBtn.disabled = !canToggle;

  const label = listening
    ? "Stop recording"
    : connectionState === ConnectionState.CONNECTED
    ? "Start recording"
    : connectionState === ConnectionState.CONNECTING
    ? "Connecting…"
    : "Connect to start";

  toggleBtn.setAttribute("aria-label", label);
  toggleBtn.setAttribute("title", label);
  toggleBtn.setAttribute("aria-pressed", String(listening));
}

function startListening() {
  if (listening || connectionState !== ConnectionState.CONNECTED) return;
  listening = true;
  resetTranscriptState();
  if (mediaStream) {
    mediaStream.getAudioTracks().forEach((track) => (track.enabled = true));
  }
  status("Listening…");
  updateToggleButton();
}

function stopListening({ skipStatusUpdate = false } = {}) {
  if (!listening) return;
  listening = false;
  if (mediaStream) {
    mediaStream.getAudioTracks().forEach((track) => (track.enabled = false));
  }
  if (!skipStatusUpdate) {
    status("Processing… ready again in a moment.");
  }
  updateToggleButton();
}

function configureSession() {
  safeSend({
    type: "session.update",
    session: {
      instructions: "You are a transcription endpoint. Never speak back.",
      input_audio_transcription: { model: TRANSCRIPTION_MODEL },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200,
        create_response: false,
        interrupt_response: false,
      },
    },
  });
}

function onRealtimeEvent(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }

  if (debug.checked) log(JSON.stringify(msg));

  const type = msg?.type || "";

  if (type === "error") {
    status("Error: " + (msg.error?.message || "unknown"));
    return;
  }

  if (type === "response.created" && msg.response?.id) {
    safeSend({ type: "response.cancel", response: { id: msg.response.id } });
    return;
  }

  if (type === "conversation.item.input_audio_transcription.delta" && typeof msg.delta === "string") {
    handleTranscriptDelta(msg.item_id, msg.delta);
  } else if (type === "conversation.item.input_audio_transcription.completed") {
    handleTranscriptComplete(msg.item_id, msg.transcript || msg.text || "");
  } else if (type === "transcript.delta" && typeof msg.delta === "string") {
    handleTranscriptDelta(msg.item_id || "default", msg.delta);
  } else if (type === "transcript.completed" && typeof msg.text === "string") {
    handleTranscriptComplete(msg.item_id || "default", msg.text);
  } else if (type === "session.updated") {
    status("Ready.");
  } else if (type === "response.error") {
    status("Error: " + (msg.error?.message || "unknown"));
  }
}

function handleTranscriptDelta(itemId, delta) {
  if (!itemId) return;
  if (activeTranscriptId !== itemId) {
    activeTranscriptId = itemId;
    currentPartial = "";
  }
  currentPartial += delta;
  renderTranscript();
}

function handleTranscriptComplete(itemId, text) {
  if (!itemId) return;
  if (activeTranscriptId !== itemId) {
    activeTranscriptId = itemId;
  }
  if (text) currentPartial = text;
  if (currentPartial) {
    transcripts.push(currentPartial);
  }
  activeTranscriptId = null;
  currentPartial = "";
  renderTranscript();
  status("Ready.");
}

function renderTranscript() {
  const pieces = transcripts.slice();
  if (currentPartial) pieces.push(currentPartial);
  out.textContent = pieces.join("\n");
}

function resetTranscriptState() {
  transcripts.length = 0;
  activeTranscriptId = null;
  currentPartial = "";
  renderTranscript();
}

function safeSend(obj) {
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify(obj));
  } else {
    log("DataChannel not open; cannot send: " + JSON.stringify(obj));
  }
}

function status(text) {
  statusEl.textContent = text;
}

function log(text) {
  logBox.textContent += text + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function toast(text) {
  console.log(text);
}

function updateShowButton(isShowing) {
  const label = isShowing ? "Hide API key" : "Show API key";
  showBtn.setAttribute("aria-pressed", String(isShowing));
  showBtn.setAttribute("aria-label", label);
  showBtn.title = label;
  showIcon.classList.toggle("fa-eye", isShowing);
  showIcon.classList.toggle("fa-eye-slash", !isShowing);
}

function cleanupLocalConnection(stream, peer, dataChannel) {
  if (dataChannel) {
    try {
      dataChannel.onopen = null;
      dataChannel.onmessage = null;
      dataChannel.onclose = null;
      dataChannel.close();
    } catch {}
  }
  if (peer) {
    try {
      peer.onconnectionstatechange = null;
      peer.close();
    } catch {}
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function teardownConnection({ keepState = false, preserveStatus = false } = {}) {
  if (listening) {
    stopListening({ skipStatusUpdate: true });
  }

  if (dc) {
    try {
      dc.onopen = null;
      dc.onmessage = null;
      dc.onclose = null;
      dc.close();
    } catch {}
    dc = null;
  }

  if (pc) {
    try {
      pc.onconnectionstatechange = null;
      pc.close();
    } catch {}
    pc = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (!keepState) {
    setConnectionState(ConnectionState.DISCONNECTED);
    resetTranscriptState();
    if (!preserveStatus) {
      status("Not connected.");
    }
  } else {
    updateToggleButton();
  }
}

function invalidateConnectionAttempts() {
  connectToken += 1;
}
