const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {publicBrowser}=require('./browser-fixture.cjs');
let browser,baseURL,close;
before(async()=>{({browser,baseURL,close}=await publicBrowser(path.resolve(__dirname,'..')));await fs.mkdir(path.resolve(__dirname,'../../artifacts/solid-head'),{recursive:true});});
after(async()=>{await close?.();});
test('a solid head can be viewed from side and back, then reset to the identical initial view',async()=>{
 const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(10000);
 try{
  await page.goto(baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
  assert.match(await page.locator('#avatar-name').textContent(),/实体三维头部/);
  const canvas=page.getByLabel('三维数字人头部'), initial=await canvas.screenshot();
  await fs.writeFile(path.resolve(__dirname,'../../artifacts/solid-head/initial.png'),initial);
  await page.getByRole('button',{name:'侧面',exact:true}).click();const side=await canvas.screenshot();assert.notDeepEqual(side,initial);
  await fs.writeFile(path.resolve(__dirname,'../../artifacts/solid-head/side.png'),side);
  await page.getByRole('button',{name:'背面',exact:true}).click();const back=await canvas.screenshot();assert.notDeepEqual(back,side);
  await fs.writeFile(path.resolve(__dirname,'../../artifacts/solid-head/back.png'),back);
  await page.getByRole('button',{name:'复位视角',exact:true}).click();assert.deepEqual(await canvas.screenshot(),initial);
  const bounds=await canvas.boundingBox();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.45);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+bounds.height*.55,{steps:8});await page.mouse.up();
  assert.notDeepEqual(await canvas.screenshot(),initial);
  await canvas.focus();await page.keyboard.press('ArrowLeft');const beforeZoom=await canvas.screenshot();await page.mouse.wheel(0,-280);assert.notDeepEqual(await canvas.screenshot(),beforeZoom);
 }finally{await page.close();}
});
test('turning the model during real audio preserves playback and Stop still closes the mouth',async()=>{
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 try{
  await page.goto(baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
  const rate=16000,b=Buffer.alloc(44+rate*4*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
  for(let i=0;i<rate*4;i++)b.writeInt16LE(Math.round(9000*Math.sin(2*Math.PI*220*i/rate)),44+2*i);
  await page.getByLabel('选择本地音频',{exact:true}).setInputFiles({name:'rotation-diagnostic-tone.wav',mimeType:'audio/wav',buffer:b});
  await page.getByRole('button',{name:'播放音频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);
  const t=await page.locator('audio').evaluate(a=>a.currentTime);
  await page.getByRole('button',{name:'侧面',exact:true}).click();await page.waitForTimeout(150);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);assert.ok(await page.locator('audio').evaluate(a=>a.currentTime)>t);
  await page.getByRole('button',{name:'停止',exact:true}).click();assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByLabel('嘴部开合').textContent(),'0.00');
 }finally{await page.close();}
});
