setInterval(()=>{document.getElementById('clock').textContent='live clock '+new Date().toLocaleTimeString();},1000);
 fetch('/api/health',{cache:'no-store'}).then(r=>r.json()).then(d=>{
   document.getElementById('api').textContent=`server API OK — ${d.service||'icb'} ${d.version||''} on port ${d.port||'?'}`;
 }).catch(e=>{document.getElementById('api').textContent='server API FAILED: '+e.message;});
