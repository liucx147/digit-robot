# Resident sentence voice implementation plan

Goal: preserve the serial deployment while serving short, sentence-streamed replies with resident ASR/LLM/TTS, ordered browser playback, cancellation and end-to-end timing.

Spec: `.scratch/digital-human-emotion/spec.md` and the user's approved three-step optimization plan in this chat.

Constraints: no keys or model files changed/uploaded; preserve separate Python environments; retain existing HTTP API and original 8000/8001/8002 services. GPU inference is real in remote acceptance; local model-boundary fixtures are explicitly synthetic.

1. Resident processes and short replies. Add a JSONL worker protocol with ready/load metadata, request IDs, cancellation and shutdown. Keep model environments separate and workers alive across requests. Short streaming prompt: metadata first, then 1–3 complete sentence records, at most 80 reply characters; first sentence aims at 12–20 characters. Verify at the process protocol boundary using a CPU fixture, then with real resident GPU workers.
2. Sentence pipeline. Add incremental validated LLM records, bounded sentence production, sequential TTS in parallel with LLM continuation, and NDJSON HTTP events with segment URLs. Preserve one admitted turn, epoch fencing, explicit errors and old serial routes. Log first token, first sentence, first audio ready, LLM completion, all audio ready and per-segment synth durations. Test through HTTP and delayed external model seams: first audio must arrive before generation completes; stop invalidates segments and late results.
3. Browser and deployment. Add capability negotiation so serial pages keep working; streamed replies use an ordered WAV playback queue, prefetched next segment, common turn IDs, actual media-clock mouth motion and timing. Stop clears playback and pending segments. Test the public page with delayed HTTP boundaries, including order, stop, failure and final timing. Run the full suites once at the end and two-axis review against 7251b70. Deploy a separate release/port on 4090, measure cold and warm real microphone-fixture turns against serial 8002, preserve raw evidence and report both first speech and playback completion. Targets are evaluated, not assumed: warm TTFA P50 <=5s / P95 <=8s only with sufficient samples; TTS RTF and gaps reported.

Interfaces: resident worker stdin/stdout JSONL (logs only on stderr); `meta`, `sentence`, `audio_ready`, `done`, `error` HTTP NDJSON events include session_id, utterance_id, session_epoch and segment_index where applicable. Per-turn cancellation never rewrites completed audio into success. All queues bounded; model cancellation may discard pending TTS output while keeping the worker resident. Existing stop/reset endpoints advance epoch.

Review focus: malformed/partial LLM JSON; cancelled in-flight synthesis; out-of-order/duplicate/failed audio fetches; warm worker failure and GPU capacity; browser audio end is not server generation end.
