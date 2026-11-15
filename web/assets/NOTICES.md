# Bundled asset and dependency notices

Verified 2026-11-13. These notices are specific to the bundled bytes; Three.js's license does not license the avatar or audio.

## Avatar: VRM1_Constraint_Twist_Sample v1.0.1

- Author: pixiv Inc.; copyright: (c) 2022 pixiv Inc.
- Unmodified binary glTF 2.0 / VRM 1.0 file: `avatar.vrm`, 10,776,032 bytes.
- SHA-256: `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`.
- [Official asset/source card](https://github.com/vrm-c/vrm-specification/blob/master/samples/VRM1_Constraint_Twist_Sample/README.md).
- [Original bytes](https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm); [official Pixiv mirror](https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm). Both downloads had the same SHA-256.
- License: [VRM Public License 1.0](LICENSE-VRM-PUBLIC-1.0.html), also [publisher's current text](https://vrm.dev/en/licenses/1.0/index). The full original license, including its Section 4 warranty/liability disclaimer, is bundled for offline reading.
- Embedded model permissions: `avatarPermission=everyone`, `commercialUsage=corporation`, `allowRedistribution=true`, `modification=allowModificationRedistribution`, `creditNotation=unnecessary`. Corporate commercial use and redistribution are permitted under the attached VRM license and model settings. Antisocial/hate use is forbidden (`allowAntisocialOrHateUsage=false`). Do not imply publisher endorsement or restrict recipients' licensed rights. No visible model credit is required by this asset; retain this notice and the model metadata when distributing.
- This application changes camera framing and drives existing morphs; it does not alter the distributed model file. All buffers/textures are embedded, with no required runtime fetch to the source site. Standard glTF core/unlit materials are rendered, without a full VRM plugin.

Verified Face mesh morph parameters (57 named morphs exist):

| Application parameter | Actual morph target | Index | Current use |
| --- | --- | --- | --- |
| jawOpen | Face_Blendshape.Fcl_MTH_A | 36 | Audio amplitude / mouth opening |
| smile | Face_Blendshape.Fcl_MTH_Joy | 29 | Manual smile contribution, attenuated during mouth opening |
| blink | Face_Blendshape.Fcl_EYE_Close | 12 | Supported controller weight, initially zero |

The file's VRM preset `aa` binds morph 36. `jawOpen` is our semantic alias; it is not a claim that the asset contains an ARKit parameter. Other vowel morphs I/U/E/O are present at 37/38/39/40; they are not used for phoneme animation. Head node: `J_Bip_C_Head`.

## Mandarin recording: 你好

- Recording/speaker: Luilui6666 via Lingua Libre; recorded 2022-01-03. This is a speech recording sample.
- File: `nihao-cc0.wav`, PCM16, mono, 48,000 Hz, 1.0533333333 seconds, 101,164 bytes. Original downloaded bytes retained.
- SHA-256: `4c874c2b1030cc276aee5003af1ba4439394f2c20cf3849cd4d9398a434c0729`.
- [Publisher source/file page](https://commons.wikimedia.org/wiki/File:LL-Q9192_(cmn)-Luilui6666-%E4%BD%A0%E5%A5%BD.wav), [direct audio](https://upload.wikimedia.org/wikipedia/commons/7/77/LL-Q9192_%28cmn%29-Luilui6666-%E4%BD%A0%E5%A5%BD.wav).
- The source offers CC0 1.0 and CC BY-SA 4.0 as alternatives. This bundle uses the [CC0 1.0 dedication](https://creativecommons.org/publicdomain/zero/1.0/), permitting commercial copying/redistribution without attribution obligation. Provenance is retained here.
- Test sine-wave fixtures are generated in the test itself and identified as synthetic test audio, without being presented as Chinese speech or model output.

## Three.js 0.181.2

- [Official project](https://github.com/mrdoob/three.js), pinned npm package `three@0.181.2`.
- Only `three.module.js`, `three.core.js`, `GLTFLoader.js`, `BufferGeometryUtils.js` and the original [MIT license](../vendor/three/LICENSE) are bundled. Original source files retained.
- npm package shasum: `d54a8c8b4a409e346cbc60fed58244f1b382d6ea`.
- No npm install or remote import is needed to run the page. Playwright is a development-only browser test tool and is not shipped in this frontend.


## Default solid head (2026-11-15)

The default `solid-v1` model is original procedural project geometry in `web/solid-head.js`. It uses no external portrait, character mesh, texture, mechanical drawing or downloaded model. Its source hash is in avatar-manifest.json. The existing Three.js notices still apply. The VRM notices above apply to the retained historical measurement model, whose original manifest is avatar-measurement-manifest.json.
