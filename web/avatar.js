import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';

// All face contributors terminate here; later gaze input can use the same boundary.
export class FaceController {
  constructor(root, manifest) {
    this.bindings = {};
    root.traverse(mesh => {
      if (!mesh.morphTargetDictionary) return;
      for (const [parameter, morph] of Object.entries(manifest.parameters)) {
        const index = mesh.morphTargetDictionary[morph];
        if (index !== undefined) (this.bindings[parameter] ||= []).push({ mesh, index });
      }
    });
    this.eyes = (manifest.gaze?.eyeBones || []).map(name => {
      const bone = root.getObjectByName(name);
      if (!bone?.isBone) throw new Error(`数字人缺少注视眼骨骼：${name}`);
      return { bone, neutral: bone.quaternion.clone() };
    });
    this.eyeRange = THREE.MathUtils.degToRad(manifest.gaze?.maxDegrees || 10);
    if (!this.bindings.jawOpen?.length) throw new Error('数字人缺少必需的 jawOpen 嘴部形变');
  }
  apply({ mouth = 0, expression = 0, blink = 0, gaze = { x: 0, y: 0 } } = {}) {
    const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const weights = { jawOpen: clamp(mouth), smile: clamp(expression) * (1 - clamp(mouth)), blink: clamp(blink), gazeLeft: clamp(-gaze.x), gazeRight: clamp(gaze.x), gazeUp: clamp(gaze.y), gazeDown: clamp(-gaze.y) };
    for (const [parameter, bindings] of Object.entries(this.bindings)) {
      for (const { mesh, index } of bindings) mesh.morphTargetInfluences[index] = weights[parameter] || 0;
    }
    // Use world axes: the original VRM eye bones have non-trivial local axes.
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      -(weights.gazeUp - weights.gazeDown) * this.eyeRange,
      (weights.gazeRight - weights.gazeLeft) * this.eyeRange, 0, 'YXZ'));
    for (const { bone, neutral } of this.eyes) {
      const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.clone().invert().multiply(delta).multiply(parent).multiply(neutral));
    }
    return weights;
  }
}

export async function loadAvatar(canvas, manifest, manifestURL) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1d2b3a);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x64768a, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light);
  const model = await new GLTFLoader().loadAsync(new URL(manifest.file, manifestURL).href);
  scene.add(model.scene);
  model.scene.updateMatrixWorld(true);
  const head = model.scene.getObjectByName(manifest.headBone);
  if (!head) throw new Error('数字人缺少已配置的头部节点');
  const center = head.getWorldPosition(new THREE.Vector3());
  center.y += 0.08;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  camera.position.copy(center).add(new THREE.Vector3(0, 0, 0.86));
  camera.lookAt(center);
  const face = new FaceController(model.scene, manifest);
  function render() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  new ResizeObserver(render).observe(canvas);
  render();
  return { face, render };
}
