(function(){
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function create(tag, attrs, ...children){
    const el = document.createElement(tag);
    if (attrs){ Object.keys(attrs).forEach(k=>{
      if (k === 'class') el.className = attrs[k];
      else if (k === 'dataset') { Object.keys(attrs.dataset).forEach(dk=> el.dataset[dk]=attrs.dataset[dk]); }
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.startsWith('aria-')) el.setAttribute(k, attrs[k]);
      else if (k === 'tabindex') el.setAttribute('tabindex', attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }); }
    children.forEach(c=>{ if (c) el.appendChild(c); });
    return el;
  }

  function renderChart(container){
    const courseId = container.getAttribute('data-course-id');
    const startUrl = container.getAttribute('data-start-url');
    const currentQid = container.getAttribute('data-current-qid');
    const drawer = $('#qc-drawer', container);
    const sectionsWrap = $('#qc-sections', container);
    const toggleBtn = $('#qc-toggle-btn', container);
    const submitBtn = $('#qc-submit-btn', container);

    // Visited/Attempted tracking in sessionStorage per course (client-only until final submit)
    const visitedKey = 'exam_visited_' + courseId;
    const attemptedKey = 'exam_attempted_' + courseId;
    let visited = {}; // map qid -> true
    let attempted = {}; // map qid -> true
    try{ visited = JSON.parse(sessionStorage.getItem(visitedKey) || '{}'); } catch(e){ visited = {}; }
    try{ attempted = JSON.parse(sessionStorage.getItem(attemptedKey) || '{}'); } catch(e){ attempted = {}; }

    // Drawer toggle (mobile)
    if (toggleBtn){
      toggleBtn.addEventListener('click', function(){
        const isOpen = drawer.classList.toggle('open');
        toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggleBtn.textContent = isOpen ? 'Close' : 'Open';
      });
    }

    function statusUrl(){
      const url = `/exam/${courseId}/statuses/`;
      const params = new URLSearchParams();
      if (currentQid) params.set('current_qid', currentQid);
      return params.toString() ? `${url}?${params}` : url;
    }

    function buildTiles(data){
      sectionsWrap.setAttribute('aria-busy','true');
      sectionsWrap.innerHTML = '';
      const frag = document.createDocumentFragment();
      (data.sections||[]).forEach(sec => {
        const secDiv = create('div', {class: 'qc-section'});
        const head = create('div', {class:'qc-section-head'});
        head.appendChild(create('div', {class:'qc-name', text: sec.name}));
        head.appendChild(create('div', {class:'qc-count text-muted', text: `${sec.count || (sec.questions||[]).length} Qs`}));
        secDiv.appendChild(head);
        const grid = create('div', {class:'qc-grid', role:'grid'});
        (sec.questions||[]).forEach(q => {
          const cls = ['qc-tile'];
          const isAttempted = (q.status === 'attempted') || !!attempted[q.id];
          const isVisited = !!visited[q.id];
          if (isAttempted) cls.push('q-attempted');
          else if (isVisited) cls.push('q-visited');
          else cls.push('q-unvisited');
          if (q.is_current) cls.push('q-current');
          const tile = create('button', {
            class: cls.join(' '),
            tabindex: 0,
            title: `Q${q.number} — ${isAttempted ? 'Attempted' : (isVisited ? 'Visited (No Answer)' : 'Unvisited')}`,
            'aria-label': `Question ${q.number}, ${isAttempted ? 'Attempted' : (isVisited ? 'Visited (No Answer)' : 'Unvisited')}`,
            dataset: {qid: String(q.id), qnum: String(q.number), sec: sec.name}
          });
          tile.textContent = q.number;
          tile.addEventListener('click', function(ev){ ev.preventDefault(); navigateToQuestion(tile); });
          tile.addEventListener('keydown', function(ev){ if (ev.key === 'Enter'){ ev.preventDefault(); navigateToQuestion(tile); }});
          grid.appendChild(tile);
        });
        secDiv.appendChild(grid);
        frag.appendChild(secDiv);
      });
      sectionsWrap.appendChild(frag);
      sectionsWrap.setAttribute('aria-busy','false');
    }

    function updateTilesClassesOnly(){
      // Fast-path update without refetch
      try{ visited = JSON.parse(sessionStorage.getItem(visitedKey) || '{}'); } catch(e){}
      try{ attempted = JSON.parse(sessionStorage.getItem(attemptedKey) || '{}'); } catch(e){}
      $all('.qc-tile', sectionsWrap).forEach(function(tile){
        const qid = tile.dataset.qid;
        const isAttempted = !!attempted[qid];
        const isVisited = !!visited[qid];
        tile.classList.remove('q-unvisited','q-visited','q-attempted');
        if (isAttempted) tile.classList.add('q-attempted');
        else if (isVisited) tile.classList.add('q-visited');
        else tile.classList.add('q-unvisited');
      });
    }

    function saveCurrentSelectionThen(callback){
      try{
        const form = document.querySelector('form');
        if (!form){ callback(); return; }
        const fd = new FormData();
        // CSRF
        const csrf = form.querySelector('[name=csrfmiddlewaretoken]');
        if (csrf) fd.append('csrfmiddlewaretoken', csrf.value);
        // current index
        const idx = form.querySelector('input[name="current_q_index"]');
        if (idx) fd.append('current_q_index', idx.value);
        // selected option
        const sel = form.querySelector('input[name="selected_option"]:checked');
        if (sel) fd.append('selected_option', sel.value);
        // active subject (preserve)
        const as = form.querySelector('input[name="active_subject"]');
        if (as) fd.append('active_subject', as.value);
        // course id
        const cid = form.querySelector('input[name="course_id"]');
        if (cid) fd.append('course_id', cid.value);
        // POST to lightweight API to persist answer to session
        fetch('/exam/save-answer/', { method:'POST', body: fd, credentials:'same-origin' })
          .then(()=> setTimeout(callback, 30))
          .catch(()=> callback());
      } catch(e){ callback(); }
    }

    function navigateToQuestion(tile){
      const sec = tile.dataset.sec;
      const qnum = tile.dataset.qnum;
      // First persist current selection, then fetch partial and swap content without page reload
      // Prevent false violation counts during internal navigation
      try { sessionStorage.setItem('suppress_violation_' + courseId, 'true'); } catch(e){}
      saveCurrentSelectionThen(function(){
        const url = new URL(startUrl, window.location.origin);
        url.searchParams.set('subject', sec);
        url.searchParams.set('q', qnum);
        // Mark target question as visited (optimistic)
        try{ visited = JSON.parse(sessionStorage.getItem(visitedKey) || '{}'); } catch(e){ visited = {}; }
        // We don't know the qid synchronously; keep per-section index mapping handled after fetch
        fetch(url.toString(), {credentials:'same-origin'})
          .then(r=> r.text())
          .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newPanel = doc.querySelector('#exam-left-panel');
            const curPanel = document.getElementById('exam-left-panel');
            if (newPanel && curPanel){
              curPanel.innerHTML = newPanel.innerHTML;
              // Update current qid from new form
              const form = curPanel.querySelector('form');
              const newQid = form ? form.getAttribute('data-question-id') : null;
              if (newQid){ visited[newQid] = true; }
              sessionStorage.setItem(visitedKey, JSON.stringify(visited));
              // Bind radio change to mark attempted locally
              bindAttemptedHandler(curPanel);
              // Update sidebar dataset and refresh tiles
              container.setAttribute('data-current-qid', newQid || '');
              fetchAndRender();
              // Replace URL without full reload
              history.replaceState({}, '', url.toString());
              // Clear suppression flag after short delay
              setTimeout(function(){ try{ sessionStorage.removeItem('suppress_violation_' + courseId); }catch(e){} }, 1500);
            } else {
              // Fallback: hard navigation if structure not found
              window.location.assign(url.toString());
            }
          })
          .catch(()=>{ window.location.assign(url.toString()); });
      });
    }

    function fetchAndRender(){
      fetch(statusUrl(), {credentials:'same-origin'})
        .then(r=>r.json())
        .then(buildTiles)
        .catch(()=>{});
    }

    // Bind submit button to show confirmation modal
    if (submitBtn){
      submitBtn.addEventListener('click', function(){
        const modalEl = document.getElementById('submitConfirmModal');
        if (!modalEl) return;
        const bsModal = new bootstrap.Modal(modalEl, {backdrop:'static'});
        // Guard violations while modal is active
        window.__exam_ignore_violations = true;
        modalEl.addEventListener('hidden.bs.modal', function(){ window.__exam_ignore_violations = false; }, {once:true});
        bsModal.show();
        const confirmBtn = document.getElementById('confirmSubmitBtn');
        if (confirmBtn){
          const handler = function(){
            confirmBtn.removeEventListener('click', handler);
            // Prevent double-submit
            submitBtn.disabled = true;
            // Ensure current selection is saved and then submit to calculate-marks
            saveCurrentSelectionThen(function(){
              const form = document.querySelector('form');
              if (!form) { window.location.assign('/student/check-marks/' + (courseId||'')); return; }
              // Add hidden selected input (safety)
              const sel = form.querySelector('input[name="selected_option"]:checked');
              if (sel){
                let hidden = form.querySelector('input[type="hidden"][name="selected_option"]');
                if (!hidden){ hidden = document.createElement('input'); hidden.type='hidden'; hidden.name='selected_option'; form.appendChild(hidden); }
                hidden.value = sel.value;
                // Mark current as attempted locally if we can read current qid
                const cqid = form.getAttribute('data-question-id');
                if (cqid){
                  try{ attempted[cqid] = true; sessionStorage.setItem(attemptedKey, JSON.stringify(attempted)); }catch(e){}
                }
              }
              form.setAttribute('action', '/student/calculate-marks');
              form.submit();
            });
            bsModal.hide();
          };
          confirmBtn.addEventListener('click', handler);
        }
      });
    }

    // Bind handler in current left panel to mark attempted
    function bindAttemptedHandler(root){
      const form = (root||document).querySelector('form');
      if (!form) return;
      const radios = form.querySelectorAll('input[name="selected_option"]');
      const qid = form.getAttribute('data-question-id');
      radios.forEach(function(r){
        r.addEventListener('change', function(){
          if (qid){
            try{ attempted[qid] = true; sessionStorage.setItem(attemptedKey, JSON.stringify(attempted)); }catch(e){}
            updateTilesClassesOnly();
          }
        });
      });
    }

    // Mark current as visited on first load and bind attempted handler
    if (currentQid){
      try{ visited[currentQid] = true; sessionStorage.setItem(visitedKey, JSON.stringify(visited)); } catch(e){}
    }
    bindAttemptedHandler(document);
    fetchAndRender();
  }

  document.addEventListener('DOMContentLoaded', function(){
    const container = document.getElementById('question-chart-sidebar');
    if (container){ renderChart(container); }
  });
})();
