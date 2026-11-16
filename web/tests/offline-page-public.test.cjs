const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {publicBrowser}=require('./browser-fixture.cjs');

test('current head and local sample operate with every nonlocal request blocked',async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try {
  const page=await app.browser.newPage(),foreign=[];
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==app.baseURL){foreign.push(url.href);return route.abort();}
   return route.continue();
  });
  await page.goto(app.baseURL);
  await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();
  await page.locator('#sample').click();await page.waitForFunction(()=>!document.querySelector('#play').disabled);
  await page.locator('#play').click();await page.waitForFunction(()=>!document.querySelector('#audio').paused);
  await page.locator('#stop').click();
  assert.equal(Number(await page.locator('#mouth-weight').innerText()),0);
  assert.deepEqual(foreign,[],'a fresh page must not depend on a remote CDN or model for local sample playback');
 }finally{await app.close();}
});

test('missing current geometry visibly fails without substituting a historical head',async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try {
  const page=await app.browser.newPage();
  await page.route('**/solid-head.js',route=>route.fulfill({status:404,body:'synthetic missing local geometry'}));
  await page.goto(app.baseURL);
  await page.locator('#status').filter({hasText:'资源加载失败'}).waitFor();
  assert.equal(await page.locator('#voice-connect').isDisabled(),true);
  assert.equal(await page.locator('#sample').isDisabled(),true);
 }finally{await app.close();}
});
