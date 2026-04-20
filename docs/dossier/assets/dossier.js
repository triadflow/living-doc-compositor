/* Dossier reading behaviour — margin-note positioning, progress bar,
   active-note tracking as anchors enter view. */

function positionNotes(){
  if (document.body.dataset.layout !== 'margin') return;
  const rail = document.getElementById('rail');
  if (!rail || getComputedStyle(rail).display === 'none') return;
  const railRect = rail.getBoundingClientRect();
  const notes = rail.querySelectorAll('.note');
  let lastBottom = 0;
  notes.forEach(note => {
    const fn = note.dataset.fn;
    const anchor = document.querySelector(`.fn-ref[data-fn="${fn}"]`);
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const desiredTop = anchorRect.top - railRect.top;
    const top = Math.max(desiredTop, lastBottom + 14);
    note.style.top = top + 'px';
    note.style.left = '0';
    lastBottom = top + note.offsetHeight;
  });
}

function updateProgress(){
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
  const fill = document.getElementById('progress');
  if (fill) fill.style.width = pct + '%';
}

function updateActiveNote(){
  if (document.body.dataset.layout !== 'margin') {
    document.querySelectorAll('.note.active').forEach(n => n.classList.remove('active'));
    return;
  }
  const refs = [...document.querySelectorAll('.fn-ref')];
  const viewportMid = window.innerHeight * 0.35;
  let active = null;
  for (const r of refs){
    const top = r.getBoundingClientRect().top;
    if (top < viewportMid + 60 && top > -40) active = r.dataset.fn;
  }
  document.querySelectorAll('.note').forEach(n => {
    n.classList.toggle('active', n.dataset.fn === active);
  });
  document.querySelectorAll('.fn-ref').forEach(r => {
    r.classList.toggle('active', r.dataset.fn === active);
  });
}

let rafPending = false;
function onScroll(){
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    updateProgress();
    updateActiveNote();
    rafPending = false;
  });
}

window.addEventListener('scroll', onScroll, {passive:true});
window.addEventListener('resize', () => { positionNotes(); updateProgress(); });

positionNotes();
setTimeout(positionNotes, 50);
setTimeout(positionNotes, 300);
updateProgress();
updateActiveNote();
