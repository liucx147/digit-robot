// Inspection changes only the camera; face weights and audio keep their own clocks.
export function attachAvatarView(canvas,camera,target,render) {
  let yaw=.28,pitch=.035,distance=5.25,drag;
  const label=document.querySelector('#view-label');
  function update() {
    pitch=Math.max(-.7,Math.min(.7,pitch));distance=Math.max(3.25,Math.min(7,distance));
    camera.position.set(target.x+distance*Math.sin(yaw)*Math.cos(pitch),target.y+distance*Math.sin(pitch),target.z+distance*Math.cos(yaw)*Math.cos(pitch));
    camera.lookAt(target);
    if(label)label.textContent=`水平 ${Math.round(yaw*180/Math.PI)}° · 距离 ${distance.toFixed(2)}`;
    render();
  }
  canvas.style.touchAction='none';
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||drag)return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);canvas.focus();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    yaw-=(event.clientX-drag.x)*.009;pitch+=(event.clientY-drag.y)*.006;
    drag.x=event.clientX;drag.y=event.clientY;update();
  });
  const release=event=>{if(drag?.id===event.pointerId)drag=undefined;};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
  canvas.addEventListener('wheel',event=>{event.preventDefault();distance*=Math.exp(Math.max(-400,Math.min(400,event.deltaY))*.001);update();},{passive:false});
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='Home'){yaw=.28;pitch=.035;distance=5.25;}
    if(event.key==='ArrowLeft')yaw-=Math.PI/12;if(event.key==='ArrowRight')yaw+=Math.PI/12;
    if(event.key==='ArrowUp')pitch+=.1;if(event.key==='ArrowDown')pitch-=.1;
    if(event.key==='+')distance-=.3;if(event.key==='-')distance+=.3;update();
  });
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
    const value=button.dataset.view;
    if(value==='reset'){yaw=.28;pitch=.035;distance=5.25;}
    else if(value==='in')distance-=.35;
    else if(value==='out')distance+=.35;
    else{yaw=Number(value)*Math.PI/180;pitch=.035;}
    update();
  });
  update();
}
