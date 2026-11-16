# Reduce sentence gaps

Approved intent: reduce audible waits between sentence replies while tracking first speech and preserving the working single-worker fallback, keys, and existing local model files.

Observed cause: recent sentence2 synthesis5.956s exceeds sentence1 audio3.680s. Boundary silence is only80ms leading and20–70ms trailing; deleting silence cannot remove the synthesis wait.

1. Add a bounded opt-in two-worker TTS pool. Dispatch validated sentences during LLM generation, publish sentence/audio pairs in order, retain cancellation and one admitted conversation. Default remains one TTS worker. Test actual HTTP delivery with overlapping external synthesis fixture and forced out-of-order completion.
2. Prefetch AND decode the next audio while current media plays. Keep actual playing/ended timing and epoch fences. Test delayed browser decoding before previous audio ends and stop/error regressions.
3. Compare fixed public test inputs with single and dual TTS on4090, record first speech, actual segment gaps, total playback and residency. Original serial services remain untouched; own resident service may be restarted to switch worker counts because24GiB cannot hold two complete deployments. Retain raw failed attempts and current implementation commitc65b39f for rollback. Deploy dual mode only after actual gaps improve and first-speech tradeoff is measured; no claim that hardware can guarantee zero gaps for every reply.
