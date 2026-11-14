// Decode the original media and observe pixels. No source schedules or controller records.
async function recordedMouthReferences(page) {
  await page.locator('#review-video').scrollIntoViewIfNeeded();
  return page.locator('#review-video').evaluate(async video=>{
    video.pause();
    if(video.currentTime!==0)await new Promise(resolve=>{video.addEventListener('seeked',resolve,{once:true});video.currentTime=0;});
    return new Promise((resolve,reject)=>{
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const samples=[];let opened,closed,callback;
      const finish=error=>{clearTimeout(deadline);video.pause();video.cancelVideoFrameCallback(callback);video.removeEventListener('ended',ended);if(error){error.message+=`; observed ${samples.length} frames; open=${JSON.stringify(opened&&{pts:opened.pts,bright:opened.bright,contrast:opened.contrast})}; closed=${JSON.stringify(closed&&{pts:closed.pts,bright:closed.bright,contrast:closed.contrast})}`;reject(error);}else resolve({opened,closed,samples});};
      const ended=()=>finish(Error('No clear open/closed mouth references in the decoded recording'));
      const deadline=setTimeout(()=>finish(Error('Decoded mouth observation timed out')),15000);
      const observe=(now,metadata)=>{
        context.drawImage(video,0,0);
        const pixels=context.getImageData(270,340,60,30).data;
        let bright=0;for(let p=0;p<pixels.length;p+=4)if(pixels[p]>235&&pixels[p+1]>235&&pixels[p+2]>235)bright++;
        // Skin in the top four ROI rows is a local color reference. This
        // avoids counting clipped pale skin as white inner-mouth pixels.
        const channels=[[],[],[]];
        for(let y=0;y<4;y++)for(let x=0;x<60;x++)for(let c=0;c<3;c++)channels[c].push(pixels[(y*60+x)*4+c]);
        const skin=channels.map(values=>values.sort((a,b)=>a-b)[120]);
        let contrast=0;
        for(let y=8;y<28;y++)for(let x=8;x<52;x++){
          const p=(y*60+x)*4;
          if(Math.max(...skin.map((value,c)=>Math.abs(pixels[p+c]-value)))>=20)contrast++;
        }
        const value={pts:metadata.mediaTime,bright,contrast};samples.push(value);
        if(!closed||contrast<closed.contrast)closed={...value,png:canvas.toDataURL('image/png').split(',')[1]};
        if(!opened||contrast>opened.contrast)opened={...value,png:canvas.toDataURL('image/png').split(',')[1]};
        if(closed.contrast<=80&&opened.contrast>=closed.contrast+30&&opened.contrast>=closed.contrast*1.5)return finish();
        if(metadata.mediaTime>=10)return ended();
        callback=video.requestVideoFrameCallback(observe);
      };
      video.addEventListener('ended',ended,{once:true});
      callback=video.requestVideoFrameCallback(observe);
      video.play().catch(finish);
    });
  });
}
module.exports={recordedMouthReferences};
