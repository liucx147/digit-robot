from pathlib import Path
from typing import Any, cast


class TransformersBackend:
    """Load the original Qwen3.5 checkpoint locally; never fetch model files."""

    def __init__(self, model_dir: Path, max_new_tokens: int = 512) -> None:
        if not model_dir.is_dir():
            raise FileNotFoundError(f"本地模型目录不存在：{model_dir}")
        import torch
        from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration

        if not torch.cuda.is_available():
            raise RuntimeError("需要可用的 CUDA GPU 运行本地 Qwen3.5 基线")
        self.torch = torch
        self.max_new_tokens = max_new_tokens
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_dir, local_files_only=True, trust_remote_code=False,
        )
        self.model = cast(Any, Qwen3_5ForConditionalGeneration.from_pretrained(
            model_dir, local_files_only=True, trust_remote_code=False,
            dtype=torch.bfloat16, attn_implementation="sdpa",
        ))
        self.model.to("cuda")
        self.model.eval()

    def generate(self, messages: list[dict[str, str]]) -> str:
        prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False,
        )
        inputs = self.tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(self.model.device)
        with self.torch.inference_mode():
            outputs = self.model.generate(
                **inputs, max_new_tokens=self.max_new_tokens, do_sample=False,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        new_tokens = outputs[0, inputs["input_ids"].shape[1]:]
        return str(self.tokenizer.decode(new_tokens, skip_special_tokens=True)).strip()
