"""One resident model per dependency environment; stdout is only JSONL RPC."""
import argparse
import json
import os
from pathlib import Path
from queue import Full, Queue
import sys
from threading import Event, Lock, Thread
import time
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', choices=('asr', 'llm', 'tts'), required=True)
    parser.add_argument('--model-dir', type=Path, required=True)
    args = parser.parse_args()
    protocol = sys.stdout
    sys.stdout = sys.stderr  # Dependency progress/output cannot corrupt RPC.
    writer, guard = Lock(), Lock()
    calls: dict[str, Event] = {}
    jobs: Queue[Any] = Queue(maxsize=2)

    def emit(value: dict[str, Any]) -> None:
        with writer:
            protocol.write(json.dumps(value, ensure_ascii=False) + '\n')
            protocol.flush()

    started = time.perf_counter()
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('Resident inference requires CUDA')
    if args.role == 'llm':
        from .transformers_backend import TransformersBackend
        model: Any = TransformersBackend(args.model_dir, max_new_tokens=320)
    else:
        source = json.loads((args.model_dir / 'speech-source.json').read_text(encoding='utf-8'))
        if not source.get('revision') or not (args.model_dir / source['license_document']).is_file():
            raise ValueError('Speech model source/license metadata is missing')
        kwargs = dict(device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa', local_files_only=True)
        if args.role == 'asr':
            from qwen_asr import Qwen3ASRModel
            model = Qwen3ASRModel.from_pretrained(str(args.model_dir), max_inference_batch_size=1, max_new_tokens=512, **kwargs)
        else:
            from qwen_tts import Qwen3TTSModel
            model = Qwen3TTSModel.from_pretrained(str(args.model_dir), **kwargs)
    torch.cuda.synchronize()
    emit({'event': 'ready', 'role': args.role, 'pid': os.getpid(), 'load_count': 1,
          'model_load_ms': (time.perf_counter() - started) * 1000,
          'gpu': torch.cuda.get_device_name(), 'allocated_bytes': torch.cuda.memory_allocated(),
          'reserved_bytes': torch.cuda.memory_reserved()})

    def read() -> None:
        for line in sys.stdin:
            request = json.loads(line)
            op, request_id = request['op'], request.get('id')
            if op == 'cancel':
                with guard:
                    if request_id in calls:
                        calls[request_id].set()
            elif op == 'shutdown':
                with guard:
                    for cancel in calls.values():
                        cancel.set()
                break
            elif op == 'call':
                with guard:
                    calls[request_id] = Event()
                try:
                    jobs.put_nowait(request)
                except Full:
                    with guard:
                        calls.pop(request_id, None)
                    emit({'id': request_id, 'event': 'error', 'message': '模型任务队列已满'})
        jobs.put(None)

    Thread(target=read, daemon=True).start()
    while (request := jobs.get()) is not None:
        request_id, payload = request['id'], request['payload']
        with guard:
            cancel = calls[request_id]
        before = time.perf_counter()
        try:
            if cancel.is_set():
                continue
            result: dict[str, Any] = {}
            with torch.inference_mode():
                if args.role == 'llm':
                    if payload.get('stream'):
                        for text in model.stream(payload['messages'], cancel):
                            if not cancel.is_set():
                                emit({'id': request_id, 'event': 'text', 'text': text})
                    else:
                        result['text'] = model.generate(payload['messages'])
                elif args.role == 'asr':
                    outputs = model.transcribe(audio=payload['audio'], language='Chinese')
                    if len(outputs) != 1 or not outputs[0].text.strip():
                        raise ValueError('ASR returned no single transcript')
                    result['text'] = outputs[0].text
                else:
                    import soundfile as sf
                    intent = payload['intent']
                    styles = {'gentle': '温柔、关切、平静', 'cheerful': '轻快、友善、开心', 'calm': '平静、自然、清晰', 'serious': '认真、沉稳、清晰'}
                    torch.manual_seed(42)
                    wavs, rate = model.generate_custom_voice(text=payload['text'], language='Chinese', speaker='Vivian',
                        instruct=f"用{styles[intent['style']]}的语气说话，情绪强度为{intent['intensity']:.0%}。",
                        max_new_tokens=2048, do_sample=True, subtalker_dosample=True)
                    if len(wavs) != 1 or len(wavs[0]) == 0:
                        raise ValueError('TTS returned no waveform')
                    path = Path(payload['output_dir']) / 'reply.wav'
                    sf.write(str(path), wavs[0], rate, subtype='PCM_16')
                    result.update(audio_path=str(path), sample_rate_hz=rate, samples=len(wavs[0]))
            torch.cuda.synchronize()
            if not cancel.is_set() and result:
                emit({'id': request_id, 'event': 'result', **result,
                      'inference_ms': (time.perf_counter() - before) * 1000})
        except Exception as error:
            print(f'{request_id}: {type(error).__name__}: {error}', file=sys.stderr, flush=True)
            emit({'id': request_id, 'event': 'error', 'message': f'{args.role} 模型执行失败，请查看worker日志'})
        finally:
            emit({'id': request_id, 'event': 'done'})
            with guard:
                calls.pop(request_id, None)


if __name__ == '__main__':
    main()
