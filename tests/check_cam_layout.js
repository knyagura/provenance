const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
const { window } = dom;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);

  // Drive to the new-listing camera step (listing photo capture screen).
  window.goTo('newlisting');
  await wait(50);

  const mainHtml = window.document.getElementById('main').innerHTML;
  const vfIdx = mainHtml.indexOf('class="viewfinder"');
  const ccIdx = mainHtml.indexOf('class="cam-controls"');
  const btnRowIdx = mainHtml.indexOf('class="btn-row"');

  console.log('viewfinder index:', vfIdx);
  console.log('cam-controls index:', ccIdx);
  console.log('btn-row index:', btnRowIdx);

  if (vfIdx === -1 || ccIdx === -1) {
    console.log('FAIL: could not find viewfinder or cam-controls on newlisting screen');
    process.exit(1);
  }

  // Find the viewfinder's closing </div> by naive balanced-tag scan from vfIdx.
  function findMatchingClose(str, openIdx) {
    // openIdx points at the start of `<div class="viewfinder">` tag content; find the actual '<div' start.
    const divStart = str.lastIndexOf('<div', openIdx);
    let depth = 0;
    let i = divStart;
    const re = /<div\b|<\/div>/g;
    re.lastIndex = divStart;
    let m;
    while ((m = re.exec(str))) {
      if (m[0] === '<div') depth++;
      else depth--;
      if (depth === 0) return m.index + m[0].length;
    }
    return -1;
  }

  const vfCloseIdx = findMatchingClose(mainHtml, vfIdx);
  console.log('viewfinder closes at:', vfCloseIdx);

  if (ccIdx > vfCloseIdx) {
    console.log('OK: cam-controls renders AFTER viewfinder closes (sibling, not nested)');
  } else {
    console.log('FAIL: cam-controls appears to be nested INSIDE viewfinder');
    process.exit(1);
  }

  if (!mainHtml.includes('shutter-btn') && !mainHtml.includes('cam-open-btn')) {
    console.log('FAIL: no camera control button found at all on this screen');
    process.exit(1);
  } else {
    console.log('OK: a camera control button (shutter or open-camera) is present in the markup');
  }

  console.log('\\nALL CAMERA-LAYOUT CHECKS PASSED');
})().catch(e => { console.error('ERROR', e); process.exit(1); });
