"""Two predeclared engineering prompt cases; original model and research stay unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import time

parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--model-dir', type=Path, required=True)
args = parser.parse_args()
from digit_robot.transformers_backend import TransformersBackend
from digit_robot.dialogue import SYSTEM_PROMPT
fixture = json.loads(args.input.read_text(encoding='utf-8'))
backend = TransformersBackend(args.model_dir)
report = {'scope': 'Engineering context regression only; not distillation or holdout evaluation',
          'input_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(), 'cases': []}
try:
    for case_id, suffix in [('original_prompt', ''), ('engineering_context_prompt_v1', fixture['candidate_instruction'])]:
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT + suffix}, *fixture['history'], fixture['question']]
        prompt = backend.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        row = {'case': case_id, 'messages': messages, 'rendered_prompt': prompt,
               'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
               'prompt_tokens': len(backend.tokenizer(prompt, add_special_tokens=False)['input_ids'])}
        started = time.perf_counter()
        row['raw_output'] = backend.generate(messages)
        row['elapsed_ms'] = (time.perf_counter() - started) * 1000
        try:
            row['reply'] = json.loads(row['raw_output'])['reply']
            row['recalls_explicit_name'] = '小林' in row['reply']
        except (ValueError, KeyError, TypeError) as error:
            row['parse_error'] = str(error)
            row['recalls_explicit_name'] = False
        report['cases'].append(row)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({key: row[key] for key in ['case', 'reply', 'recalls_explicit_name', 'elapsed_ms']}, ensure_ascii=False), flush=True)
finally:
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
