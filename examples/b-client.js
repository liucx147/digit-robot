// Minimal browser integration. B owns recording, playback UI and visible animation.
export function createVoiceClient(baseUrl, audio) {
  let session;
  let generation = 0;
  const base = baseUrl.replace(/\/$/, "");
  async function request(path, options) {
    const response = await fetch(base + path, options);
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message || body.code), { body });
    return body;
  }
  function route(suffix = "") {
    if (!session) throw new Error("Call open() first");
    return `/v1/sessions/${session.session_id}${suffix}`;
  }
  async function send(suffix, options) {
    const stamp = generation;
    try {
      const result = await request(route(suffix), options);
      if (stamp !== generation || result.session_epoch !== session.session_epoch) return null;
      audio.src = base + result.audio.url;
      return result;
    } catch (error) {
      if (stamp !== generation) return null;
      throw error;
    }
  }
  async function invalidate(action) {
    generation += 1; // Invalidate pending browser promises before waiting for the server.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    session = await request(route(`/${action}`), { method: "POST" });
    return session;
  }
  return {
    async open() {
      session = await request("/v1/sessions", { method: "POST" });
      return session;
    },
    status: () => request(route()),
    text(text) {
      return send("/text", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, session_epoch: session.session_epoch }) });
    },
    wav(blob) {
      return send("/audio", { method: "POST", headers: {
        "Content-Type": "audio/wav", "X-Session-Epoch": String(session.session_epoch) }, body: blob });
    },
    stop: () => invalidate("stop"),
    reset: () => invalidate("reset"),
  };
}
