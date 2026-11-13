import json,os,runpy,socket,sys
from pathlib import Path
task=os.environ["SPEECH_BASELINE_TASK"]
blocked=[]
original_connect=socket.socket.connect
original_connect_ex=socket.socket.connect_ex
def connect(self,address):
    if self.family in (socket.AF_INET,socket.AF_INET6):
        blocked.append(str(address))
        raise RuntimeError("Offline verification denied Internet socket.connect")
    return original_connect(self,address)
def connect_ex(self,address):
    if self.family in (socket.AF_INET,socket.AF_INET6):
        blocked.append(str(address))
        raise RuntimeError("Offline verification denied Internet socket.connect_ex")
    return original_connect_ex(self,address)
socket.socket.connect=connect
socket.socket.connect_ex=connect_ex
root=Path("/root/autodl-tmp/digit-robot")
model_name="Qwen3-TTS-12Hz-1.7B-CustomVoice" if task=="tts" else "Qwen3-ASR-0.6B"
out=root/"reports"/"m1"/("speech-"+task)
sys.argv=[str(root/"scripts"/"speech_baseline.py"),"--task",task,"--model-dir",str(Path("/root/autodl-tmp/models")/model_name),"--output-dir",str(out)]
if task=="tts":
    sys.argv.extend(["--text","你好，我在这里，愿意认真听你说。"])
else:
    sys.argv.extend(["--audio",str(root/"reports/m1/speech-tts/speech-tts.wav")])
code=0
try:
    runpy.run_path(sys.argv[0],run_name="__main__")
except SystemExit as exc:
    code=exc.code or 0
report_path=out/("speech-"+task+"-report.json")
if report_path.exists():
    report=json.loads(report_path.read_text())
    report["offline_verification"]={"method":"Python AF_INET/AF_INET6 connect and connect_ex denied before package import","blocked_connection_attempts":blocked,"kernel_network_namespace_isolation":False}
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
raise SystemExit(code)

