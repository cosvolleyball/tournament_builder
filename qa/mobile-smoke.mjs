import { chromium } from 'playwright';

const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--no-sandbox']});
const results = [];
const errors = [];
async function run(name, fn) {
  try { const detail = await fn(); results.push({name,status:'PASS',detail}); }
  catch(err) { results.push({name,status:'FAIL',error:String(err).slice(0,500)}); }
}
async function makePage(width,height=850){
  const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:width<=420,hasTouch:width<=420});
  page.on('pageerror', e=>errors.push({width,message:String(e)}));
  return page;
}
async function checkNoOverflow(page,label){
 const dims=await page.evaluate(()=>({inner:window.innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 if(dims.scroll>dims.inner+4)throw Error(label+' viewport horizontal overflow '+JSON.stringify(dims));
 return dims;
}
const live='https://cosvolleyball.github.io/tournament_builder/';
for(const width of [360,390,768,1280]){
 await run('Live public landing page @ '+width+'px',async()=>{
  const page=await makePage(width);
  try {
    await page.goto(live,{waitUntil:'domcontentloaded',timeout:45000});
    await page.getByRole('heading',{name:/Find your tournament/i}).waitFor({timeout:30000});
    await page.getByRole('heading',{name:/Published tournaments/i}).waitFor();
    const dims=await checkNoOverflow(page,'live');
    const signin=page.getByRole('button',{name:/Organizer sign in/i}).last();
    await signin.click();
    const dlg=page.getByRole('dialog',{name:/Organizer sign in/i});
    await dlg.waitFor();
    const rect=await dlg.boundingBox();
    if(!rect || rect.x < -2 || rect.x+rect.width > width+2) throw Error('Sign in modal exceeds phone viewport '+JSON.stringify(rect));
    await dlg.getByLabel('Email address').waitFor();
    await page.getByRole('button',{name:'Close sign in'}).click();
    await dlg.waitFor({state:'hidden'});
    return {width,dims,loginModal:'fits'};
  } finally {await page.close();}
 });
}
for(const width of [360,390,768]){
 await run('Local demo organizer/scoring @ '+width+'px',async()=>{
  const page=await makePage(width);
  try {
    await page.goto('http://127.0.0.1:4177/',{waitUntil:'domcontentloaded',timeout:20000});
    await page.getByRole('button',{name:/Create your first tournament|Create tournament/}).first().click();
    await page.locator('#t-name').fill('Mobile QA Cup');
    await page.locator('#division-name').fill('Coed BB');
    await page.locator('#teams').fill('Eagles\nBears\nFalcons\nWolves');
    await page.locator('#poolCount').fill('2');
    await page.locator('#sets').selectOption('1');
    await page.locator('#bracket-format-0').selectOption('double');
    await checkNoOverflow(page,'wizard');
    await page.getByRole('button',{name:/^Create tournament/}).last().click();
    await page.getByRole('heading',{name:'Mobile QA Cup'}).waitFor({timeout:15000});
    await checkNoOverflow(page,'tournament detail');
    await page.getByRole('button',{name:/Publish tournament/}).click();
    await page.getByRole('button',{name:/Start pool play/}).click();
    await page.getByRole('tab',{name:/Pool play & scores/}).click();
    await page.getByRole('button',{name:/Enter score/}).first().click();
    const dlg=page.getByRole('dialog');
    await dlg.waitFor();
    const rect=await dlg.boundingBox();
    if(!rect || rect.x<-2 || rect.x+rect.width>width+2)throw Error('Score dialog overflows viewport '+JSON.stringify(rect));
    const inputs=dlg.locator('input[aria-label^="Set 1"]');
    if(await inputs.count()!==2)throw Error('Missing set scoring fields');
    await inputs.nth(0).fill('21');
    await inputs.nth(1).fill('19');
    await dlg.getByRole('button',{name:/Save result/}).click();
    await dlg.waitFor({state:'hidden',timeout:10000});
    if(await page.getByText('Final score').count()<1)throw Error('Score not reflected in pool');
    await page.getByRole('tab',{name:/Playoffs/i}).click();
    const bracket=page.getByRole('region',{name:/Championship upper bracket preview/i});
    await bracket.waitFor();
    const overflow=await bracket.evaluate(el=>({scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    if(width<=390 && overflow.scrollWidth<=overflow.clientWidth)throw Error('Preview bracket should scroll horizontally on phone');
    if(overflow.scrollWidth>overflow.clientWidth){
      await bracket.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      const scrolled=await bracket.evaluate(el=>el.scrollLeft);
      if(scrolled<=0)throw Error('Bracket viewport is not horizontally scrollable');
    }
    await checkNoOverflow(page,'playoff preview');
    return {width,created:true,published:true,scored:true,modal:'fits',bracket:'scrollable',bracketWidth:overflow};
  } finally {await page.close();}
 });
}
await browser.close();
console.log('MOBILE_QA_RESULTS='+JSON.stringify(results));
if(errors.length)console.log('JS_ERRORS='+JSON.stringify(errors.slice(0,10)));
if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
