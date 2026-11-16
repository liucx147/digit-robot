import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';

// All face contributors terminate here; later gaze input can use the same boundary.
export class FaceController {
  constructor(root, manifest, applyGeometry = () => {}) {
    this.applyGeometry = applyGeometry;
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
    this.applyGeometry(weights);
    return weights;
  }
}

export async function loadAvatar(canvas, manifest, manifestURL) {
  const solid = manifest.type === 'solid-head';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  canvas.dataset.renderer = JSON.stringify({
    renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    webgl_version: gl.getParameter(gl.VERSION),
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(solid ? 0xe2e7e5 : 0x1d2b3a);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, solid ? 0x78766e : 0x64768a, solid ? 1.4 : 2));
  const light = new THREE.DirectionalLight(0xffffff, solid ? 2.8 : 2);
  light.position.set(solid ? -3 : 1, solid ? 4 : 2, solid ? 5 : 3);
  scene.add(light);
  let model;
  if (solid) {
    const { createSolidHead } = await import(new URL(manifest.file, manifestURL).href);
    model = createSolidHead();
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    light.castShadow = true; light.shadow.mapSize.set(1024,1024);
    Object.assign(light.shadow.camera,{left:-2,right:2,top:2,bottom:-2,near:.1,far:15});
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -.0005;
    const rim = new THREE.DirectionalLight(0xd3e3ec,2);rim.position.set(3,2,-3);scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1,96), new THREE.ShadowMaterial({opacity:.15}));
    floor.rotation.x = -Math.PI/2;floor.position.y = -1.952;floor.receiveShadow = true;scene.add(floor);
  } else model = await new GLTFLoader().loadAsync(new URL(manifest.file, manifestURL).href);
  scene.add(model.scene);model.scene.updateMatrixWorld(true);
  const head = model.scene.getObjectByName(manifest.headBone);
  if (!head) throw new Error('数字人缺少已配置的头部节点');
  const center = solid ? new THREE.Vector3(0,-.40,0) : head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.08,0));
  const camera = new THREE.PerspectiveCamera(solid ? 38 : 32,1,.01,100);
  camera.position.copy(center).add(new THREE.Vector3(0,0,solid ? 5.25 : .86));camera.lookAt(center);
  const face = new FaceController(model.scene,manifest,model.applyFace);
  function render() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width*renderer.getPixelRatio()) || canvas.height !== Math.round(height*renderer.getPixelRatio())) renderer.setSize(width,height,false);
    camera.aspect = width/height;camera.updateProjectionMatrix();renderer.render(scene,camera);
  }
  new ResizeObserver(render).observe(canvas);
  if (solid) {const { attachAvatarView }=await import('./avatar-view.js');attachAvatarView(canvas,camera,center,render);}
  else for (const selector of ['.avatar-view','#view-help','#view-label']) document.querySelector(selector)?.setAttribute('hidden','');
  canvas.dataset.avatar = JSON.stringify({name:manifest.name,version:manifest.version,type:manifest.type || 'gltf',sha256:manifest.sha256,file:new URL(manifest.file,manifestURL).href});
  render();return {face,render};
}
