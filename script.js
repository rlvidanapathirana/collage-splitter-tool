(function(){
  document.getElementById('year').textContent = new Date().getFullYear();

  const canvasArea = document.getElementById('canvasArea');
  const controls = document.getElementById('controls');
  const colsInput = document.getElementById('colsInput');
  const rowsInput = document.getElementById('rowsInput');
  const applyUniformBtn = document.getElementById('applyUniformBtn');
  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const detectStatus = document.getElementById('detectStatus');
  const addColBtn = document.getElementById('addColBtn');
  const addRowBtn = document.getElementById('addRowBtn');
  const newImageBtn = document.getElementById('newImageBtn');
  const frameCounter = document.getElementById('frameCounter');
  const fileInput = document.getElementById('fileInput');

  const framesSection = document.getElementById('framesSection');
  const framesGrid = document.getElementById('framesGrid');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearBtn = document.getElementById('clearBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const selCountEl = document.getElementById('selCount');
  const totalCountEl = document.getElementById('totalCount');

  const modalOverlay = document.getElementById('modalOverlay');
  const modalClose = document.getElementById('modalClose');
  const modalList = document.getElementById('modalList');
  const modalHint = document.getElementById('modalHint');
  const shareAllBtn = document.getElementById('shareAllBtn');

  let img = null;
  let colLines = [];   // sorted fractions (0,1) — internal vertical dividers
  let rowLines = [];   // sorted fractions (0,1) — internal horizontal dividers
  let selected = new Set();
  let canvas, ctx, boardView, rulerTop, rulerLeft;
  let activeHandle = null; // {type:'col'|'row', index}
  const MIN_GAP = 0.02;
  let activeBlobUrls = [];

  // ---------------- upload handling ----------------
  function wireDropzone(el){
    el.addEventListener('click', () => fileInput.click());
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
  }
  wireDropzone(document.getElementById('dropzone'));
  fileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });

  function loadFile(file){
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const image = new Image();
      image.onload = () => setupImage(image, file.name);
      image.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function setupImage(image, name){
    img = image;
    selected.clear();
    activeHandle = null;

    canvasArea.innerHTML = `
      <div class="canvas-panel">
        <div class="sprocket-row" id="sprocketTop"></div>
        <div class="board-grid">
          <div class="corner"></div>
          <div class="ruler-top" id="rulerTop"></div>
          <div class="ruler-left" id="rulerLeft"></div>
          <div class="board-view" id="boardView"><canvas id="board"></canvas></div>
        </div>
        <div class="sprocket-row" id="sprocketBottom"></div>
      </div>`;

    canvas = document.getElementById('board');
    ctx = canvas.getContext('2d');
    boardView = document.getElementById('boardView');
    rulerTop = document.getElementById('rulerTop');
    rulerLeft = document.getElementById('rulerLeft');

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    buildSprockets();
    controls.style.display = 'flex';
    framesSection.style.display = 'block';
    frameCounter.textContent = `${img.naturalWidth}×${img.naturalHeight}px — ${name}`;

    const c = clamp(parseInt(colsInput.value)||3,1,12);
    const r = clamp(parseInt(rowsInput.value)||3,1,12);
    setUniformGrid(c,r);

    rulerTop.addEventListener('pointerdown', onRulerPointerDown('col'));
    rulerLeft.addEventListener('pointerdown', onRulerPointerDown('row'));

    detectStatus.textContent = '';
    render();
  }

  function buildSprockets(){
    const holes = 26;
    ['sprocketTop','sprocketBottom'].forEach(id=>{
      const el = document.getElementById(id);
      el.innerHTML = '';
      for(let i=0;i<holes;i++){ el.appendChild(document.createElement('span')); }
    });
  }

  function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

  // ---------------- grid model ----------------
  function setUniformGrid(c,r){
    colLines = []; for(let i=1;i<c;i++) colLines.push(i/c);
    rowLines = []; for(let i=1;i<r;i++) rowLines.push(i/r);
    selected.clear();
  }
  function boundariesX(){ return [0, ...colLines, 1]; }
  function boundariesY(){ return [0, ...rowLines, 1]; }

  // ---------------- render: canvas + rulers + frame thumbnails ----------------
  function render(){
    if(!img) return;
    drawCanvas();
    renderHandles();
    regenerateFrames();
  }

  function drawCanvas(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);

    ctx.strokeStyle = 'rgba(234,242,236,0.5)';
    ctx.lineWidth = Math.max(1, canvas.width/900);
    ctx.setLineDash([canvas.width/220, canvas.width/220]);
    colLines.forEach(f=>{
      const x = f*canvas.width;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
    });
    rowLines.forEach(f=>{
      const y = f*canvas.height;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(201,162,39,0.9)';
    ctx.lineWidth = Math.max(2, canvas.width/450);
    ctx.strokeRect(1,1,canvas.width-2,canvas.height-2);
  }

  function renderHandles(){
    rulerTop.querySelectorAll('.handle, .remove-tip').forEach(n=>n.remove());
    rulerLeft.querySelectorAll('.handle, .remove-tip').forEach(n=>n.remove());

    colLines.forEach((f,i)=>{
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'handle' + (activeHandle && activeHandle.type==='col' && activeHandle.index===i ? ' active':'');
      h.style.left = (f*100)+'%';
      h.innerHTML = '<span class="grip"></span>';
      h.addEventListener('pointerdown', (e)=> startDrag(e,'col',i));
      h.addEventListener('click', (e)=> onHandleTap(e,'col',i));
      rulerTop.appendChild(h);
    });
    rowLines.forEach((f,i)=>{
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'handle' + (activeHandle && activeHandle.type==='row' && activeHandle.index===i ? ' active':'');
      h.style.top = (f*100)+'%';
      h.innerHTML = '<span class="grip"></span>';
      h.addEventListener('pointerdown', (e)=> startDrag(e,'row',i));
      h.addEventListener('click', (e)=> onHandleTap(e,'row',i));
      rulerLeft.appendChild(h);
    });

    if(activeHandle){
      const tip = document.createElement('div');
      tip.className = 'remove-tip';
      tip.textContent = 'Remove';
      if(activeHandle.type==='col'){
        const f = colLines[activeHandle.index];
        tip.style.left = (f*100)+'%';
        tip.style.top = '-26px';
        tip.style.transform = 'translateX(-50%)';
        tip.addEventListener('click', (e)=>{ e.stopPropagation(); removeLine('col',activeHandle.index); });
        rulerTop.appendChild(tip);
      } else {
        const f = rowLines[activeHandle.index];
        tip.style.top = (f*100)+'%';
        tip.style.left = '24px';
        tip.style.transform = 'translateY(-50%)';
        tip.addEventListener('click', (e)=>{ e.stopPropagation(); removeLine('row',activeHandle.index); });
        rulerLeft.appendChild(tip);
      }
    }
  }

  function onHandleTap(e, type, index){
    e.stopPropagation();
    if(activeHandle && activeHandle.type===type && activeHandle.index===index){
      activeHandle = null;
    } else {
      activeHandle = {type, index};
    }
    renderHandles();
  }

  function removeLine(type, index){
    if(type==='col') colLines.splice(index,1); else rowLines.splice(index,1);
    activeHandle = null;
    selected.clear();
    render();
  }

  // ---------------- dragging handles (Pointer Events — mouse + touch) ----------------
  function startDrag(e, type, index){
    e.preventDefault();
    e.stopPropagation();
    activeHandle = {type, index};
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const rulerRect = (type==='col' ? rulerTop : rulerLeft).getBoundingClientRect();
    let moved = false;

    function onMove(ev){
      moved = true;
      let frac;
      if(type==='col'){
        frac = (ev.clientX - rulerRect.left) / rulerRect.width;
      } else {
        frac = (ev.clientY - rulerRect.top) / rulerRect.height;
      }
      const arr = type==='col' ? colLines : rowLines;
      const lower = index===0 ? 0 : arr[index-1];
      const upper = index===arr.length-1 ? 1 : arr[index+1];
      frac = clamp(frac, lower+MIN_GAP, upper-MIN_GAP);
      arr[index] = frac;
      drawCanvas();
      renderHandlePositionOnly(type,index,frac);
    }
    function onUp(ev){
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      if(moved){ selected.clear(); render(); }
    }
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  function renderHandlePositionOnly(type,index,frac){
    const ruler = type==='col' ? rulerTop : rulerLeft;
    const handles = ruler.querySelectorAll('.handle');
    const h = handles[index];
    if(h){ if(type==='col') h.style.left=(frac*100)+'%'; else h.style.top=(frac*100)+'%'; }
  }

  function onRulerPointerDown(type){
    return function(e){
      if(e.target.closest('.handle') || e.target.closest('.remove-tip')) return;
      const rect = this.getBoundingClientRect();
      const frac = type==='col'
        ? (e.clientX-rect.left)/rect.width
        : (e.clientY-rect.top)/rect.height;
      addLineAt(type, clamp(frac,0.01,0.99));
    };
  }

  function addLineAt(type, frac){
    const arr = type==='col' ? colLines : rowLines;
    const all = [0, ...arr, 1];
    for(const v of all){ if(Math.abs(v-frac) < MIN_GAP) return; }
    arr.push(frac);
    arr.sort((a,b)=>a-b);
    activeHandle = null;
    selected.clear();
    render();
  }

  function addLineAtLargestGap(type){
    const arr = type==='col' ? colLines : rowLines;
    const all = [0, ...arr, 1];
    let bestGap=-1, bestMid=0.5;
    for(let i=0;i<all.length-1;i++){
      const gap = all[i+1]-all[i];
      if(gap>bestGap){ bestGap=gap; bestMid=(all[i]+all[i+1])/2; }
    }
    if(bestGap > MIN_GAP*2.5){ arr.push(bestMid); arr.sort((a,b)=>a-b); selected.clear(); render(); }
  }
  addColBtn.addEventListener('click', ()=> addLineAtLargestGap('col'));
  addRowBtn.addEventListener('click', ()=> addLineAtLargestGap('row'));

  // ---------------- frame thumbnail selection grid ----------------
  function regenerateFrames(){
    if(!img) return;
    const bx = boundariesX(), by = boundariesY();
    framesGrid.innerHTML = '';
    const THUMB = 200;

    for(let r=0;r<by.length-1;r++){
      for(let c=0;c<bx.length-1;c++){
        const key = `${r}_${c}`;
        const sx = bx[c]*img.naturalWidth, sy = by[r]*img.naturalHeight;
        const sw = (bx[c+1]-bx[c])*img.naturalWidth, sh = (by[r+1]-by[r])*img.naturalHeight;

        const tmp = document.createElement('canvas');
        const ratio = sw/sh;
        tmp.width = ratio >= 1 ? THUMB : Math.max(1,Math.round(THUMB*ratio));
        tmp.height = ratio >= 1 ? Math.max(1,Math.round(THUMB/ratio)) : THUMB;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'frame-thumb' + (selected.has(key) ? ' selected' : '');
        btn.dataset.key = key;
        btn.innerHTML = `<img src="${tmp.toDataURL('image/jpeg',0.82)}" alt="frame ${r+1},${c+1}">
          <span class="tick"></span>
          <span class="idx">R${r+1}·C${c+1}</span>`;
        btn.addEventListener('click', () => toggleFrame(key, btn));
        framesGrid.appendChild(btn);
      }
    }
    updateSummary();
  }

  function toggleFrame(key, btn){
    if(selected.has(key)){ selected.delete(key); btn.classList.remove('selected'); }
    else { selected.add(key); btn.classList.add('selected'); }
    updateSummary();
  }

  function updateSummary(){
    const total = (boundariesX().length-1) * (boundariesY().length-1);
    selCountEl.textContent = selected.size;
    totalCountEl.textContent = total;
    downloadBtn.disabled = selected.size===0;
  }

  // ---------------- uniform reset ----------------
  document.querySelectorAll('[data-adj]').forEach(btn=>{
    btn.addEventListener('click', () => {
      const which = btn.dataset.adj, dir = parseInt(btn.dataset.dir);
      if(which==='cols'){ colsInput.value = clamp((parseInt(colsInput.value)||1)+dir,1,12); }
      else { rowsInput.value = clamp((parseInt(rowsInput.value)||1)+dir,1,12); }
    });
  });
  applyUniformBtn.addEventListener('click', () => {
    if(!img) return;
    const c = clamp(parseInt(colsInput.value)||1,1,12);
    const r = clamp(parseInt(rowsInput.value)||1,1,12);
    colsInput.value=c; rowsInput.value=r;
    activeHandle = null;
    setUniformGrid(c,r);
    detectStatus.textContent = '';
    render();
  });

  selectAllBtn.addEventListener('click', () => {
    selected.clear();
    const cCount = boundariesX().length-1, rCount = boundariesY().length-1;
    for(let r=0;r<rCount;r++) for(let c=0;c<cCount;c++) selected.add(`${r}_${c}`);
    framesGrid.querySelectorAll('.frame-thumb').forEach(b=>b.classList.add('selected'));
    updateSummary();
  });
  clearBtn.addEventListener('click', () => {
    selected.clear();
    framesGrid.querySelectorAll('.frame-thumb').forEach(b=>b.classList.remove('selected'));
    updateSummary();
  });

  newImageBtn.addEventListener('click', () => {
    img = null; selected.clear(); activeHandle = null;
    controls.style.display='none';
    framesSection.style.display='none';
    framesGrid.innerHTML='';
    fileInput.value='';
    canvasArea.innerHTML = `
      <div class="dropzone" id="dropzone">
        <div class="icon"></div>
        <h2>Load collage image</h2>
        <p>Tap to browse, or drag a .jpg / .png collage here. Set up the grid, then pick the frames you want below.</p>
      </div>`;
    wireDropzone(document.getElementById('dropzone'));
    frameCounter.textContent = 'NO FILM LOADED';
  });

  // ---------------- smart auto-detect (non-uniform capable) ----------------
  autoDetectBtn.addEventListener('click', () => {
    if(!img) return;
    detectStatus.textContent = 'scanning for seams…';
    setTimeout(()=>{
      const result = detectGrid(img);
      colLines = result.colLines;
      rowLines = result.rowLines;
      colsInput.value = colLines.length+1;
      rowsInput.value = rowLines.length+1;
      selected.clear();
      activeHandle = null;
      render();
      detectStatus.textContent = result.confident
        ? `detected ${colLines.length+1}×${rowLines.length+1} — drag any tab to fine-tune`
        : `seams were faint — rough guess made, please fine-tune the lines`;
    }, 30);
  });

  function detectGrid(image){
    const maxW = 640;
    const scale = Math.min(1, maxW/image.naturalWidth);
    const w = Math.max(2, Math.round(image.naturalWidth*scale));
    const h = Math.max(2, Math.round(image.naturalHeight*scale));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(image,0,0,w,h);
    const data = octx.getImageData(0,0,w,h).data;
    const gray = new Float32Array(w*h);
    for(let i=0;i<w*h;i++){
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      gray[i] = 0.299*r+0.587*g+0.114*b;
    }

    const colProfile = new Float32Array(w);
    for(let x=1;x<w-1;x++){
      let sum=0;
      for(let y=0;y<h;y+=1){ sum += Math.abs(gray[y*w+x+1]-gray[y*w+x-1]); }
      colProfile[x] = sum/h;
    }
    const rowProfile = new Float32Array(h);
    for(let y=1;y<h-1;y++){
      let sum=0;
      for(let x=0;x<w;x+=1){ sum += Math.abs(gray[(y+1)*w+x]-gray[(y-1)*w+x]); }
      rowProfile[y] = sum/w;
    }

    smooth(colProfile,3); smooth(rowProfile,3);

    const colPeaks = findPeaks(colProfile, w, Math.round(w*0.035));
    const rowPeaks = findPeaks(rowProfile, h, Math.round(h*0.035));

    const cLines = colPeaks.map(p=>p/w).filter(f=>f>0.015 && f<0.985);
    const rLines = rowPeaks.map(p=>p/h).filter(f=>f>0.015 && f<0.985);

    const confident = cLines.length>0 || rLines.length>0;

    if(!confident){
      const fallback = uniformFallback(gray,w,h);
      return { colLines: fallback.cols, rowLines: fallback.rows, confident:false };
    }

    return { colLines: cLines.sort((a,b)=>a-b), rowLines: rLines.sort((a,b)=>a-b), confident:true };
  }

  function smooth(arr, radius){
    const copy = arr.slice();
    for(let i=0;i<arr.length;i++){
      let sum=0, n=0;
      for(let k=-radius;k<=radius;k++){
        const j=i+k; if(j>=0 && j<arr.length){ sum+=copy[j]; n++; }
      }
      arr[i] = sum/n;
    }
  }

  function findPeaks(profile, len, minGapPx){
    const mean = profile.reduce((a,b)=>a+b,0)/len;
    let variance = 0;
    for(let i=0;i<len;i++) variance += (profile[i]-mean)*(profile[i]-mean);
    const std = Math.sqrt(variance/len);
    const threshold = mean + std*1.4;

    const candidates = [];
    for(let i=2;i<len-2;i++){
      if(profile[i] > threshold && profile[i]>=profile[i-1] && profile[i]>=profile[i+1]){
        candidates.push({pos:i, val:profile[i]});
      }
    }
    candidates.sort((a,b)=>b.val-a.val);
    const kept = [];
    for(const cand of candidates){
      if(kept.every(k=>Math.abs(k-cand.pos)>=minGapPx)) kept.push(cand.pos);
      if(kept.length>=11) break;
    }
    return kept;
  }

  function uniformFallback(gray,w,h){
    function edgeAtX(x){
      const x0=clamp(x-2,0,w-1), x1=clamp(x+2,0,w-1);
      let sum=0,n=0;
      for(let y=0;y<h;y+=2){ sum+=Math.abs(gray[y*w+x1]-gray[y*w+x0]); n++; }
      return sum/n;
    }
    function edgeAtY(y){
      const y0=clamp(y-2,0,h-1), y1=clamp(y+2,0,h-1);
      let sum=0,n=0;
      for(let x=0;x<w;x+=2){ sum+=Math.abs(gray[y1*w+x]-gray[y0*w+x]); n++; }
      return sum/n;
    }
    function scoreCols(c){ if(c<2) return 0; let t=0; for(let i=1;i<c;i++) t+=edgeAtX(Math.round(i*w/c)); return t/(c-1); }
    function scoreRows(r){ if(r<2) return 0; let t=0; for(let i=1;i<r;i++) t+=edgeAtY(Math.round(i*h/r)); return t/(r-1); }
    let bestC=1,bestCS=0; for(let c=1;c<=8;c++){ const s=scoreCols(c); if(s>bestCS){bestCS=s;bestC=c;} }
    let bestR=1,bestRS=0; for(let r=1;r<=8;r++){ const s=scoreRows(r); if(s>bestRS){bestRS=s;bestR=r;} }
    const cols=[]; for(let i=1;i<bestC;i++) cols.push(i/bestC);
    const rows=[]; for(let i=1;i<bestR;i++) rows.push(i/bestR);
    return {cols, rows};
  }

  // ---------------- save / download (mobile-safe) ----------------
  // Mobile browsers commonly block automated multi-file downloads triggered
  // from a single click. So instead we: (1) offer the native Web Share sheet
  // when the platform supports sharing multiple files at once, and always
  // (2) list every selected frame as its own real tappable download link,
  // since each individual tap is its own genuine user gesture and is never
  // blocked.
  function cellBlob(r,c){
    const bx = boundariesX(), by = boundariesY();
    const sx = bx[c]*img.naturalWidth, sy = by[r]*img.naturalHeight;
    const sw = (bx[c+1]-bx[c])*img.naturalWidth, sh = (by[r+1]-by[r])*img.naturalHeight;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1,Math.round(sw)); tmp.height = Math.max(1,Math.round(sh));
    const tctx = tmp.getContext('2d');
    tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
    return new Promise(resolve => tmp.toBlob(b => resolve(b), 'image/png'));
  }

  function clearModalUrls(){
    activeBlobUrls.forEach(u => URL.revokeObjectURL(u));
    activeBlobUrls = [];
  }

  downloadBtn.addEventListener('click', async () => {
    if(!img || selected.size===0) return;
    const keys = Array.from(selected);
    downloadBtn.disabled = true;
    const originalLabel = downloadBtn.textContent;
    downloadBtn.textContent = 'Preparing…';

    clearModalUrls();
    modalList.innerHTML = '';

    const items = [];
    for(const key of keys){
      const [r,c] = key.split('_').map(Number);
      const blob = await cellBlob(r,c);
      const filename = `frame_r${r+1}c${c+1}.png`;
      items.push({ r, c, blob, filename });
    }

    // build the always-available list of individual save links
    items.forEach(item => {
      const url = URL.createObjectURL(item.blob);
      activeBlobUrls.push(url);
      const row = document.createElement('a');
      row.className = 'modal-row';
      row.href = url;
      row.download = item.filename;
      row.innerHTML = `
        <img src="${url}" alt="">
        <span class="meta">
          <span class="fname">${item.filename}</span>
          <span class="save-hint">tap to save</span>
        </span>
        <span class="save-icon">&darr;</span>`;
      row.addEventListener('click', () => {
        row.classList.add('saved');
        row.querySelector('.save-hint').textContent = 'saved';
      });
      modalList.appendChild(row);
    });

    modalHint.textContent = items.length > 1
      ? 'Tap each frame below to save it to your device.'
      : 'Tap the frame below to save it to your device.';

    // offer native share sheet when the platform can share multiple files
    shareAllBtn.style.display = 'none';
    if(navigator.canShare && navigator.share){
      try{
        const files = items.map(it => new File([it.blob], it.filename, {type:'image/png'}));
        if(navigator.canShare({files})){
          shareAllBtn.style.display = 'flex';
          shareAllBtn.onclick = async () => {
            try{ await navigator.share({files, title:'Collage frames'}); }
            catch(err){ /* user cancelled or unsupported — the list below still works */ }
          };
        }
      }catch(err){ /* canShare not available for this file set */ }
    }

    downloadBtn.textContent = originalLabel;
    downloadBtn.disabled = selected.size===0;
    modalOverlay.classList.add('open');
  });

  modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', (e) => { if(e.target===modalOverlay) modalOverlay.classList.remove('open'); });

})();
