import json
import math
import uuid
from typing import Any, Protocol


class ModelBackend(Protocol):
    def generate(self, messages: list[dict[str, str]]) -> str: ...


SYSTEM_PROMPT = """你是温和、简洁的中文共情对话助手。理解用户的文本情绪并回应，
不要把用户的情绪直接当作自己的表情。仅输出一个 JSON 对象，禁止 Markdown。
字段为 user_emotion、reply、expression_intent。
user_emotion 只能是 happiness、sadness、anger、fear、surprise、disgust、neutral。
reply 是 1 至 500 字的中文回复。expression_intent 含 style 和 intensity；
style 只能是 gentle、cheerful、calm、serious，intensity 为 0 至 1 的数。
例如理解悲伤可采用 gentle 关切回应，而不是机械复制悲伤表情。"""


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON 不允许 {value}")


def load_json(text: str) -> Any:
    return json.loads(text, parse_constant=_reject_constant)


def _validate_answer(raw: str) -> dict[str, Any]:
    answer = load_json(raw)
    if not isinstance(answer, dict):
        raise ValueError("模型输出必须是 JSON 对象")
    emotion = answer.get("user_emotion")
    if not isinstance(emotion, str) or emotion not in {
        "happiness", "sadness", "anger", "fear", "surprise", "disgust", "neutral"
    }:
        raise ValueError("user_emotion 必须为约定的七类之一")
    reply = answer.get("reply")
    if not isinstance(reply, str) or not reply.strip() or len(reply) > 500:
        raise ValueError("reply 必须是 1 至 500 字的非空文本")
    expression = answer.get("expression_intent")
    if not isinstance(expression, dict):
        raise ValueError("expression_intent 必须含 style 与 intensity")
    style = expression.get("style")
    if not isinstance(style, str) or style not in {"gentle", "cheerful", "calm", "serious"}:
        raise ValueError("expression_intent.style 不在约定枚举中")
    intensity = expression.get("intensity")
    if isinstance(intensity, bool) or not isinstance(intensity, (int, float)) or not 0 <= intensity <= 1 or not math.isfinite(intensity):
        raise ValueError("expression_intent.intensity 必须是 0 至 1 的有限数，不能为布尔值")
    return {"user_emotion": emotion, "reply": reply.strip(),
            "expression_intent": {"style": style, "intensity": intensity}}


class DialogueSession:
    def __init__(self, backend: ModelBackend) -> None:
        self.backend = backend
        self.history: list[dict[str, str]] = []
        self.epoch = 0

    def reset(self) -> dict[str, Any]:
        self.history.clear()
        self.epoch += 1
        return {"type": "reset", "session_epoch": self.epoch}

    def respond(self, text: str) -> dict[str, Any]:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *self.history,
                    {"role": "user", "content": text}]
        attempts: list[dict[str, Any]] = []
        answer = None
        for _ in range(2):
            raw = None
            try:
                raw = self.backend.generate(messages)
                answer = _validate_answer(raw)
            except Exception as error:
                diagnostic = f"{type(error).__name__}: {error}"
                attempts.append({"raw_output": raw, "error": diagnostic})
                if raw is not None:
                    messages.append({"role": "assistant", "content": raw})
                messages.append({"role": "user", "content": f"刚才输出无效：{diagnostic}。请严格按系统要求重新输出 JSON。"})
            else:
                attempts.append({"raw_output": raw, "error": None})
                break
        status = "ok"
        if answer is None:
            status = "fallback"
            answer = {"user_emotion": "neutral", "reply": "刚才的回复生成遇到问题，请再说一次。",
                      "expression_intent": {"style": "calm", "intensity": 0.0}}
        self.history.extend([
            {"role": "user", "content": text},
            {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
        ])
        return {"type": "response", "utterance_id": str(uuid.uuid4()),
                "session_epoch": self.epoch, **answer, "status": status,
                "attempts": attempts}
