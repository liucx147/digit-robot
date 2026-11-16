"""HTTP boundary used by B's browser; model runtimes live behind VoicePipeline."""

from typing import Any
from pathlib import Path
import json
import asyncio
from threading import Event

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .dialogue import load_json
from .voice import VoiceError, VoicePipeline


def create_app(pipeline: VoicePipeline, origins: list[str] | None = None,
               web_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Digit Robot A/B Voice API", version="0.2.0", docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=origins or [],
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-Session-Epoch"])

    def private_profiles(response: Response) -> None:
        response.headers['Cache-Control'] = 'no-store'

    profile_routes = APIRouter(prefix='/v1/profiles', dependencies=[Depends(private_profiles)])

    @app.exception_handler(VoiceError)
    async def voice_error(request: Request, error: VoiceError) -> JSONResponse:
        headers = {'Cache-Control': 'no-store'} if request.url.path.startswith('/v1/profiles') else None
        return JSONResponse(error.body, status_code=error.status, headers=headers)

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "api_version": "0.2.0", "model_policy": "resident_sentence_pipeline" if hasattr(pipeline, 'stream_turn') else "serial_local_subprocesses",
                "sentence_streaming": hasattr(pipeline, 'stream_turn'), "profile_memory": True}

    async def profile_input(request: Request, allowed: set[str], required: set[str]) -> dict[str, Any]:
        raw = await read_body(request, 8192)
        try:
            data = load_json(raw.decode('utf-8')) if raw else {}
        except (ValueError, UnicodeDecodeError, RecursionError) as error:
            raise VoiceError('invalid_profile_input', '需要有效的JSON档案对象', 422) from error
        if not isinstance(data, dict) or set(data) - allowed or required - set(data):
            raise VoiceError('invalid_profile_input', '档案请求字段无效', 422)
        return data

    @profile_routes.get('')
    def profiles() -> dict[str, Any]:
        return {'profiles': pipeline.profiles.list()}

    @profile_routes.post('', status_code=201)
    async def create_profile(request: Request) -> dict[str, Any]:
        data = await profile_input(request, {'display_name'}, {'display_name'})
        return await run_in_threadpool(pipeline.profiles.create, data)

    @profile_routes.get('/{profile_id}')
    def profile(profile_id: str) -> dict[str, Any]:
        return pipeline.profiles.get(profile_id)

    @profile_routes.patch('/{profile_id}')
    async def rename_profile(profile_id: str, request: Request) -> dict[str, Any]:
        data = await profile_input(request, {'display_name'}, {'display_name'})
        return await run_in_threadpool(pipeline.mutate_profile, profile_id, data)

    @profile_routes.delete('/{profile_id}')
    def delete_profile(profile_id: str) -> dict[str, Any]:
        return pipeline.mutate_profile(profile_id, delete=True)

    @profile_routes.get('/{profile_id}/preferences')
    def preferences(profile_id: str) -> dict[str, Any]:
        return pipeline.profiles.get(profile_id)['preferences']

    @profile_routes.patch('/{profile_id}/preferences')
    async def update_preferences(profile_id: str, request: Request) -> dict[str, Any]:
        data = await profile_input(request, {'preferred_name', 'communication_style'}, set())
        return await run_in_threadpool(pipeline.mutate_profile, profile_id, data, preferences=True)

    @profile_routes.delete('/{profile_id}/preferences')
    def clear_preferences(profile_id: str) -> dict[str, Any]:
        return pipeline.mutate_profile(profile_id, {'preferred_name': None, 'communication_style': None}, preferences=True)

    app.include_router(profile_routes)

    @app.post('/v1/sessions/{session_id}/profile')
    async def bind_profile(session_id: str, request: Request) -> dict[str, Any]:
        data = await profile_input(request, {'profile_id', 'session_epoch'}, {'profile_id', 'session_epoch'})
        epoch = data['session_epoch']
        if type(epoch) is not int or epoch < 0:
            raise VoiceError('invalid_profile_input', 'session_epoch 必须为非负整数', 422)
        return await run_in_threadpool(pipeline.bind_profile, session_id, epoch, data['profile_id'])

    def streamed(session_id: str, epoch: int, **input: Any) -> StreamingResponse:
        events = getattr(pipeline, 'stream_turn')(session_id, epoch, **input)
        async def body():
            terminal = False
            owner = None
            pending = None
            try:
                while True:
                    pending = asyncio.get_running_loop().run_in_executor(None, next, events, None)
                    value = await asyncio.shield(pending)
                    if value is None:
                        break
                    if value['type'] == 'start':
                        owner = value['utterance_id']
                    if value['type'] in ('done', 'error'):
                        terminal = True
                    yield json.dumps(value, ensure_ascii=False) + '\n'
            finally:
                if not terminal and owner is not None:
                    with pipeline.lock:
                        current = pipeline.status(session_id)
                        if current['session_epoch'] == epoch and current['utterance_id'] == owner:
                            pipeline.invalidate(session_id, reset=False)
                # The cooperative model cancellation lets an in-flight next() finish.
                # Closing only afterward avoids closing a generator running on another thread.
                async def close_iterator():
                    if pending is not None:
                        await pending
                    events.close()
                asyncio.create_task(close_iterator())
        return StreamingResponse(body(),
                                 media_type='application/x-ndjson', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

    async def disconnected_turn(request: Request, session_id: str, epoch: int, **input: Any) -> Any:
        cancelled = Event()
        call = asyncio.create_task(run_in_threadpool(pipeline.turn, session_id, epoch, cancelled=cancelled, **input))

        def abandon() -> None:
            cancelled.set()
            with pipeline.lock:
                session = pipeline.sessions.get(session_id)
                if session is not None and session.epoch == epoch and session.cancel is cancelled:
                    pipeline.invalidate(session_id, reset=False)

        async def monitor() -> None:
            while not call.done():
                if await request.is_disconnected():
                    abandon()
                    return
                await asyncio.sleep(.05)

        watcher = asyncio.create_task(monitor())
        try:
            return await asyncio.shield(call)
        except asyncio.CancelledError:
            abandon()
            # Retrieve a late failure after the HTTP task has gone away.
            call.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
            raise
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

    @app.post("/v1/sessions")
    async def create_session(request: Request) -> dict[str, Any]:
        data = await profile_input(request, {'profile_id'}, set())
        session = await run_in_threadpool(pipeline.create_session, data.get('profile_id'))
        if hasattr(pipeline, 'stream_turn'):
            session['sentence_streaming'] = True
        return session

    @app.get("/v1/sessions/{session_id}")
    def status(session_id: str) -> dict[str, Any]:
        return pipeline.status(session_id)

    @app.post("/v1/sessions/{session_id}/reset")
    def reset(session_id: str) -> dict[str, Any]:
        return pipeline.invalidate(session_id, reset=True)

    @app.post("/v1/sessions/{session_id}/stop")
    def stop(session_id: str) -> dict[str, Any]:
        return pipeline.invalidate(session_id, reset=False)

    @app.post("/v1/sessions/{session_id}/text", openapi_extra={"requestBody": {
        "required": True, "content": {"application/json": {"schema": {"type": "object",
        "required": ["text", "session_epoch"], "properties": {
            "text": {"type": "string", "minLength": 1, "maxLength": 2000},
            "session_epoch": {"type": "integer", "minimum": 0}}}}}}})
    async def text_turn(session_id: str, request: Request) -> Any:
        data = await read_body(request, 16384)
        try:
            body = load_json(data.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError) as error:
            raise VoiceError("invalid_input", "需要有效的 UTF-8 JSON 对象") from error
        if not isinstance(body, dict) or not isinstance(body.get("text"), str):
            raise VoiceError("invalid_input", "需要 text 和 session_epoch")
        epoch = body.get("session_epoch")
        if type(epoch) is not int or epoch < 0:
            raise VoiceError("invalid_input", "session_epoch 必须为非负整数")
        if request.url.path.startswith('/v2/'):
            return streamed(session_id, epoch, text=body['text'])
        return await disconnected_turn(request, session_id, epoch, text=body["text"])

    @app.post("/v1/sessions/{session_id}/audio", openapi_extra={
        "parameters": [{"in": "header", "name": "X-Session-Epoch", "required": True,
                        "schema": {"type": "integer", "minimum": 0}}],
        "requestBody": {"required": True, "content": {"audio/wav": {
            "schema": {"type": "string", "format": "binary"}}}}})
    async def audio_turn(session_id: str, request: Request) -> Any:
        if request.headers.get("content-type", "").split(";")[0].lower() != "audio/wav":
            raise VoiceError("unsupported_media_type", "请发送 audio/wav 的 PCM 录音", 415)
        try:
            raw_epoch = request.headers.get("X-Session-Epoch", "")
            if not raw_epoch.isdecimal():
                raise ValueError("invalid epoch")
            epoch = int(raw_epoch)
        except ValueError as error:
            raise VoiceError("invalid_input", "X-Session-Epoch 必须为非负整数") from error
        data = await read_body(request, 6 * 1024 * 1024)
        if request.url.path.startswith('/v2/'):
            return streamed(session_id, epoch, audio=data)
        return await disconnected_turn(request, session_id, epoch, audio=data)

    if hasattr(pipeline, 'stream_turn'):
        app.add_api_route('/v2/sessions/{session_id}/text', text_turn, methods=['POST'])
        app.add_api_route('/v2/sessions/{session_id}/audio', audio_turn, methods=['POST'])

        @app.get('/v2/sessions/{session_id}/turns/{utterance_id}/segments/{index}/audio')
        def segment_audio(session_id: str, utterance_id: str, index: int) -> FileResponse:
            return FileResponse(pipeline.audio_file(session_id, f'{utterance_id}.{index}'), media_type='audio/wav', headers={'Cache-Control': 'no-store'})

    @app.get("/v1/sessions/{session_id}/turns/{utterance_id}/audio")
    def audio_file(session_id: str, utterance_id: str) -> FileResponse:
        return FileResponse(pipeline.audio_file(session_id, utterance_id), media_type="audio/wav",
                            headers={"Cache-Control": "no-store"})

    if web_dir is not None:
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="browser")
    return app


async def read_body(request: Request, limit: int) -> bytes:
    chunks = []
    length = 0
    async for chunk in request.stream():
        length += len(chunk)
        if length > limit:
            raise VoiceError("request_too_large", "请求体超过接口限制", 413)
        chunks.append(chunk)
    return b"".join(chunks)


def main() -> None:
    import argparse
    import uvicorn
    from .process_models import ProcessModels, RuntimeConfig

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("runs/voice"))
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--allow-origin", action="append", default=[])
    parser.add_argument('--resident', action='store_true', help='Load ASR/LLM/TTS once and enable sentence streaming')
    parser.add_argument('--tts-workers', type=int, choices=(1, 2), default=1, help='Bounded resident TTS concurrency')
    parser.add_argument('--profiles-db', type=Path, help='Persistent SQLite profile database; default: output-dir/profiles.sqlite3')
    args = parser.parse_args()
    config = RuntimeConfig.from_file(args.config)
    if args.resident:
        from .resident import ResidentModels
        from .sentence_pipeline import SentencePipeline
        models: Any = ResidentModels(config, args.output_dir / 'workers', tts_workers=args.tts_workers)
    else:
        models = ProcessModels(config)
    try:
        pipeline: VoicePipeline = (SentencePipeline(models, args.output_dir, tts_workers=args.tts_workers, profiles_db=args.profiles_db)
                                   if args.resident else VoicePipeline(models, args.output_dir, profiles_db=args.profiles_db))
        web_dir = models.config.project_root / "web"
        app = create_app(pipeline, args.allow_origin,
                         web_dir=web_dir if web_dir.is_dir() else None)
        uvicorn.run(app, host="127.0.0.1", port=args.port)
    finally:
        if args.resident:
            models.close()


if __name__ == "__main__":
    main()
