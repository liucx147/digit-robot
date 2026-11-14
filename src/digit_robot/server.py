"""HTTP boundary used by B's browser; model runtimes live behind VoicePipeline."""

from typing import Any
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .dialogue import load_json
from .voice import VoiceError, VoicePipeline


def create_app(pipeline: VoicePipeline, origins: list[str] | None = None,
               web_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Digit Robot A/B Voice API", version="0.2.0", docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=origins or [],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Session-Epoch"])

    @app.exception_handler(VoiceError)
    async def voice_error(request: Request, error: VoiceError) -> JSONResponse:
        return JSONResponse(error.body, status_code=error.status)

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "api_version": "0.2.0", "model_policy": "serial_local_subprocesses"}

    @app.post("/v1/sessions")
    def create_session() -> dict[str, Any]:
        return pipeline.create_session()

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
    async def text_turn(session_id: str, request: Request) -> dict[str, Any]:
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
        return await run_in_threadpool(pipeline.turn, session_id, epoch, text=body["text"])

    @app.post("/v1/sessions/{session_id}/audio", openapi_extra={
        "parameters": [{"in": "header", "name": "X-Session-Epoch", "required": True,
                        "schema": {"type": "integer", "minimum": 0}}],
        "requestBody": {"required": True, "content": {"audio/wav": {
            "schema": {"type": "string", "format": "binary"}}}}})
    async def audio_turn(session_id: str, request: Request) -> dict[str, Any]:
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
        return await run_in_threadpool(pipeline.turn, session_id, epoch, audio=data)

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
    args = parser.parse_args()
    models = ProcessModels(RuntimeConfig.from_file(args.config))
    web_dir = models.config.project_root / "web"
    app = create_app(VoicePipeline(models, args.output_dir), args.allow_origin,
                     web_dir=web_dir if web_dir.is_dir() else None)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
