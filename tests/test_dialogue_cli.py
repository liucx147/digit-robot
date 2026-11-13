import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from collections.abc import Sequence

from digit_robot.cli import run


class ScriptedModel:
    def __init__(self, outputs: Sequence[str]) -> None:
        self.outputs = iter(outputs)

    def generate(self, messages: list[dict[str, str]]) -> str:
        return next(self.outputs)


class ConversationModel:
    def generate(self, messages: list[dict[str, str]]) -> str:
        user_texts = [item["content"] for item in messages if item["role"] == "user"]
        reply = "我记得你正在准备论文。" if any("论文" in item for item in user_texts) else "这是新会话，请重新告诉我。"
        return json.dumps({"user_emotion": "neutral", "reply": reply,
                           "expression_intent": {"style": "calm", "intensity": 0.2}}, ensure_ascii=False)


class DialogueCliTests(unittest.TestCase):
    def interact(self, events: list[dict[str, object]], backend: object) -> list[dict]:
        source = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        target = io.StringIO()
        run(source, target, backend)
        return [json.loads(line) for line in target.getvalue().splitlines()]

    def test_chinese_message_returns_separate_emotion_reply_and_expression(self) -> None:
        model = ScriptedModel([
            '{"user_emotion":"sadness","reply":"听起来你今天很难过，我愿意听你说说。",'
            '"expression_intent":{"style":"gentle","intensity":0.4}}'
        ])
        result = self.interact([{"type": "message", "text": "今天很难过"}], model)[0]
        self.assertEqual(result["type"], "response")
        self.assertEqual(result["user_emotion"], "sadness")
        self.assertEqual(result["expression_intent"], {"style": "gentle", "intensity": 0.4})
        self.assertEqual(result["reply"], "听起来你今天很难过，我愿意听你说说。")
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["utterance_id"])
        self.assertEqual(result["session_epoch"], 0)

    def test_two_turn_context_is_cleared_by_visible_reset(self) -> None:
        results = self.interact([
            {"type": "message", "text": "我正在准备论文。"},
            {"type": "message", "text": "你记得我在做什么吗？"},
            {"type": "reset"},
            {"type": "message", "text": "你记得我在做什么吗？"},
        ], ConversationModel())
        self.assertEqual(results[1]["reply"], "我记得你正在准备论文。")
        self.assertEqual(results[2], {"type": "reset", "session_epoch": 1})
        self.assertEqual(results[3]["reply"], "这是新会话，请重新告诉我。")
        self.assertEqual(results[3]["session_epoch"], 1)
        self.assertNotEqual(results[0]["utterance_id"], results[1]["utterance_id"])

    def test_bad_input_is_visible_and_does_not_break_following_turn(self) -> None:
        bad_lines = ["not json", "[]", '"string"', "null", "{}",
                     '{"type":"message","text":""}',
                     '{"type":"message","text":"   "}',
                     '{"type":"message","text":false}',
                     '{"type":"unknown"}',
                     '{"type":"message","text":NaN}',
                     '{"type":"message","text":Infinity}',
                     json.dumps({"type": "message", "text": "字" * 2001})]
        source = io.StringIO("\n".join(bad_lines) + '\n{"type":"message","text":"你好"}\n')
        target = io.StringIO()
        model = ScriptedModel(['{"user_emotion":"neutral","reply":"你好。",'
                               '"expression_intent":{"style":"calm","intensity":0.2}}'])
        run(source, target, model)
        results = [json.loads(line) for line in target.getvalue().splitlines()]
        for result in results[:-1]:
            self.assertEqual(result["type"], "error")
            self.assertEqual(result["code"], "invalid_input")
            self.assertTrue(result["message"])
        self.assertEqual(len(results), 13)
        self.assertEqual(results[-1]["reply"], "你好。")

    def test_deeply_nested_json_reports_error_and_next_reset_still_runs(self) -> None:
        nested = "[" * 10000 + "0" + "]" * 10000
        source = io.StringIO(nested + '\n{"type":"reset"}\n')
        target = io.StringIO()
        run(source, target, ScriptedModel([]))
        results = [json.loads(line) for line in target.getvalue().splitlines()]
        self.assertEqual(results[0]["type"], "error")
        self.assertEqual(results[0]["code"], "invalid_input")
        self.assertEqual(results[1], {"type": "reset", "session_epoch": 1})

    def test_invalid_model_output_is_retried_and_raw_failure_remains_visible(self) -> None:
        bad_output = '{"reply":"缺少必需字段"}'
        good_output = '{"user_emotion":"neutral","reply":"我们慢慢说。",' \
                      '"expression_intent":{"style":"calm","intensity":0.1}}'
        result = self.interact([{"type": "message", "text": "你好"}],
                               ScriptedModel([bad_output, good_output]))[0]
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["reply"], "我们慢慢说。")
        self.assertEqual(result["attempts"][0]["raw_output"], bad_output)
        self.assertTrue(result["attempts"][0]["error"])
        self.assertEqual(result["attempts"][1], {"raw_output": good_output, "error": None})

    def test_invalid_model_fields_produce_explicit_fallback_after_two_attempts(self) -> None:
        valid = {"user_emotion": "neutral", "reply": "我在听。",
                 "expression_intent": {"style": "calm", "intensity": 0.2}}
        invalid = ["not json", "[]", "null", "{}",
                   '{"user_emotion":"neutral","reply":"你好","expression_intent":'
                   '{"style":"calm","intensity":NaN}}']
        for key, value in [("user_emotion", "angry"), ("reply", ""), ("reply", " " * 3),
                           ("reply", "字" * 501), ("reply", None), ("expression_intent", [])]:
            invalid.append(json.dumps({**valid, key: value}, ensure_ascii=False))
        for key, value in [("style", "sad"), ("intensity", True), ("intensity", -0.1),
                           ("intensity", 1.1), ("intensity", "0.2"), ("intensity", None),
                           ("intensity", float("inf"))]:
            invalid.append(json.dumps({**valid, "expression_intent": {
                **valid["expression_intent"], key: value}}, ensure_ascii=False))
        invalid.append(json.dumps(valid).replace('0.2', '1e309'))
        for raw in invalid:
            with self.subTest(raw=raw[:100]):
                result = self.interact([{"type": "message", "text": "你好"}],
                                       ScriptedModel([raw, raw]))[0]
                self.assertEqual(result["status"], "fallback")
                self.assertEqual(result["user_emotion"], "neutral")
                self.assertEqual(result["expression_intent"], {"style": "calm", "intensity": 0.0})
                self.assertEqual(len(result["attempts"]), 2)
                self.assertTrue(all(attempt["error"] for attempt in result["attempts"]))
                self.assertEqual(result["attempts"][0]["raw_output"], raw)

    def test_model_runtime_failure_is_visible_and_next_turn_can_recover(self) -> None:
        class RecoveringModel:
            def generate(self, messages: list[dict[str, str]]) -> str:
                if messages[-1]["content"] != "重新开始":
                    raise RuntimeError("GPU unavailable")
                return '{"user_emotion":"happiness","reply":"现在可以继续了。",' \
                       '"expression_intent":{"style":"cheerful","intensity":0.5}}'

        results = self.interact([{"type": "message", "text": "你好"},
                                 {"type": "message", "text": "重新开始"}], RecoveringModel())
        self.assertEqual(results[0]["status"], "fallback")
        self.assertIn("GPU unavailable", results[0]["attempts"][0]["error"])
        self.assertEqual(results[1]["status"], "ok")
        self.assertEqual(results[1]["reply"], "现在可以继续了。")

    def test_command_help_does_not_require_model_packages(self) -> None:
        result = subprocess.run([sys.executable, "-m", "digit_robot", "--help"],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--model-dir", result.stdout)
        self.assertIn("--max-new-tokens", result.stdout)

    def test_missing_local_model_directory_exits_with_visible_error(self) -> None:
        missing = str(Path(__file__).parent / "missing-local-model")
        result = subprocess.run([sys.executable, "-m", "digit_robot", "--model-dir", missing],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["code"], "model_load_failed")
        self.assertIn("本地模型目录不存在", result.stderr)


if __name__ == "__main__":
    unittest.main()
