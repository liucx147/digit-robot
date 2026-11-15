import json
from threading import Event
import pytest

from digit_robot.reply_stream import reply_records


def test_first_valid_sentence_is_available_before_rest_of_generation() -> None:
    rest_requested = Event()
    def chunks():
        yield '{"type":"meta","user_emotion":"sadness","expression_intent":{"style":"gentle","intensity":0.5}}\n'
        yield '{"type":"sentence","text":"听起来你很难过。"}\n'
        rest_requested.set()
        yield '{"type":"sentence","text":"我们可以一起想办法。"}\n'
    events = reply_records(chunks())
    assert next(events)['type'] == 'meta'
    assert next(events) == {'type': 'sentence', 'text': '听起来你很难过。'}
    assert not rest_requested.is_set()
    assert list(events) == [{'type': 'sentence', 'text': '我们可以一起想办法。'}]


def test_fragmented_records_are_decoded_and_invalid_or_long_output_is_rejected() -> None:
    header = '{"type":"meta","user_emotion":"neutral","expression_intent":{"style":"calm","intensity":0}}\n'
    assert len(list(reply_records([header[:20], header[20:], '{"type":"sentence","text":"你好。"}']))) == 2
    for bad in ['{"type":"sentence","text":"不能先说话。"}\n', header + json.dumps({'type':'sentence','text':'长'*37})]:
        with pytest.raises(ValueError):
            list(reply_records([bad]))
