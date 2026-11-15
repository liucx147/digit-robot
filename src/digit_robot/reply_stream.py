"""Incrementally validate complete, short sentence records before speaking them."""
from collections.abc import Iterable, Iterator
import json
from typing import Any

from .dialogue import load_json, validate_answer

STREAM_PROMPT = '''你是温和、简洁的中文共情对话助手。只输出逐行JSON（NDJSON），不要Markdown，不要解释格式。
第一行必须为情绪和表达意图：{"type":"meta","user_emotion":"sadness","expression_intent":{"style":"gentle","intensity":0.5}}
user_emotion只能是happiness/sadness/anger/fear/surprise/disgust/neutral，style只能是gentle/cheerful/calm/serious，intensity在0到1之间。
随后每行是一句完整中文：{"type":"sentence","text":"听起来你很难过，我愿意听你说。"}
根据用户实际内容独立判断，不要照抄例子。回复1至3句，总计40至80字以内，简单问候可以更短。
第一句尽快简短回应，目标12至20字、最多24字；后续每句最多36字。不要把用户情绪机械当作自己的表情。
句子用中文句号、问号或感叹号结束。一行写完再写下一行。最后一句之后直接结束，不要其他字段。'''


def reply_records(chunks: Iterable[str]) -> Iterator[dict[str, Any]]:
    buffer = ''
    metadata = False
    count, characters = 0, 0

    def parse(line: str) -> dict[str, Any]:
        nonlocal metadata, count, characters
        value = load_json(line)
        if not isinstance(value, dict):
            raise ValueError('分句输出必须为JSON对象')
        if not metadata:
            if value.get('type') != 'meta':
                raise ValueError('分句输出必须先返回表达意图')
            validated = validate_answer(json.dumps({**value, 'reply': '校验'}, ensure_ascii=False))
            metadata = True
            return {'type': 'meta', 'user_emotion': validated['user_emotion'], 'expression_intent': validated['expression_intent']}
        text = value.get('text')
        if value.get('type') != 'sentence' or not isinstance(text, str) or not text.strip():
            raise ValueError('需要非空完整分句')
        text = text.strip()
        if len(text) > (24 if count == 0 else 36) or characters + len(text) > 80 or count >= 3:
            raise ValueError('回复超出分句或总长度限制')
        if text[-1] not in '。！？!?':
            raise ValueError('分句未在完整句子边界结束')
        count += 1
        characters += len(text)
        return {'type': 'sentence', 'text': text}

    for chunk in chunks:
        buffer += chunk
        if len(buffer) > 8192:
            raise ValueError('分句记录过长')
        while '\n' in buffer:
            line, buffer = buffer.split('\n', 1)
            if line.strip():
                yield parse(line)
    if buffer.strip():
        yield parse(buffer)
    if not metadata or not count:
        raise ValueError('模型没有返回完整可播放的回复')
