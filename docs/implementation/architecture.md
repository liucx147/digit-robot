# 数字人实现约定

本轮实现以本地跟踪器中的数字人优先规格v1.1和18张任务票为准。

## 技术边界

- 浏览器使用本地JavaScript模块和Three.js呈现三维头部；生产资源本地提供，运行时不依赖CDN。
- 本地Python 3.12以上提供命令入口、HTTP交互和研究工具。基础功能尽量使用标准库；模型、训练和人脸感知依赖采用独立可选安装组，按实机验证。
- Python源代码采用src布局。A侧当前文本对话包为digit_robot，公开JSONL入口为`python -m digit_robot`；B侧现有测量工具位于digital_human.measurement，公开入口为`python -m digital_human.measurement_cli`。研究模块及其包名、公开命令留待对应独立任务确定；统一交互入口随后接入。
- 工程主测试边界为数字人公开交互入口，研究主测试边界为研究CLI。测试替身只放在外部模型、采集设备及时间等系统边界，真实模型和GPU验收单独记录。
- 原始学生对话结果包括user_emotion、reply、expression_intent；用户标签采用happiness、sadness、anger、fear、surprise、disgust、neutral。expression_intent包含style和0至1的intensity。
- 每次发言关联utterance_id和session_epoch；面部参数帧包括frame_id、audio_time_ms及0至1的weights。音频实际播放位置为动画主时钟。
- 基础命令与Web默认不伪装模型已就绪。测试或演示替身必须显式选择并注明，不充当真实离线模型或实机达标证据。
- 研究工具的夹具、合成示例与未审核文本不是人工金标；实际数据发布须有真实独立人工审核记录。

## 初始实现分工

- 01票负责web目录中的说话头、音频播放、资产许可及对应公开入口测试。
- 02票负责src/digit_robot中的文本对话契约、模型后端边界及`python -m digit_robot` JSONL入口。
- 09票负责digital_human.measurement中的冻结输入、独立标注评分与`python -m digital_human.measurement_cli`公开入口。
- 12票负责独立研究模块的数据审核与封存，以及研究公开入口；具体包名与命令在该任务实施时确定。
- 共享入口、Python打包和集成调整由集成分支收敛，避免独立任务同时修改中央配置。

## 证据与状态

每张票记录代码、测试和实际验收证据。代码测试通过不代表所有实际资源与研究条件已经具备；未满足验收的票保持打开，并记录缺少的条件。完成须勾选全部验收、在Comments记录证据并将生命周期State设为closed；Status仍使用既有分诊角色，两者分开。
