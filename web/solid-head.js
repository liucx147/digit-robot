import * as THREE from 'three';

// Authored project geometry; coordinates are metres in a front-facing head space.
export function createSolidHead() {
  const root = new THREE.Group(); root.name = 'SolidHead';
  const clay = new THREE.MeshPhysicalMaterial({ color: 0xc9c5ba, roughness: .55, metalness: .05, clearcoat: .1 });
  const lipMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9086, roughness: .65 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x302d2b, roughness: .95 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe4e2da, roughness: .36 });
  const irisMaterial = new THREE.MeshStandardMaterial({ color: 0x667a7b, roughness: .4 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x182022, roughness: .3 });
  function mesh(geometry, material, parent = root) {
    const value = new THREE.Mesh(geometry, material); value.castShadow = true; value.receiveShadow = true; parent.add(value); return value;
  }
  function ellipsoid(parent, material, position, scale) {
    const value = mesh(new THREE.SphereGeometry(1, 40, 28), material, parent);
    value.position.set(...position); value.scale.set(...scale); return value;
  }
  const gaussian = (x, y, cx, cy, wx, wy) => Math.exp(-(((x-cx)/wx)**2)-(((y-cy)/wy)**2));
  const geometry = new THREE.SphereGeometry(1, 144, 112);
  const positions = geometry.attributes.position;
  for (let i=0; i<positions.count; i++) {
    const nx=positions.getX(i), ny=positions.getY(i), nz=positions.getZ(i);
    const x=nx*.77*(1-.25*Math.max(0,-ny)), y=ny*1.1;
    let z=nz*.66;
    if (nz>0) {
      const front=Math.min(1,nz*1.8);
      let contour = .27*gaussian(x,y,0,-.08,.105,.17) + .095*gaussian(x,y,0,.12,.09,.31);
      for (const side of [-1,1]) {
        contour -= .105*gaussian(x,y,side*.28,.22,.205,.135);
        contour += .025*gaussian(x,y,side*.28,.40,.22,.065);
        contour += .042*gaussian(x,y,side*.40,-.20,.19,.22);
      }
      contour += .035*gaussian(x,y,0,-.47,.34,.16) + .05*gaussian(x,y,0,-.82,.28,.16);
      z += front*contour;
    }
    positions.setXYZ(i,x,y,z);
  }
  geometry.computeVertexNormals();
  function addMorphs(target, modifiers) {
    const base=target.attributes.position;
    target.morphAttributes.position=Object.entries(modifiers).map(([name,modify])=>{
      const attribute=base.clone();attribute.name=name;
      for(let i=0;i<base.count;i++) attribute.setXYZ(i,...modify(base.getX(i),base.getY(i),base.getZ(i)));
      return attribute;
    });
  }
  addMorphs(geometry, {
    jawOpen:(x,y,z)=>[x,y-(z>0?.12*Math.max(0,Math.min(1,(-y-.40)/.55)):0),z],
    smile:(x,y,z)=>[x,y+(z>0?.045*gaussian(Math.abs(x),y,.24,-.46,.15,.12):0),z],
    blink:(x,y,z)=>[x,y,z],
  });
  const head=mesh(geometry,clay);head.name='Head';
  for(const side of [-1,1]) {
    ellipsoid(root,clay,[side*.725,.025,-.035],[.105,.205,.12]);
    ellipsoid(root,lipMaterial,[side*.803,.025,-.018],[.012,.126,.070]);
    ellipsoid(root,clay,[side*.811,-.022,.022],[.015,.071,.042]);
  }
  mesh(new THREE.CylinderGeometry(.27,.325,.74,64),clay).position.set(0,-1.22,-.075);
  const torso=mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0,-1.94),new THREE.Vector2(.98,-1.94),new THREE.Vector2(1.02,-1.88),
    new THREE.Vector2(.94,-1.69),new THREE.Vector2(.73,-1.52),new THREE.Vector2(.42,-1.45),
    new THREE.Vector2(.30,-1.43),new THREE.Vector2(0,-1.43),
  ],96),clay);torso.scale.z=.56;torso.position.z=-.075;

  const eyes=[];
  function curved(points, material, radius=.012, parent=root) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),40,radius,8,false),material,parent);
  }
  for(const side of [-1,1]) {
    const bone=new THREE.Bone();bone.name=side<0?'EyeLeft':'EyeRight';bone.position.set(side*.28,.22,.535);root.add(bone);
    const eye=new THREE.Group();bone.add(eye);eyes.push(eye);
    ellipsoid(eye,white,[0,0,0],[.145,.077,.085]);
    ellipsoid(eye,irisMaterial,[0,0,.081],[.049,.049,.014]);
    ellipsoid(eye,pupilMaterial,[0,0,.094],[.023,.026,.005]);
    ellipsoid(eye,white,[-.012,.018,.099],[.008,.008,.003]);
    curved([[-.153,0,.061],[-.075,.063,.081],[.025,.072,.079],[.15,0,.060]],clay,.020,bone);
    curved([[-.153,0,.061],[-.06,-.059,.079],[.07,-.048,.076],[.15,0,.060]],clay,.016,bone);
    curved([[side*.115,.392,.57],[side*.24,.425,.615],[side*.40,.40,.557],[side*.46,.362,.50]],lipMaterial,.013);
  }
  const cavity=ellipsoid(root,recess,[0,-.468,.645],[.235,.012,.014]);
  function lip(upper) {
    function shape(jaw,smile) {
      const points=[];
      for(let i=0;i<=24;i++) {
        const t=i/24*2-1, x=t*.238;
        const arch=upper?.025*(1-t*t):-.020*(1-t*t);
        points.push(new THREE.Vector3(x,-.46+arch+smile*.065*t*t-(upper?0:jaw*.16),.653-.022*t*t));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,upper?.013:.018,8,false);
    }
    const base=shape(0,0), jaw=shape(1,0), smile=shape(0,1);
    base.morphAttributes.position=[jaw.attributes.position.clone(),smile.attributes.position.clone()];
    base.morphAttributes.position[0].name='jawOpen';base.morphAttributes.position[1].name='smile';
    jaw.dispose();smile.dispose();return mesh(base,lipMaterial);
  }
  lip(true);lip(false);
  const teeth=mesh(new THREE.BoxGeometry(.31,.032,.025),white);teeth.position.set(0,-.478,.655);teeth.visible=false;
  root.updateMatrixWorld(true);
  return {scene:root,applyFace(weights) {
    cavity.scale.y=.012+weights.jawOpen*.079;cavity.position.y=-.468-weights.jawOpen*.076;
    cavity.scale.x=.235+weights.smile*.016;
    teeth.visible=weights.jawOpen>.22;
    for(const eye of eyes) eye.scale.y=1-weights.blink*.95;
  }};
}
